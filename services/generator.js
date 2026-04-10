/**
 * CodexMC AI Generation Service
 * Now powered by OpenRouter (Qwen 80B Free)
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const { execFile, spawn } = require('child_process');
const { getRequiredJdk } = require('./versions');

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildSystemPrompt() {
  return `You are CodexMC, an expert Minecraft mod developer with deep knowledge of:
- Forge modding (all versions from 1.7 to 1.21+)
- Fabric modding (all versions from 1.14+)  
- NeoForge modding (1.20.2+)
- Java programming, Gradle build systems, and Minecraft internals

When asked to create a mod, you MUST respond with a valid JSON object (no markdown, no backticks, just raw JSON) with this exact structure:
{
  "modName": "ExampleMod",
  "modId": "examplemod",
  "description": "What the mod does",
  "version": "1.0.0",
  "files": {
    "src/main/java/com/example/examplemod/ExampleMod.java": "// full java code here",
    "build.gradle": "// full build.gradle"
  },
  "gradlewNeeded": true,
  "jdkRequired": "21"
}

Rules:
- Always write COMPLETE, COMPILABLE Java code
- No placeholders
- No truncation
- Fully working Gradle project
- Correct loader APIs`;
}

function buildUserPrompt(request) {
  const { prompt, loader, mcVersion, loaderVersion } = request;

  return `Create a complete Minecraft ${loader} mod for Minecraft ${mcVersion} using ${loader} ${loaderVersion || 'latest'}.

Mod Request: ${prompt}

Return ONLY raw JSON. No markdown.`;
}

// ── Gradle wrapper ───────────────────────────────────────────────────────────

function getGradleWrapperProps(loader, mcVersion) {
  const [, , minor] = mcVersion.split('.').map(Number);
  let gradleVersion = '8.8';
  if (minor <= 16) gradleVersion = '7.6.4';
  else if (minor <= 19) gradleVersion = '8.1.1';

  return `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists`;
}

const GRADLEW_SCRIPT = `#!/bin/sh
DEFAULT_JVM_OPTS='"-Xmx64m" "-Xms64m"'
APP_HOME="$( cd "$( dirname "$0" )" && pwd )"
CLASSPATH=$APP_HOME/gradle/wrapper/gradle-wrapper.jar
exec java -classpath "$CLASSPATH" org.gradle.wrapper.GradleWrapperMain "$@"
`;

const GRADLEW_BAT = `@echo off
set DIRNAME=%~dp0
set APP_HOME=%DIRNAME%
set CLASSPATH=%APP_HOME%\\gradle\\wrapper\\gradle-wrapper.jar
"%JAVA_HOME%\\bin\\java.exe" -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
`;

// ── Core function ────────────────────────────────────────────────────────────

async function generateMod(request, onProgress) {
  const { loader, mcVersion } = request;
  const workId = uuidv4();
  const workDir = path.join(process.env.WORKSPACE_DIR || '/tmp/codexmc-workspaces', workId);

  const emit = (type, message) => {
    if (onProgress) onProgress({ type, message, workId });
  };

  try {
    emit('info', `🚀 Starting mod generation...`);

    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY not set');
    }

    emit('ai', `🤖 Calling OpenRouter (Nemotron 3 Super Free)...`);

    const response = await axios.post(
      OPENROUTER_API,
      {
        model: "nvidia/nemotron-3-super-120b-a12b:free",
        temperature: 0.7,
        max_tokens: 8000,
        stream: true,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(request) }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://codexmc.ai',
          'X-Title': 'CodexMC',
          'X-Request-ID': uuidv4()
        },
        responseType: 'stream',
        timeout: 120000
      }
    );

    let fullResponse = '';

    await new Promise((resolve, reject) => {
      let buffer = '';

      response.data.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataStr);

            const text =
              parsed.choices?.[0]?.delta?.content ||
              parsed.choices?.[0]?.message?.content;

            if (text) {
              fullResponse += text;
              emit('ai-stream', text.replace(/\n/g, ' '));
            }
          } catch {}
        }
      });

      response.data.on('end', resolve);
      response.data.on('error', reject);
    });

    emit('ai', `✅ AI generation complete`);

    // ── Parse JSON ─────────────────────────────────────────────
    let modData;
    try {
      const cleaned = fullResponse
        .replace(/^```json/i, '')
        .replace(/```$/i, '')
        .trim();

      modData = JSON.parse(cleaned);
    } catch {
      const match = fullResponse.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Invalid JSON from AI");
      modData = JSON.parse(match[0]);
    }

    emit('info', `📁 Writing files...`);

    await fs.ensureDir(workDir);

    for (const [filePath, content] of Object.entries(modData.files || {})) {
      const fullPath = path.join(workDir, filePath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, content, 'utf8');
    }

    // ── Gradle wrapper ───────────────────────────────────────
    const wrapperDir = path.join(workDir, 'gradle', 'wrapper');
    await fs.ensureDir(wrapperDir);

    await fs.writeFile(
      path.join(wrapperDir, 'gradle-wrapper.properties'),
      getGradleWrapperProps(loader, mcVersion)
    );

    await fs.writeFile(path.join(workDir, 'gradlew'), GRADLEW_SCRIPT);
    await fs.chmod(path.join(workDir, 'gradlew'), 0o755);
    await fs.writeFile(path.join(workDir, 'gradlew.bat'), GRADLEW_BAT);

    emit('success', '🎉 Mod generated successfully');

    setTimeout(() => fs.remove(workDir).catch(() => {}), 60000);

    return {
      success: true,
      modName: modData.modName,
      modId: modData.modId,
      workDir
    };

  } catch (err) {
    emit('error', err.message);
    await fs.remove(workDir).catch(() => {});
    throw err;
  }
}

function findJavaHome(version) {
  const candidates = [
    `/usr/lib/jvm/java-${version}-openjdk-amd64`,
    `/usr/lib/jvm/java-${version}-openjdk`,
    `/usr/lib/jvm/temurin-${version}`,
    `/opt/codexmc-jdk/${version}`,
  ];

  for (const c of candidates) {
    if (require('fs').existsSync(path.join(c, 'bin', 'java'))) return c;
  }

  try {
    const which = require('child_process')
      .execSync('which java')
      .toString()
      .trim();
    return which.replace('/bin/java', '');
  } catch {
    return '/usr';
  }
}

module.exports = { generateMod };
