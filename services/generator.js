/**
 * CodexMC AI Generation Service
 * Now includes Gradle wrapper template system + auto Java detection
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const { spawn, execSync } = require('child_process');

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/tmp/codexmc-workspaces';
const TEMPLATE_GRADLE_DIR = '/srv/codex/gradletmp';

// ─────────────────────────────────────────────
// JAVA AUTO-DETECTION
//
// Resolution order for a required Java version:
//   1. Explicit env var:   JAVA_17_HOME, JAVA_21_HOME, etc.
//   2. SDKMAN candidates:  ~/.sdkman/candidates/java/<version>.*
//   3. Common system paths: /usr/lib/jvm/java-<version>-*
//   4. `java -version` on PATH — used only if the major version matches.
//
// Results are cached after the first probe so the filesystem
// is only scanned once per process lifetime.
// ─────────────────────────────────────────────

const javaHomeCache = {};

/**
 * Returns the Java major version number reported by the binary at `javaHome`,
 * or null if the path doesn't contain a working JDK.
 */
function probeJavaMajorVersion(javaHome) {
  try {
    const bin = path.join(javaHome, 'bin', 'java');
    // `java -version` writes to stderr
    const out = execSync(`"${bin}" -version 2>&1`, { timeout: 5000 }).toString();
    // Handles both:  version "17.0.11"  and  version "1.8.0_391"
    const match = out.match(/version "(?:1\.(\d+)|(\d+))[\.\-_"]/);
    if (!match) return null;
    return parseInt(match[1] || match[2], 10);
  } catch {
    return null;
  }
}

/**
 * Scans candidate directories for a JDK of the requested major version.
 * Returns the first matching JAVA_HOME string, or null.
 */
function scanForJava(majorVersion) {
  const home = process.env.HOME || '/root';

  // Candidate roots to search, in priority order
  const searchRoots = [
    // SDKMAN
    path.join(home, '.sdkman', 'candidates', 'java'),
    // Debian/Ubuntu
    '/usr/lib/jvm',
    // RHEL/Fedora
    '/usr/java',
    // macOS Homebrew
    '/opt/homebrew/opt',
    '/usr/local/opt',
    // Generic /opt
    '/opt/java',
    '/opt/jdk',
  ];

  for (const root of searchRoots) {
    if (!fs.pathExistsSync(root)) continue;

    let entries;
    try { entries = fs.readdirSync(root); } catch { continue; }

    // Sort descending so e.g. "21.0.3" is preferred over "21-ea"
    entries.sort().reverse();

    for (const entry of entries) {
      const candidate = path.join(root, entry);

      // Quick name-based filter before paying for a subprocess
      const nameHint = entry.replace(/[^0-9]/g, ' ').trim().split(/\s+/)[0];
      if (nameHint && parseInt(nameHint, 10) !== majorVersion) continue;

      const found = probeJavaMajorVersion(candidate);
      if (found === majorVersion) return candidate;
    }
  }

  return null;
}

/**
 * Returns the JAVA_HOME to use for the given major version.
 * Throws with a clear, actionable message if nothing is found.
 */
function resolveJavaHome(majorVersion) {
  if (javaHomeCache[majorVersion]) return javaHomeCache[majorVersion];

  // 1. Explicit env var
  const envKey = `JAVA_${majorVersion}_HOME`;
  if (process.env[envKey]) {
    const v = probeJavaMajorVersion(process.env[envKey]);
    if (v === majorVersion) {
      javaHomeCache[majorVersion] = process.env[envKey];
      return process.env[envKey];
    }
    console.warn(
      `⚠️  ${envKey} is set but the JDK at that path reports Java ${v}, not ${majorVersion}. Falling back to auto-detection.`
    );
  }

  // 2 & 3. Scan filesystem
  const scanned = scanForJava(majorVersion);
  if (scanned) {
    console.log(`✅  Auto-detected Java ${majorVersion} at: ${scanned}`);
    javaHomeCache[majorVersion] = scanned;
    return scanned;
  }

  // 4. Fall back to PATH java only if its major version matches exactly
  try {
    const systemOut = execSync('java -version 2>&1', { timeout: 5000 }).toString();
    const match = systemOut.match(/version "(?:1\.(\d+)|(\d+))[\.\-_"]/);
    if (match) {
      const systemMajor = parseInt(match[1] || match[2], 10);
      if (systemMajor === majorVersion) {
        const javaExe = execSync('which java 2>/dev/null || where java 2>nul', { timeout: 3000 })
          .toString().trim().split('\n')[0].trim();
        // Typically: /usr/lib/jvm/java-21.../bin/java -> two levels up
        const derived = path.resolve(javaExe, '..', '..');
        console.log(`✅  Using system Java ${majorVersion} at: ${derived}`);
        javaHomeCache[majorVersion] = derived;
        return derived;
      }
    }
  } catch { /* system java not available */ }

  // Nothing worked — give a helpful error
  throw new Error(
    `Java ${majorVersion} not found. Tried:\n` +
    `  • env var ${envKey}\n` +
    `  • ~/.sdkman/candidates/java/\n` +
    `  • /usr/lib/jvm/, /usr/java/, /opt/jdk/\n` +
    `  • system PATH java\n\n` +
    `Fix options:\n` +
    `  • Set ${envKey}=/path/to/jdk-${majorVersion}\n` +
    `  • Install via SDKMAN: sdk install java ${majorVersion}-tem\n` +
    `  • Install via apt:    apt install openjdk-${majorVersion}-jdk`
  );
}

// ─────────────────────────────────────────────
// JAVA / GRADLE VERSION MAPPING
// ─────────────────────────────────────────────

/**
 * Returns the minimum Java major version required for a given MC version.
 *
 * MC 1.21+  -> Java 21  (Gradle 8.8)
 * MC 1.20.x -> Java 17  (Gradle 8.5)
 * MC 1.19.x -> Java 17  (Gradle 8.3)
 * Older     -> Java 17  (Gradle 8.1)
 */
function requiredJavaMajor(mcVersion) {
  if (!mcVersion) return 17;
  const [, minor] = mcVersion.split('.').map(Number);
  return minor >= 21 ? 21 : 17;
}

function resolveGradleVersion(mcVersion) {
  if (!mcVersion) return '8.1.1';
  const [, minor] = mcVersion.split('.').map(Number);
  if (minor >= 21) return '8.8';
  if (minor >= 20) return '8.5';
  if (minor >= 19) return '8.3';
  return '8.1.1';
}

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
  if (last !== -1) return JSON.parse(json.slice(0, last + 1));

  throw new Error('Invalid JSON from AI response');
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
// GRADLE WRAPPER
// ─────────────────────────────────────────────

async function writeGradleWrapper(workDir, mcVersion) {
  const wrapperDir = path.join(workDir, 'gradle', 'wrapper');
  await fs.ensureDir(wrapperDir);

  const files = ['gradle-wrapper.jar', 'gradle-wrapper.properties'];
  for (const file of files) {
    const src = path.join(TEMPLATE_GRADLE_DIR, 'gradle', 'wrapper', file);
    const dest = path.join(wrapperDir, file);
    if (!await fs.pathExists(src)) throw new Error(`Missing Gradle template file: ${src}`);
    await fs.copyFile(src, dest);
  }

  // Patch wrapper properties with the correct Gradle version
  const gradleVersion = resolveGradleVersion(mcVersion);
  const propsPath = path.join(wrapperDir, 'gradle-wrapper.properties');
  let props = await fs.readFile(propsPath, 'utf8');
  props = props.replace(
    /distributionUrl=.*$/m,
    `distributionUrl=https\\://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip`
  );
  await fs.writeFile(propsPath, props, 'utf8');

  // gradlew launcher
  await fs.writeFile(
    path.join(workDir, 'gradlew'),
`#!/bin/sh
DIR=$(cd "$(dirname "$0")" && pwd)
exec java -jar "$DIR/gradle/wrapper/gradle-wrapper.jar" "$@"
`
  );
  fs.chmodSync(path.join(workDir, 'gradlew'), 0o755);

  await fs.writeFile(
    path.join(workDir, 'gradlew.bat'),
`@echo off
set DIR=%~dp0
java -jar "%DIR%gradle\\wrapper\\gradle-wrapper.jar" %*
`
  );
}

// ─────────────────────────────────────────────
// BUILD SYSTEM
// ─────────────────────────────────────────────

function buildMod(workDir, mcVersion, emit) {
  return new Promise((resolve, reject) => {
    const javaMajor = requiredJavaMajor(mcVersion);

    let javaHome;
    try {
      javaHome = resolveJavaHome(javaMajor);
    } catch (err) {
      return reject(err);
    }

    emit('info', `Using Java ${javaMajor} (${javaHome})`);

    const cmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

    const proc = spawn(cmd, ['build', '--no-daemon'], {
      cwd: workDir,
      shell: true,
      env: {
        ...process.env,
        JAVA_HOME: javaHome,
        // Prepend the correct JDK bin so `java` resolves to the right version,
        // preventing a mismatched system Java (e.g. 25 / class version 69)
        // from being picked up by Gradle.
        PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH}`,
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

    proc.on('error', err =>
      reject(new Error(`Failed to start Gradle wrapper: ${err.message}`))
    );
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
      { role: 'user',   content: buildUserPrompt(request) }
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

  await writeGradleWrapper(workDir, request.mcVersion);

  emit('info', 'Building mod...');
  await buildMod(workDir, request.mcVersion, emit);

  const jarPath = path.join(workDir, 'build/libs');
  emit('done', { workId, modName: modData.modName, jarPath });

  return { success: true, workId };
}

module.exports = { generateMod };
