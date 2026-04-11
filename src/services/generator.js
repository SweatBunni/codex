/**
 * CodexMC v3 - AI-powered Minecraft Mod Generator
 * Uses OpenRouter (openrouter.ai)
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const { execSync, spawn } = require('child_process');
const config = require('../config');
const { logger } = require('../utils/logger');
const { buildResponsePlan, generateProjectFromPlan } = require('./responsePipeline');

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

// MC version -> required Java major version
// Based on official Mojang requirements:
// 1.21+  -> Java 21
// 1.18-1.20 -> Java 17
// 1.17   -> Java 16
// 1.13-1.16 -> Java 8 (but 11 works)
// <1.13  -> Java 8
function requiredJavaMajor(mcVersion) {
  const parts = mcVersion.split('.').map(Number);
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;
  if (minor >= 21) return 21;
  if (minor >= 18) return 17;
  if (minor === 17) return 16;
  return 8;
}

// Gradle version must be compatible with the Java version running the build.
// Java 21 max -> Gradle 8.5+ (8.8 is fine up to Java 21, NOT 22+)
// Java 17 max -> Gradle 7.3+
// Java 16     -> Gradle 7.0+
// Java 8      -> Gradle 4.x-7.x
// We also cap based on what the loader actually needs.
function getGradleVersion(mcVersion, loader) {
  const parts = mcVersion.split('.').map(Number);
  const minor = parts[1] || 0;

  // Fabric (force stable modern)
  if (loader === 'fabric') {
    if (minor >= 21) return '8.8';
    if (minor >= 20) return '8.3';
    if (minor >= 18) return '7.4.2';
    return '7.1';
  }

  // NeoForge
  if (loader === 'neoforge') return '8.8';

  // Forge
  if (minor >= 21) return '8.8';
  if (minor >= 20) return '8.3';
  if (minor >= 18) return '7.4.2';
  if (minor === 17) return '7.1';

  return '6.9.4';
}

function getFabricLoom(mcVersion) {
  const [, minor] = mcVersion.split('.').map(Number);

  // Modern Fabric (2025+)
  if (minor >= 21) return '1.7.3';   // ✅ FIXED (was 1.6.1)
  if (minor >= 20) return '1.7.3';   // ✅ unified modern version

  // Older support (only if you REALLY need it)
  if (minor >= 18) return '1.5-SNAPSHOT';
  return '0.12.12';
}

function getFabricLoomPluginId(mcVersion) {
  return 'fabric-loom';
}

function getFabricApi(mcVersion) {
  const map = {
    '1.21.11': '0.140.2+1.21.11',
    '1.21.1': '0.116.9+1.21.1',
    '1.21': '0.102.0+1.21',
    '1.20.4': '0.97.0+1.20.4',
    '1.20.1': '0.92.2+1.20.1',
    '1.19.4': '0.87.2+1.19.4',
  };

  if (map[mcVersion]) return map[mcVersion];
  const fallback = Object.entries(map).find(([version]) => mcVersion.startsWith(version));
  return fallback ? fallback[1] : '0.92.2+1.20.1';
}

function getForgeGradleVersion(mcVersion) {
  const [, minor] = mcVersion.split('.').map(Number);
  if (minor >= 21) return '6.0.+';
  if (minor >= 20) return '6.0.+';
  return '5.1.+';
}

// Returns the Java version string for build.gradle sourceCompatibility
function getJavaVersionString(mcVersion) {
  const major = requiredJavaMajor(mcVersion);
  if (major === 21) return 'JavaVersion.VERSION_21';
  if (major === 17) return 'JavaVersion.VERSION_17';
  if (major === 16) return 'JavaVersion.VERSION_16';
  return 'JavaVersion.VERSION_1_8';
}

function buildDependencies(loader, mcVersion, loaderVersion) {
  if (loader === 'fabric') {
    return `FABRIC DEPENDENCIES:
- fabric-loom: ${getFabricLoom(mcVersion)}
- fabric-loader: ${loaderVersion || '0.15.11'}
- fabric-api: ${getFabricApi(mcVersion)}
- Main entrypoint must implement net.fabricmc.api.ModInitializer
- Use fabric.mod.json metadata and Fabric API events`;
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

function buildPrompt(req, analysis, architecture) {
  const { description, loader, mcVersion, loaderVersion, thinkingLevel } = req;
  const loaderUpper = loader.toUpperCase();
  const depBlock = buildDependencies(loader, mcVersion, loaderVersion);
  const javaMajor = requiredJavaMajor(mcVersion);
  const javaVersionEnum = getJavaVersionString(mcVersion);
  const gradleVersion = getGradleVersion(mcVersion, loader);

  return `You are an expert Minecraft mod developer. Generate a complete, working, multi-file Minecraft mod.

REQUIREMENTS:
- Mod description: ${description}
- Mod loader: ${loaderUpper}
- Minecraft version: ${mcVersion}
- Loader version: ${loaderVersion}
- Quality level: ${thinkingLevel}
- Java version: ${javaMajor} (use ${javaVersionEnum} in build.gradle)
- Gradle version: ${gradleVersion}
- Tokenization summary: ~${analysis.tokenization.approximateTokenCount} prompt tokens
- Vector intent: ${analysis.vectorization.inferredIntent}
- Semantic anchors: ${analysis.vectorization.topTerms.map(entry => entry.term).join(', ') || 'none'}
- Planned architecture summary: ${architecture.summary || 'build a clean, compilable mod structure'}
- Planned components: ${(architecture.architecture || []).join(', ') || 'main mod class, registries, feature classes'}
- Planned required files: ${(architecture.requiredFiles || []).join(', ') || 'derive as needed'}
- Risks to avoid: ${(architecture.risks || []).join(', ') || 'invalid JSON, missing files, API mismatch'}

CRITICAL RULES:
1. Output ONLY a valid JSON object - no markdown, no code fences, no commentary before or after
2. All Java files must be syntactically valid and compile cleanly with Java ${javaMajor}
3. Use correct package structure: com.codexmc.<modid>
4. Use proper ${loaderUpper} ${mcVersion} APIs - no deprecated methods
5. ALWAYS split Java code into multiple files - one class per file, NO exceptions
6. Each Java class MUST be its own separate .java file
7. Never put multiple top-level classes in a single Java file
8. Include ALL required files for a compilable mod
9. The mod must fully implement the described feature
10. In build.gradle set: sourceCompatibility = ${javaVersionEnum} and targetCompatibility = ${javaVersionEnum}
11. Do NOT use Java features newer than Java ${javaMajor} (no records, sealed classes, etc. unless Java ${javaMajor} supports them)
12. Include ONLY files directly required by the request. Do not add placeholder items, example blocks, example configs, or template systems unless the request needs them.
13. Do not generate files with names like ExampleItem, ExampleBlock, Test, Placeholder, Sample, Demo, or unused registries.

REQUIRED MULTI-FILE JAVA STRUCTURE:
- src/main/java/com/codexmc/<modid>/<ModId>Mod.java  (main entry point only)
- Add registries, handlers, worldgen, config, mixins, data files, or helper classes only when the described feature requires them.
- If the request is terrain/world generation focused, prefer worldgen classes and data files, not item/block boilerplate.
- If the request does not mention items or blocks, do not generate item/block classes or registries.

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
    "src/main/java/com/codexmc/examplemod/ExampleMod.java": "package com.codexmc.examplemod;\\n\\nimport ...\\n\\npublic class ExampleMod { ... }",
    "src/main/java/com/codexmc/examplemod/worldgen/TerrainNoiseRouter.java": "package com.codexmc.examplemod.worldgen;\\n\\n...",
    "build.gradle": "...",
    "settings.gradle": "...",
    "src/main/resources/fabric.mod.json": "...",
    "src/main/resources/pack.mcmeta": "...",
    "src/main/resources/data/examplemod/worldgen/...": "..."
  }
}`;
}

function normalizeFileContent(relPath, content) {
  if (typeof content !== 'string') return String(content ?? '');

  const isSerializedWholeFile =
    !content.includes('\n') &&
    /\\n|\\r\\n|\\"|\\t/.test(content);

  let normalized = content;

  if (isSerializedWholeFile) {
    normalized = normalized
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  return normalized;
}

async function writeGradleWrapper(workDir, mcVersion, loader) {
  const gradleVersion = getGradleVersion(mcVersion, loader);
  const javaMajor = requiredJavaMajor(mcVersion);
  const javaHome = resolveJavaHome(javaMajor) || process.env.JAVA_HOME || '';
  const javaExec = javaHome ? path.join(javaHome, 'bin', 'java') : 'java';

  const gradleDir = path.join(workDir, 'gradle', 'wrapper');
  await fs.ensureDir(gradleDir);

  await fs.writeFile(path.join(gradleDir, 'gradle-wrapper.properties'),
    `distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists\n`
  );

  // Hardcode the correct java binary so gradlew always uses the right JDK
  const gradlew = `#!/bin/sh\nAPP_HOME="$(cd "$(dirname "$0")" && pwd)"\nexec "${javaExec}" -jar "$APP_HOME/gradle/wrapper/gradle-wrapper.jar" "$@"\n`;
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

    if (javaHome) {
      env.JAVA_HOME = javaHome;
      // Prepend the correct JDK bin to PATH so Gradle's own toolchain detection
      // can't accidentally pick up the system Java (e.g. Java 25)
      env.PATH = path.join(javaHome, 'bin') + path.delimiter + (env.PATH || '');
    }

    // Tell Gradle explicitly which JVM to use for the build daemon
    if (javaHome) {
      env.GRADLE_OPTS = `-Dorg.gradle.java.home=${javaHome}`;
    }

    const gradlew = path.join(workDir, 'gradlew');
    const cmd = fs.existsSync(gradlew) ? gradlew : 'gradle';

    emit('build', `Building with Java ${javaMajor} + Gradle ${getGradleVersion(mcVersion, loader)}...`);

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

function validateMod(mod, request = {}) {
  if (!mod.modId || typeof mod.modId !== 'string') throw new Error('Missing modId');
  if (!mod.files || typeof mod.files !== 'object') throw new Error('Missing files');
  if (Object.keys(mod.files).length === 0) throw new Error('No files generated');
  const javaFiles = Object.keys(mod.files).filter(f => f.endsWith('.java'));
  if (javaFiles.length === 0) throw new Error('No Java files generated');
  if (!Object.keys(mod.files).some(f => f === 'build.gradle' || f === 'build.gradle.kts')) throw new Error('No build.gradle generated');
  const forbiddenPlaceholders = /(example|placeholder|sample|demo|test)/i;
  const placeholderFile = Object.keys(mod.files).find(file => forbiddenPlaceholders.test(path.basename(file)));
  if (placeholderFile) throw new Error(`Generated placeholder file not allowed: ${placeholderFile}`);

  const prompt = (request.description || '').toLowerCase();
  const terrainFocused = /(terrain|mountain|valley|river|worldgen|world generation|noise)/.test(prompt);
  const mentionsItems = /\bitem|weapon|sword|tool|armor|block\b/.test(prompt);
  if (terrainFocused && !mentionsItems) {
    const unrelatedGameplayFile = Object.keys(mod.files).find(file => /\/(item|block)\//.test(file) || /ModItems|ModBlocks/.test(file));
    if (unrelatedGameplayFile) {
      throw new Error(`Terrain-focused request should not include unrelated item/block boilerplate: ${unrelatedGameplayFile}`);
    }
  }
  // Log how many Java files were generated
  return { javaFileCount: javaFiles.length };
}

function buildFabricSettingsGradle(rootName) {
  return `pluginManagement {
    repositories {
        maven {
            name = 'Fabric'
            url = 'https://maven.fabricmc.net/'
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

rootProject.name = '${rootName}'`;
}

function buildFabricBuildGradle({ modId, version, mcVersion, loaderVersion }) {
  const javaMajor = requiredJavaMajor(mcVersion);
  const javaVersionEnum = getJavaVersionString(mcVersion);

  return `plugins {
    id '${getFabricLoomPluginId(mcVersion)}' version '${getFabricLoom(mcVersion)}'
    id 'maven-publish'
}

version = '${version}'
group = 'com.codexmc'

base {
    archivesName = '${modId}'
}

repositories {
    maven { url = 'https://maven.fabricmc.net/' } // ✅ CRITICAL FIX
    mavenCentral()
}

dependencies {
    minecraft "com.mojang:minecraft:${mcVersion}"
    mappings loom.officialMojangMappings()
    modImplementation "net.fabricmc:fabric-loader:${loaderVersion || '0.15.11'}"
    modImplementation "net.fabricmc.fabric-api:fabric-api:${getFabricApi(mcVersion)}"
}

processResources {
    inputs.property "version", project.version

    filesMatching("fabric.mod.json") {
        expand "version": inputs.properties.version
    }
}

tasks.withType(JavaCompile).configureEach {
    it.options.release = ${javaMajor}
}

java {
    withSourcesJar()
    sourceCompatibility = ${javaVersionEnum}
    targetCompatibility = ${javaVersionEnum}
}

publishing {
    publications {
        mavenJava(MavenPublication) {
            from components.java
        }
    }
}`;
}

function inferFabricEntrypoint(mod) {
  const javaFiles = Object.entries(mod.files).filter(([file]) => file.endsWith('.java'));
  const preferred = javaFiles.find(([, content]) => /implements\s+ModInitializer\b/.test(content))
    || javaFiles.find(([, content]) => /\bonInitialize\s*\(/.test(content))
    || javaFiles.find(([file]) => /src\/main\/java\/com\/codexmc\/[^/]+\/[^/]+\.java$/.test(file))
    || javaFiles[0];

  if (!preferred) return 'com.codexmc.examplemod.ExampleMod';

  const [file] = preferred;
  const className = path.basename(file, '.java');
  const packageMatch = file.match(/^src\/main\/java\/(.+)\/[^/]+\.java$/);
  const packageName = packageMatch ? packageMatch[1].replace(/\//g, '.') : `com.codexmc.${mod.modId || 'examplemod'}`;
  return `${packageName}.${className}`;
}

function buildFabricModJson({ modId, modName, version, description, entrypoint, javaMajor }) {
  return `${JSON.stringify({
    schemaVersion: 1,
    id: modId,
    version: '${version}',
    name: modName,
    description,
    authors: ['CodexMC'],
    contact: {},
    license: 'All Rights Reserved',
    environment: '*',
    entrypoints: {
      main: [entrypoint],
    },
    depends: {
      fabricloader: '>=0.15.11',
      minecraft: '*',
      java: `>=${javaMajor}`,
      'fabric-api': '*',
    },
  }, null, 2)}\n`;
}

function buildDefaultPackMcmeta(description) {
  return `{
  "pack": {
    "pack_format": 15,
    "description": "${description.replace(/"/g, '\\"')}"
  }
}
`;
}

function normalizeGeneratedMod(mod, request) {
  const normalized = {
    ...mod,
    files: { ...mod.files },
  };

  if (request.loader !== 'fabric') return normalized;

  const modId = (normalized.modId || 'examplemod').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const modName = normalized.modName || modId;
  const version = normalized.version || '1.0.0';
  const description = normalized.description || request.description;
  const entrypoint = inferFabricEntrypoint(normalized);

  normalized.files['settings.gradle'] = buildFabricSettingsGradle(modId);
  normalized.files['build.gradle'] = buildFabricBuildGradle({
    modId,
    version,
    mcVersion: request.mcVersion,
    loaderVersion: request.loaderVersion,
  });
  normalized.files['src/main/resources/fabric.mod.json'] = buildFabricModJson({
    modId,
    modName,
    version,
    description,
    entrypoint,
    javaMajor: requiredJavaMajor(request.mcVersion),
  });

  if (!normalized.files['src/main/resources/pack.mcmeta']) {
    normalized.files['src/main/resources/pack.mcmeta'] = buildDefaultPackMcmeta(description);
  }

  delete normalized.files['src/main/resources/META-INF/mods.toml'];
  delete normalized.files['build.gradle.kts'];
  delete normalized.files['settings.gradle.kts'];
  return normalized;
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
    emit('status', `Using OpenRouter coding models (${config.openrouter.codingPrimaryModel} -> ${config.openrouter.codingFallbackModel})`);
    emit('pipeline', 'Stage 1/4: tokenization and semantic mapping');
    emit('ai', `Prompt: "${request.description}"`);

    const promptFactory = (req, analysis, architecture) => buildPrompt(req, analysis, architecture);
    const helpers = {
      javaMajor: requiredJavaMajor(request.mcVersion),
      javaVersionEnum: getJavaVersionString(request.mcVersion),
      gradleVersion: getGradleVersion(request.mcVersion, request.loader),
      maxTokens: config.openrouter.maxTokens,
      temperature: config.openrouter.temperature,
      preferredModel: config.openrouter.codingPrimaryModel,
      fallbackModel: config.openrouter.codingFallbackModel,
      promptFactory,
    };

    const plan = await buildResponsePlan(request, helpers, emit);
    emit('pipeline', 'Stage 2/4: architecture prediction complete');
    emit('pipeline', 'Stage 3/4: iterative code generation');

    const validateGeneratedMod = (mod) => validateMod(mod, request);
    const generation = await generateProjectFromPlan(request, plan, helpers, emit, validateGeneratedMod);
    let mod = generation.mod;
    emit('ai', `Model selected: ${generation.modelUsed}`);
    if (generation.repaired) {
      emit('pipeline', 'Stage 4/4: repair pass completed');
    } else {
      emit('pipeline', 'Stage 4/4: validation completed without repair');
    }

    mod = normalizeGeneratedMod(mod, request);
    validateMod(mod, request);

    const modId = mod.modId.toLowerCase().replace(/[^a-z0-9]/g, '');
    const javaFiles = Object.keys(mod.files).filter(f => f.endsWith('.java'));
    emit('files', `Mod ID: ${modId}`);
    emit('files', `Writing ${Object.keys(mod.files).length} files (${javaFiles.length} Java files)...`);

    for (const [relPath, content] of Object.entries(mod.files)) {
      const fullPath = path.join(workDir, relPath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, normalizeFileContent(relPath, content), 'utf8');
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
      pipeline: {
        tokenCount: plan.analysis.tokenization.approximateTokenCount,
        intent: plan.analysis.vectorization.inferredIntent,
        modelUsed: generation.modelUsed,
        architectureModel: plan.architectureModel,
        repaired: generation.repaired,
      },
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
