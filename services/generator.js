/**
 * CodexMC AI Generation Service
 * Now includes Gradle wrapper template system
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const { spawn } = require('child_process');

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/tmp/codexmc-workspaces';

// ─────────────────────────────────────────────
// GRADLE TEMPLATE LOCATION (NEW)
// ─────────────────────────────────────────────
const TEMPLATE_GRADLE_DIR = '/srv/codex/gradletmp';

// ─────────────────────────────────────────────
// THINKING LEVEL CONFIG
// ─────────────────────────────────────────────

const THINKING_CONFIGS = {
  low: {
    model: 'openai/gpt-oss-120b:free',
    max_tokens: 4000,
    temperature: 0.3,
    extraSystemNote: 'Be concise. Generate only required files.',
  },
  medium: {
    model: 'openai/gpt-oss-120b:free',
    max_tokens: 8000,
    temperature: 0.25,
    extraSystemNote: 'Include proper mod structure and registration.',
  },
  high: {
    model: 'openai/gpt-oss-120b:free',
    max_tokens: 16000,
    temperature: 0.2,
    extraSystemNote: 'Deep production-grade Minecraft mod with full correctness.',
  },
};

// ─────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────

function buildSystemPrompt(thinkingLevel) {
  const cfg = THINKING_CONFIGS[thinkingLevel] || THINKING_CONFIGS.medium;

  return `You are an expert Minecraft mod developer.

${cfg.extraSystemNote}

Return ONLY valid JSON:
{
  "modName": "ExampleMod",
  "modId": "examplemod",
  "mcVersion": "1.21.1",
  "files": {
    "build.gradle": "",
    "settings.gradle": "",
    "gradle/wrapper/gradle-wrapper.properties": "",
    "src/main/java/...": ""
  }
}`;
}

function buildUserPrompt(req) {
  return `Create a ${req.loader} mod for Minecraft ${req.mcVersion}.
Mod request: ${req.prompt}`;
}

// ─────────────────────────────────────────────
// JSON PARSER
// ─────────────────────────────────────────────

function extractJSON(text) {
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();

  const start = cleaned.indexOf('{');
  let json = cleaned.slice(start);

  try { return JSON.parse(json); } catch {}

  const last = json.lastIndexOf('}');
  if (last !== -1) {
    return JSON.parse(json.slice(0, last + 1));
  }

  throw new Error('Invalid JSON');
}

// ─────────────────────────────────────────────
// ZIP
// ─────────────────────────────────────────────

async function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(sourceDir, false);

    output.on('close', resolve);
    archive.on('error', reject);

    archive.finalize();
  });
}

// ─────────────────────────────────────────────
// GRADLE WRAPPER (UPDATED SYSTEM)
// ─────────────────────────────────────────────

async function writeGradleWrapper(workDir, mcVersion) {
  const wrapperDir = path.join(workDir, 'gradle', 'wrapper');
  await fs.ensureDir(wrapperDir);

  // ─────────────────────────────────────────────
  // COPY REAL WRAPPER FILES
  // ─────────────────────────────────────────────
  const files = [
    'gradle-wrapper.jar',
    'gradle-wrapper.properties'
  ];

  for (const file of files) {
    const src = path.join(TEMPLATE_GRADLE_DIR, 'gradle', 'wrapper', file);
    const dest = path.join(wrapperDir, file);

    if (!await fs.pathExists(src)) {
      throw new Error(`Missing Gradle template file: ${src}`);
    }

    await fs.copyFile(src, dest);
  }

  // ─────────────────────────────────────────────
  // UPDATE GRADLE VERSION
  // ─────────────────────────────────────────────
  let gradleVersion = '8.8';

  if (mcVersion?.startsWith('1.21')) gradleVersion = '8.8';
  else if (mcVersion?.startsWith('1.20')) gradleVersion = '8.5';
  else if (mcVersion?.startsWith('1.19')) gradleVersion = '8.3';
  else gradleVersion = '8.1.1';

  const propsPath = path.join(wrapperDir, 'gradle-wrapper.properties');

  let props = await fs.readFile(propsPath, 'utf8');

  props = props.replace(
    /distributionUrl=.*$/m,
    `distributionUrl=https\\://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip`
  );

  await fs.writeFile(propsPath, props, 'utf8');

  // ─────────────────────────────────────────────
  // REAL gradlew launcher (FIXES 127 ERROR)
  // ─────────────────────────────────────────────
  const gradlew = path.join(workDir, 'gradlew');

  await fs.writeFile(
    gradlew,
`#!/bin/sh
DIR=$(cd "$(dirname "$0")" && pwd)

exec java -jar "$DIR/gradle/wrapper/gradle-wrapper.jar" "$@"
`
  );

  fs.chmodSync(gradlew, 0o755);

  const gradlewBat = path.join(workDir, 'gradlew.bat');

  await fs.writeFile(
    gradlewBat,
`@echo off
set DIR=%~dp0
java -jar "%DIR%gradle\\wrapper\\gradle-wrapper.jar" %*
`
  );
}

// ─────────────────────────────────────────────
// BUILD SYSTEM
// ─────────────────────────────────────────────

function buildMod(workDir, emit) {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

    // Detect correct Java version
    let javaHome = process.env.JAVA_HOME;

    // safer fallback
    const javaVersion =
      workDir.includes('1.21') ? '21' :
      workDir.includes('1.20') ? '17' :
      '17';

    if (javaVersion === '21') {
      javaHome = process.env.JAVA_21_HOME || javaHome;
    } else {
      javaHome = process.env.JAVA_17_HOME || javaHome;
    }

    const proc = spawn(cmd, ['build', '--no-daemon'], {
      cwd: workDir,
      shell: true,
      env: {
        ...process.env,
        JAVA_HOME: javaHome || process.env.JAVA_HOME,
        PATH: process.env.PATH,
      },
    });

    proc.stdout.on('data', d =>
      d.toString().split('\n').forEach(l => l.trim() && emit('build', l))
    );

    proc.stderr.on('data', d =>
      d.toString().split('\n').forEach(l => l.trim() && emit('warn', l))
    );

    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Gradle exited ${code}`));
    });

    proc.on('error', err => {
      reject(new Error(`Failed to start Gradle wrapper: ${err.message}`));
    });
  });
}

// ─────────────────────────────────────────────
// MAIN GENERATION
// ─────────────────────────────────────────────

async function generateMod(request, onProgress) {
  const workId = uuidv4();
  const workDir = path.join(WORKSPACE_DIR, workId);

  function emit(type, msg) {
    if (onProgress) onProgress({ type, message: msg, workId });
  }

  await fs.ensureDir(workDir);

  emit('info', 'Starting AI generation...');

  const aiText = await axios.post(OPENROUTER_API, {
    model: THINKING_CONFIGS[request.thinkingLevel || 'medium'].model,
    messages: [
      { role: 'system', content: buildSystemPrompt(request.thinkingLevel) },
      { role: 'user', content: buildUserPrompt(request) }
    ]
  }, {
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  const modData = extractJSON(aiText.data.choices[0].message.content);

  emit('info', 'Writing files...');

  for (const filePath of Object.keys(modData.files)) {
    const fullPath = path.join(workDir, filePath);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, modData.files[filePath]);
  }

  // ✅ UPDATED: wrapper system
  await writeGradleWrapper(workDir, request.mcVersion);

  emit('info', 'Building mod...');

  await buildMod(workDir, emit);

  const jarPath = path.join(workDir, 'build/libs');

  emit('done', {
    workId,
    modName: modData.modName,
    jarPath
  });

  return { success: true, workId };
}

module.exports = { generateMod };
