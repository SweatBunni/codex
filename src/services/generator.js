/**
 * CodexMC v3 - AI-powered Minecraft Mod Generator
 * Uses DeepSeek via OpenRouter (openrouter.ai)
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const { execSync, spawn } = require('child_process');
const config = require('../config');
const { logger } = require('../utils/logger');

const WORKSPACE_DIR = path.resolve(config.workspace.dir);

// Java Auto-Detection
const javaCache = {};

function probeJavaMajor(javaHome) {
  try {
    const bin = path.join(javaHome, 'bin', 'java');
    const out = execSync(`"${bin}" -version 2>&1`, { timeout: 5000 }).toString();
    const m = out.match(/version "(?:1\.(\d+)|(\d+))[\.\-_"]/);
    if (!m) return null;
    return parseInt(m[1] || m[2], 10);
  } catch { return null; }
}

function scanForJava(major) {
  const home = process.env.HOME || '/root';
  const roots = [
    path.join(home, '.sdkman', 'candidates', 'java'),
    '/usr/lib/jvm', '/usr/java', '/opt/homebrew/opt',
    '/usr/local/opt', '/opt/java', '/opt/jdk',
  ];
  for (const root of roots) {
    if (!fs.pathExistsSync(root)) continue;
    let entries;
    try { entries = fs.readdirSync(root); } catch { continue; }
    entries.sort().reverse();
    for (const entry of entries) {
      const hint = entry.replace(/[^0-9]/g, ' ').trim().split(/\s+/)[0];
      if (hint && parseInt(hint, 10) !== major) continue;
      const found = probeJavaMajor(path.join(root, entry));
      if (found === major) return path.join(root, entry);
    }
  }
  return null;
}

function resolveJavaHome(major) {
  if (javaCache[major]) return javaCache[major];
  const envKey = `JAVA_${major}_HOME`;
  if (process.env[envKey]) { javaCache[major] = process.env[envKey]; return javaCache[major]; }
  const found = scanForJava(major);
  if (found) { javaCache[major] = found; return found; }
  return null;
}

function requiredJavaMajor(mcVersion) {
  const [, minor] = mcVersion.split('.').map(Number);
  if (minor >= 21) return 21;
  if (minor >= 17) return 17;
  return 8;
}

function getGradleVersion(mcVersion, loader) {
  const [, minor] = mcVersion.split('.').map(Number);
  if (loader === 'fabric') return minor >= 20 ? '8.8' : minor >= 18 ? '7.4.2' : '7.1';
  if (loader === 'neoforge') return '8.8';
  if (minor >= 20) return '8.4';
  if (minor >= 18) return '7.4.2';
  return '7.1';
}

function getFabricLoom(mcVersion) {
  const [, minor] = mcVersion.split('.').map(Number);
  if (minor >= 21) return '1.9-SNAPSHOT';
  if (minor >= 20) return '1.6-SNAPSHOT';
  if (minor >= 18) return '0.12-SNAPSHOT';
  return '0.10-SNAPSHOT';
}

function getFabricApi(mcVersion) {
  const map = { '1.21': '0.100.0+1.21', '1.20.4': '0.97.0+1.20.4', '1.20.1': '0.92.2+1.20.1', '1.19.4': '0.87.2+1.19.4' };
  return map[mcVersion] || '0.92.2+1.20.1';
}

function getForgeGradleVersion(mcVersion) {
  const [, minor] = mcVersion.split('.').map(Number);
  return minor >= 20 ? '6.0.+' : '5.1.+';
}

// OpenRouter Client
async function callOpenRouter(prompt) {
  const { apiKey, model, maxTokens, temperature } = config.openrouter;
  const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature,
  }, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.server.siteUrl,
      'X-Title': 'CodexMC',
    },
    timeout: 240000,
  });

  const choice = res.data?.choices?.[0];
  if (!choice) throw new Error('OpenRouter returned no choices');
  return choice.message?.content || '';
}

function buildDependencies(loader, mcVersion, loaderVersion) {
  if (loader === 'fabric') {
    return `FABRIC DEPENDENCIES:
- fabric-loom: ${getFabricLoom(mcVersion)}
- fabric-loader: ${loaderVersion || '0.15.11'}
- fabric-api: ${getFabricApi(mcVersion)}
- Use FabricMod annotation, use Fabric API events`;
  }
  if (loader === 'neoforge') {
    return `NEOFORGE DEPENDENCIES:
- NeoGradle plugin
- NeoForge: ${loaderVersion || '20.4.167'}
- Use @Mod annotation, NeoForge event bus`;
  }
  return `FORGE DEPENDENCIES:
- ForgeGradle: ${getForgeGradleVersion(mcVersion)}
- MinecraftForge: ${loaderVersion || '47.2.0'}
- Use @Mod annotation, Forge event bus, DeferredRegister`;
}

function buildPrompt(req) {
  const { description, loader, mcVersion, loaderVersion, thinkingLevel } = req;
  const loaderUpper = loader.toUpperCase();
  const depBlock = buildDependencies(loader, mcVersion, loaderVersion);

  return `You are an expert Minecraft mod developer. Generate a complete, working, multi-file Minecraft mod.

REQUIREMENTS:
- Mod description: ${description}
- Mod loader: ${loaderUpper}
- Minecraft version: ${mcVersion}
- Loader version: ${loaderVersion}
- Quality level: ${thinkingLevel}

CRITICAL RULES:
1. Output ONLY a valid JSON object - no markdown, no code fences, no commentary before or after
2. All Java files must be syntactically valid and compile cleanly
3. Use correct package structure: com.codexmc.<modid>
4. Use proper ${loaderUpper} ${mcVersion} APIs - no deprecated methods
5. ALWAYS split Java code into multiple files - one class per file, NO exceptions
6. Each Java class MUST be its own separate .java file - main mod class, items, blocks, events, registry
7. Never put multiple top-level classes in a single Java file
8. Include ALL required files for a compilable mod
9. The mod must fully implement the described feature

MANDATORY MULTI-FILE JAVA STRUCTURE:
- src/main/java/com/codexmc/<modid>/<ModId>Mod.java  (main entry point only)
- src/main/java/com/codexmc/<modid>/init/ModItems.java (item DeferredRegister)
- src/main/java/com/codexmc/<modid>/init/ModBlocks.java (block DeferredRegister)
- src/main/java/com/codexmc/<modid>/item/<ItemName>.java (one file per item class)
- src/main/java/com/codexmc/<modid>/block/<BlockName>.java (one file per block class)
- src/main/java/com/codexmc/<modid>/event/<HandlerName>.java (one file per event handler)
Add more files as the feature requires.

${depBlock}

JSON ESCAPING RULES (critical - invalid JSON breaks everything):
- Escape all backslashes in Java source as \\\\
- Escape all double-quotes inside Java strings as \\"
- Represent newlines inside JSON string values as \\n (no literal newlines in strings)
- The entire output must be parseable by JSON.parse()

OUTPUT FORMAT - output ONLY this JSON, nothing before or after:
{
  "modId": "examplemod",
  "modName": "Example Mod",
  "version": "1.0.0",
  "description": "what the mod does",
  "files": {
    "src/main/java/com/codexmc/examplemod/ExampleMod.java": "package com.codexmc.examplemod;\\n\\nimport ...\\n\\n@Mod(\\"examplemod\\")\\npublic class ExampleMod { ... }",
    "src/main/java/com/codexmc/examplemod/init/ModItems.java": "package com.codexmc.examplemod.init;\\n\\n...",
    "src/main/java/com/codexmc/examplemod/item/MyItem.java": "package com.codexmc.examplemod.item;\\n\\n...",
    "build.gradle": "...",
    "settings.gradle": "...",
    "src/main/resources/META-INF/mods.toml": "...",
    "src/main/resources/pack.mcmeta": "..."
  }
}`;
}
function extractJSON(text) {
  try { return JSON.parse(text.trim()); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
  try { return JSON.parse(stripped); } catch {}
  throw new Error('Could not extract valid JSON from AI response');
}

async function writeGradleWrapper(workDir, mcVersion, loader) {
  const gradleVersion = getGradleVersion(mcVersion, loader);
  const gradleDir = path.join(workDir, 'gradle', 'wrapper');
  await fs.ensureDir(gradleDir);

  await fs.writeFile(path.join(gradleDir, 'gradle-wrapper.properties'),
    `distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists\n`
  );

  const gradlew = `#!/bin/sh\nAPP_HOME="$(cd "$(dirname "$0")" && pwd)"\nexec "${process.env.JAVA_HOME || 'java'}" -jar "$APP_HOME/gradle/wrapper/gradle-wrapper.jar" "$@"\n`;
  await fs.writeFile(path.join(workDir, 'gradlew'), gradlew, { mode: 0o755 });

  const localJar = '/srv/codex/gradle/wrapper/gradle-wrapper.jar';
  if (await fs.pathExists(localJar)) {
    await fs.copy(localJar, path.join(gradleDir, 'gradle-wrapper.jar'));
  }
}

function buildMod(workDir, mcVersion, loader, emit) {
  return new Promise((resolve, reject) => {
    const javaMajor = requiredJavaMajor(mcVersion);
    const javaHome = resolveJavaHome(javaMajor);
    const env = { ...process.env };
    if (javaHome) env.JAVA_HOME = javaHome;

    const gradlew = path.join(workDir, 'gradlew');
    const cmd = fs.existsSync(gradlew) ? gradlew : 'gradle';

    emit('build', `Building with Java ${javaMajor}...`);

    const proc = spawn(cmd, ['build', '--no-daemon', '--stacktrace'], { cwd: workDir, env, stdio: 'pipe' });
    let output = '';

    const onData = (d) => {
      const line = d.toString();
      output += line;
      line.split('\n').filter(l => l.trim()).forEach(l => emit('build', l));
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('close', code => code === 0 ? resolve(output) : reject(new Error(`Build failed (exit ${code})\n${output.slice(-2000)}`)));
    proc.on('error', reject);
    setTimeout(() => { proc.kill(); reject(new Error('Build timed out')); }, config.workspace.buildTimeout);
  });
}

async function zipDirectory(srcDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize();
  });
}

async function findJar(workDir) {
  const buildLibs = path.join(workDir, 'build', 'libs');
  if (!await fs.pathExists(buildLibs)) return null;
  const files = await fs.readdir(buildLibs);
  const jar = files.find(f => f.endsWith('.jar') && !f.includes('sources') && !f.includes('dev'));
  return jar ? path.join(buildLibs, jar) : null;
}

function validateMod(mod) {
  if (!mod.modId || typeof mod.modId !== 'string') throw new Error('Missing modId');
  if (!mod.files || typeof mod.files !== 'object') throw new Error('Missing files');
  if (Object.keys(mod.files).length === 0) throw new Error('No files generated');
  const javaFiles = Object.keys(mod.files).filter(f => f.endsWith('.java'));
  if (javaFiles.length === 0) throw new Error('No Java files generated');
  if (!Object.keys(mod.files).some(f => f === 'build.gradle' || f === 'build.gradle.kts')) throw new Error('No build.gradle generated');
  // Log how many Java files were generated
  return { javaFileCount: javaFiles.length };
}

async function generateMod(request, onProgress) {
  const jobId = uuidv4();
  const workDir = path.join(WORKSPACE_DIR, jobId);

  function emit(type, message) {
    logger.info(`[${type}] ${message}`);
    if (onProgress) onProgress({ type, message, jobId });
  }

  try {
    await fs.ensureDir(workDir);
    emit('status', `Starting mod generation (Job: ${jobId})`);
    emit('status', `Using DeepSeek via OpenRouter (${config.openrouter.model})`);

    const thinkingMap = { low: 2048, medium: 8192, high: 24576 };
    const thinkingBudget = thinkingMap[request.thinkingLevel] || 8192;

    emit('ai', `DeepSeek thinking... (quality: ${request.thinkingLevel || 'medium'})`);
    emit('ai', `Prompt: "${request.description}"`);

    const prompt = buildPrompt(request);
    const rawResponse = await callOpenRouter(prompt);

    emit('ai', 'Response received, parsing...');

    let mod;
    try {
      mod = extractJSON(rawResponse);
    } catch (e) {
      emit('ai', 'Retrying with stricter JSON prompt...');
      const retry = await callOpenRouter(
        `${prompt}\n\nIMPORTANT: Output ONLY the raw JSON object. Start with { and end with }. No other text whatsoever.`
      );
      mod = extractJSON(retry);
    }

    validateMod(mod);

    const modId = mod.modId.toLowerCase().replace(/[^a-z0-9]/g, '');
    const javaFiles = Object.keys(mod.files).filter(f => f.endsWith('.java'));
    emit('files', `Mod ID: ${modId}`);
    emit('files', `Writing ${Object.keys(mod.files).length} files (${javaFiles.length} Java files)...`);

    for (const [relPath, content] of Object.entries(mod.files)) {
      const fullPath = path.join(workDir, relPath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, content, 'utf8');
      emit('file', relPath);
    }

    await writeGradleWrapper(workDir, request.mcVersion, request.loader);

    const sourceZipPath = path.join(workDir, `${modId}-source.zip`);
    emit('build', 'Creating source ZIP...');
    await zipDirectory(workDir, sourceZipPath);

    emit('build', 'Compiling with Gradle...');
    let jarPath = null;
    let buildSuccess = false;
    let buildError = null;

    try {
      await buildMod(workDir, request.mcVersion, request.loader, emit);
      jarPath = await findJar(workDir);
      buildSuccess = true;
      emit('success', 'BUILD SUCCESSFUL');
      if (jarPath) emit('success', `JAR: ${path.basename(jarPath)}`);
    } catch (err) {
      buildError = err.message;
      emit('warning', 'Compile failed - source ZIP still available');
    }

    const result = {
      jobId, modId,
      modName: mod.modName || modId,
      version: mod.version || '1.0.0',
      description: mod.description || request.description,
      loader: request.loader,
      mcVersion: request.mcVersion,
      files: Object.keys(mod.files),
      sourceZipPath, jarPath, buildSuccess, buildError, workDir,
    };

    emit('done', buildSuccess ? 'Done! JAR + Source ZIP ready' : 'Done! Source ZIP ready (compile locally)');
    return result;

  } catch (error) {
    emit('error', `Generation failed: ${error.message}`);
    throw error;
  }
}

module.exports = { generateMod };
