/**
 * CodexMC v5 - AI-powered Minecraft Mod Generator (Stateful Fix Engine)
 * Features: Auto-deps, Multi-module, IDE Run Configs, Context-Aware Fixing
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

function requiredJavaMajor(mcVersion) {
  const parts = mcVersion.split('.').map(Number);
  const minor = parts[1] || 0;
  if (minor >= 21) return 21; if (minor >= 18) return 17;
  if (minor === 17) return 16; return 8;
}

function getGradleVersion(mcVersion, loader) {
  const parts = mcVersion.split('.').map(Number);
  const minor = parts[1] || 0;
  if (loader === 'fabric') { if (minor >= 21) return '8.8'; if (minor >= 20) return '8.3'; if (minor >= 18) return '7.4.2'; return '7.1'; }
  if (loader === 'neoforge') return '8.8';
  if (loader === 'forge') { if (minor >= 21) return '8.8'; if (minor >= 20) return '8.3'; if (minor >= 18) return '7.4.2'; if (minor === 17) return '7.1'; return '6.9.4'; }
  return '8.8';
}

function getFabricLoom(mcVersion) {
  const [, minor] = mcVersion.split('.').map(Number);
  if (minor >= 21) return '1.6.1'; if (minor >= 20) return '1.5.8';
  if (minor >= 18) return '0.12.12'; return '0.10';
}

function getFabricApi(mcVersion) {
  const map = { '1.21.1': '0.116.9+1.21.1', '1.21': '0.102.0+1.21', '1.20.4': '0.97.0+1.20.4', '1.20.1': '0.92.2+1.20.1', '1.19.4': '0.87.2+1.19.4' };
  if (map[mcVersion]) return map[mcVersion];
  const fallback = Object.entries(map).find(([version]) => mcVersion.startsWith(version));
  return fallback ? fallback[1] : '0.92.2+1.20.1';
}

function getJavaVersionString(mcVersion) {
  const major = requiredJavaMajor(mcVersion);
  if (major === 21) return 'JavaVersion.VERSION_21'; if (major === 17) return 'JavaVersion.VERSION_17';
  if (major === 16) return 'JavaVersion.VERSION_16'; return 'JavaVersion.VERSION_1_8';
}

// ==========================================
// CONTEXT LOADER (Reads previous chat/job)
// ==========================================
async function loadPreviousJobContext(previousJobId) {
  const prevWorkDir = path.join(WORKSPACE_DIR, previousJobId);
  if (!await fs.pathExists(prevWorkDir)) {
    throw new Error(`Previous job ${previousJobId} not found in workspace.`);
  }

  const originalFiles = {};
  const extensions = ['.java', '.json', '.gradle', '.toml'];
  async function readDirRecursive(dir) {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'build' && item.name !== 'gradle') {
        await readDirRecursive(fullPath);
      } else if (item.isFile() && extensions.some(ext => item.name.endsWith(ext))) {
        const relPath = path.relative(prevWorkDir, fullPath);
        originalFiles[relPath] = (await fs.readFile(fullPath, 'utf8')).trim();
      }
    }
  }
  await readDirRecursive(prevWorkDir);
  return { files: originalFiles, workDir: prevWorkDir };
}

// ==========================================
// PROMPT GENERATORS (NEW vs FIX)
// ==========================================
function buildNewPrompt(req, analysis, architecture) {
  const { description, loader, mcVersion, loaderVersion, thinkingLevel } = req;
  const loaderUpper = loader.toUpperCase();
  const javaMajor = requiredJavaMajor(mcVersion);
  const moduleInstructions = (loader === 'forge' || loader === 'neoforge') ? `\n- Put client-only code (rendering, GUIs) in: "src/client/java/com/codexmc/..."\n- Put shared code (registries, packets) in: "src/main/java/com/codexmc/..."\n- Put server-only code in: "src/server/java/com/codexmc/..."` : `\n- Put client-only code in "src/main/java/com/codexmc/..." but wrap classes with @Environment(EnvType.CLIENT)`;

  return `You are an expert Minecraft mod developer. Generate a complete, working, multi-file Minecraft mod.
REQUIREMENTS:
- Mod description: ${description}
- Mod loader: ${loaderUpper} | Minecraft: ${mcVersion} | Loader Version: ${loaderVersion}
- Java version: ${javaMajor}
 ${moduleInstructions}
CRITICAL RULES:
1. Output ONLY a valid JSON object - no markdown, no code fences
2. Split Java code into multiple files - one class per file
3. DO NOT GENERATE build.gradle, settings.gradle, mods.toml, or fabric.mod.json. The system generates these.
JSON ESCAPING: Escape backslashes as \\\\ and quotes as \\". Newlines as \\n.
OUTPUT FORMAT:
{
  "modId": "examplemod",
  "modName": "Example Mod",
  "version": "1.0.0",
  "description": "what the mod does",
  "files": {
    "src/main/java/com/codexmc/examplemod/ExampleMod.java": "..."
  }
}`;
}

function buildFixPrompt(req, originalContext) {
  const { description, loader, mcVersion } = req;
  
  const existingFilesString = Object.entries(originalContext.files)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join('\n\n');

  return `You are an expert Minecraft mod developer. You are fixing/updating an EXISTING mod based on user feedback.
USER REQUEST: "${description}"

EXISTING MOD FILES:
 ${existingFilesString}

CRITICAL FIX RULES:
1. DO NOT GENERATE A BRAND NEW MOD. You must edit the existing code provided above.
2. Output ONLY a valid JSON object containing the EXACT SAME "modId", "modName", "version", and "description".
3. In the "files" object, ONLY include files that you actually changed or added. DO NOT include files that you did not modify.
4. If you modify a file, include its COMPLETE new content, not just a diff.
5. Keep the exact same package structure, loader APIs, and mod structure unless the fix explicitly requires changing them.
6. DO NOT output build.gradle, settings.gradle, or metadata files unless the fix requires a new dependency.
JSON ESCAPING: Escape backslashes as \\\\ and quotes as \\". Newlines as \\n.
OUTPUT FORMAT:
{
  "modId": "existingmodid",
  "modName": "Existing Mod Name",
  "version": "1.0.0",
  "description": "original description",
  "files": {
    "src/main/java/com/codexmc/existingmod/SwordItem.java": "fixed code here..."
  }
}`;
}

function normalizeFileContent(relPath, content) {
  if (typeof content !== 'string') return String(content ?? '');
  const isSerializedWholeFile = !content.includes('\n') && /\\n|\\r\\n|\\"|\\t/.test(content);
  let normalized = content;
  if (isSerializedWholeFile) {
    normalized = normalized.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
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
  await fs.writeFile(path.join(gradleDir, 'gradle-wrapper.properties'), `distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists\n`);
  const gradlew = `#!/bin/sh\nAPP_HOME="$(cd "$(dirname "$0")" && pwd)"\nexec "${javaExec}" -jar "$APP_HOME/gradle/wrapper/gradle-wrapper.jar" "$@"\n`;
  await fs.writeFile(path.join(workDir, 'gradlew'), gradlew, { mode: 0o755 });
  const localJar = '/srv/codex/gradle/wrapper/gradle-wrapper.jar';
  if (await fs.pathExists(localJar)) await fs.copy(localJar, path.join(gradleDir, 'gradle-wrapper.jar'));
}

function buildMod(workDir, mcVersion, loader, emit) {
  return new Promise((resolve, reject) => {
    const javaMajor = requiredJavaMajor(mcVersion);
    const javaHome = resolveJavaHome(javaMajor);
    const env = { ...process.env };
    if (javaHome) { env.JAVA_HOME = javaHome; env.PATH = path.join(javaHome, 'bin') + path.delimiter + (env.PATH || ''); env.GRADLE_OPTS = `-Dorg.gradle.java.home=${javaHome}`; }
    const gradlew = path.join(workDir, 'gradlew');
    const cmd = fs.existsSync(gradlew) ? gradlew : 'gradle';
    emit('build', `Building with Java ${javaMajor} + Gradle ${getGradleVersion(mcVersion, loader)}...`);
    const proc = spawn(cmd, ['build', '--no-daemon', '--stacktrace'], { cwd: workDir, env, stdio: 'pipe' });
    let output = '';
    const onData = (d) => { const line = d.toString(); output += line; line.split('\n').filter(l => l.trim()).forEach(l => emit('build', l)); };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData);
    proc.on('close', code => code === 0 ? resolve(output) : reject(new Error(`Build failed (exit ${code})\n${output.slice(-2000)}`)));
    proc.on('error', reject);
    setTimeout(() => { proc.kill(); reject(new Error('Build timed out')); }, config.workspace.buildTimeout);
  });
}

async function zipDirectory(srcDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath); const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve); archive.on('error', reject); archive.pipe(output); archive.directory(srcDir, false); archive.finalize();
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
  const javaFiles = Object.keys(mod.files).filter(f => f.endsWith('.java'));
  if (javaFiles.length === 0) throw new Error('No Java files generated');
  return { javaFileCount: javaFiles.length };
}

// ==========================================
// DEPENDENCY AUTO-MATCHING ENGINE
// ==========================================
function injectDynamicDependencies(buildGradle, loader, mcVersion, files) {
  let modifiedGradle = buildGradle;
  const neededRepos = new Set(); const neededDeps = new Set();
  for (const content of Object.values(files)) {
    if (typeof content !== 'string') continue;
    if (content.includes('software.bernie.geckolib')) {
      if (loader === 'fabric') neededDeps.add(`modImplementation "software.bernie.geckolib:geckolib-fabric-${mcVersion}:4.2.4"`);
      else neededDeps.add(`implementation "software.bernie.geckolib:geckolib-${mcVersion}:4.2.4"`);
      neededRepos.add('maven { url = "https://dl.cloudsmith.io/public/geckolib3/geckolib/maven/" }');
    }
    if (content.includes('top.theillusivec4.curios')) {
      if (loader === 'fabric') neededDeps.add(`modImplementation "top.theillusivec4.curios:curios-fabric:${mcVersion}:+5.7.0"`);
      else neededDeps.add(`implementation "top.theillusivec4.curios:curios:${mcVersion}:+5.7.0"`);
      neededRepos.add('maven { url = "https://maven.theillusivec4.top/" }');
    }
  }
  if (neededRepos.size > 0) modifiedGradle = modifiedGradle.replace(/(repositories \{)/, `$1\n${Array.from(neededRepos).map(r => `        ${r}`).join('\n')}`);
  if (neededDeps.size > 0) modifiedGradle = modifiedGradle.replace(/(dependencies \{)/, `$1\n${Array.from(neededDeps).map(d => `    ${d}`).join('\n')}`);
  return modifiedGradle;
}

// ==========================================
// BUILD GENERATION SYSTEM
// ==========================================
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
  return `plugins {
    id 'fabric-loom' version '${getFabricLoom(mcVersion)}'
    id 'maven-publish'
}

version = '${version}'
group = 'com.codexmc'

base { archivesName = '${modId}' }

repositories {
    mavenCentral()
}

dependencies {
    minecraft "com.mojang:minecraft:${mcVersion}"
    mappings loom.layered() { officialMojangMappings() }
    modImplementation "net.fabricmc:fabric-loader:${loaderVersion || '0.15.11'}"
    modImplementation "net.fabricmc.fabric-api:fabric-api:${getFabricApi(mcVersion)}"
}

processResources {
    inputs.property "version", project.version
    filesMatching("fabric.mod.json") { expand "version": inputs.properties.version }
}

tasks.withType(JavaCompile).configureEach { it.options.release = ${javaMajor} }

java {
    toolchain { languageVersion = JavaLanguageVersion.of(${javaMajor}) }
    withSourcesJar()
    sourceCompatibility = ${getJavaVersionString(mcVersion)}
    targetCompatibility = ${getJavaVersionString(mcVersion)}
}

publishing {
    publications { mavenJava(MavenPublication) { from components.java } }
}`;
}

function buildForgeSettingsGradle(rootName) {
  return `pluginManagement {
    repositories {
        gradlePluginPortal()
        maven {
            url = 'https://maven.minecraftforge.net/'
        }
    }
}

rootProject.name = '${rootName}'`;
}

function buildForgeBuildGradle({ modId, version, mcVersion, loaderVersion }) {
  const javaMajor = requiredJavaMajor(mcVersion);
  return `plugins {
    id 'net.minecraftforge.gradle' version '[6.0,6.2)'
}

version = '${version}'
group = 'com.codexmc'

base { archivesName = '${modId}' }

sourceSets {
    main { resources { srcDirs = ["src/main/resources"] } }
    client { compileClasspath += main.output; runtimeClasspath += main.output }
    server { compileClasspath += main.output; runtimeClasspath += main.output }
}

java {
    toolchain { languageVersion = JavaLanguageVersion.of(${javaMajor}) }
    withSourcesJar()
}

minecraft {
    mappings channel: 'official', version: '${mcVersion}'
    copyIdeResources = true
    runs {
        client { workingDirectory project.file('run'); property 'forge.logging.markers', 'REGISTRIES'; mods { ${modId} { source sourceSets.main } } }
        server { workingDirectory project.file('run'); property 'forge.logging.markers', 'REGISTRIES'; mods { ${modId} { source sourceSets.main } } }
    }
}

dependencies {
    minecraft "net.minecraftforge:forge:${mcVersion}-${loaderVersion}"
}

tasks.withType(JavaCompile).configureEach { options.encoding = 'UTF-8' }

publishing {
    publications { register('mavenJava', MavenPublication) { from components.java } }
}`;
}

function buildNeoForgeSettingsGradle(rootName) {
  return `pluginManagement {
    repositories {
        gradlePluginPortal()
        maven {
            url = 'https://maven.neoforged.net/releases/'
        }
    }
}

rootProject.name = '${rootName}'`;
}

function buildNeoForgeBuildGradle({ modId, version, mcVersion, loaderVersion }) {
  const javaMajor = requiredJavaMajor(mcVersion);
  return `plugins {
    id 'java-library'
    id 'net.neoforged.moddev' version '2.0.28-beta'
}

version = '${version}'
group = 'com.codexmc'

base { archivesName = '${modId}' }

sourceSets {
    main { resources { srcDirs = ["src/main/resources"] } }
    client { compileClasspath += main.output; runtimeClasspath += main.output }
    server { compileClasspath += main.output; runtimeClasspath += main.output }
}

java {
    toolchain { languageVersion = JavaLanguageVersion.of(${javaMajor}) }
    withSourcesJar()
}

repositories { mavenLocal() }

neoForge {
    version = "${loaderVersion}"
    runs {
        client { client(); systemProperty 'neoforge.enabledGameTestNamespaces', project.mod_id }
        server { server(); programArgument '--nogui'; systemProperty 'neoforge.enabledGameTestNamespaces', project.mod_id }
    }
    mods { "${modId}" { sourceSet sourceSets.main } }
}

tasks.withType(JavaCompile).configureEach { options.encoding = 'UTF-8' }

publishing {
    publications { register('mavenJava', MavenPublication) { from components.java } }
}`;
}

// ==========================================
// METADATA & IDE RUN CONFIGS
// ==========================================
function inferEntrypoint(mod, fallbackId, type) {
  const javaFiles = Object.entries(mod.files).filter(([file]) => file.endsWith('.java'));
  let preferred = type === 'fabric' ? (javaFiles.find(([, c]) => /implements\s+ModInitializer\b/.test(c)) || javaFiles[0]) : (javaFiles.find(([, c]) => /@Mod\b/.test(c)) || javaFiles[0]);
  if (!preferred) return `com.codexmc.${fallbackId}.${fallbackId}Mod`;
  const [file] = preferred; const className = path.basename(file, '.java');
  const pkg = (file.match(/^src\/(?:main|client|server)\/java\/(.+)\/[^/]+\.java$/) || [])[1]?.replace(/\//g, '.') || `com.codexmc.${fallbackId}`;
  return `${pkg}.${className}`;
}

function buildFabricModJson({ modId, modName, version, description, entrypoint, javaMajor }) {
  return JSON.stringify({ schemaVersion: 1, id: modId, version, name: modName, description, authors: ['CodexMC'], contact: {}, license: 'All Rights Reserved', environment: '*', entrypoints: { main: [entrypoint] }, depends: { fabricloader: '>=0.15.11', minecraft: '*', java: `>=${javaMajor}`, 'fabric-api': '*' } }, null, 2);
}

function buildForgeModsToml({ modId, modName, version, description, mcVersion, loaderVersion }) {
  const major = (loaderVersion || '47').split('.')[0];
  return `modLoader="javafml"
loaderVersion="[${major},)"
license="All Rights Reserved"

[[mods]]
modId="${modId}"
version="${version}"
displayName="${modName}"
description=\'\'\'${description}\'\'\'

[[dependencies.${modId}]]
modId="forge"
mandatory=true
versionRange="[${major},)"
ordering="NONE"
side="BOTH"

[[dependencies.${modId}]]
modId="minecraft"
mandatory=true
versionRange="[${mcVersion},)"
ordering="NONE"
side="BOTH"`;
}

function buildNeoForgeModsToml({ modId, modName, version, description, mcVersion, loaderVersion }) {
  const parts = (loaderVersion || '20.4.167').split('.');
  return `modLoader="javafml"
loaderVersion="[4,)"
license="All Rights Reserved"

[[mods]]
modId="${modId}"
version="${version}"
displayName="${modName}"
description=\'\'\'${description}\'\'\'

[[dependencies.${modId}]]
modId="neoforge"
mandatory=true
versionRange="[${parts[0]}.${parts[1]},)"
ordering="NONE"
side="BOTH"

[[dependencies.${modId}]]
modId="minecraft"
mandatory=true
versionRange="[${mcVersion},)"
ordering="NONE"
side="BOTH"`;
}

function buildIDEConfigs(modId) {
  return {
    '.vscode/tasks.json': JSON.stringify({ version: "2.0.0", tasks: [ { label: "Run Client", type: "shell", command: "./gradlew runClient", problemMatcher: [], group: { kind: "build", isDefault: true } }, { label: "Build Mod", type: "shell", command: "./gradlew build", problemMatcher: [] } ] }, null, 2),
    '.idea/runConfigurations/Run_Client.xml': `<?xml version="1.0" encoding="UTF-8"?><component name="ProjectRunConfigurationManager"><configuration default="false" name="Run Client" type="GradleRunConfiguration" factoryName="Gradle"><ExternalSystemSettings><option name="executionName" /><option name="externalProjectPath" value="$PROJECT_DIR$" /><option name="externalSystemIdString" value="GRADLE" /><option name="scriptParameters" value="" /><option name="taskDescriptions"><list /></option><option name="taskNames"><list><option value="runClient" /></list></option><option name="vmOptions" value="" /></ExternalSystemSettings><method v="2" /></configuration></component>`
  };
}

function buildDefaultPackMcmeta(description) { 
  return JSON.stringify({ pack: { pack_format: 15, description: description.replace(/"/g, '\\"') } }, null, 2); 
}

// ==========================================
// MOD NORMALIZER & PIPELINE ORCHESTRATOR
// ==========================================
function normalizeGeneratedMod(mod, request, originalFiles = null) {
  const normalized = { ...mod, files: { ...mod.files } };
  const modId = (normalized.modId || 'examplemod').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const modName = normalized.modName || modId;
  const version = normalized.version || '1.0.0';
  const description = normalized.description || request.description;
  const mcVersion = request.mcVersion;
  const loaderVersion = request.loaderVersion;

  delete normalized.files['build.gradle.kts']; 
  delete normalized.files['settings.gradle.kts'];
  let buildGradle = '';

  if (request.loader === 'fabric') {
    const entrypoint = inferEntrypoint(normalized, modId, 'fabric');
    normalized.files['settings.gradle'] = buildFabricSettingsGradle(modId);
    buildGradle = buildFabricBuildGradle({ modId, version, mcVersion, loaderVersion });
    normalized.files['src/main/resources/fabric.mod.json'] = buildFabricModJson({ modId, modName, version, description, entrypoint, javaMajor: requiredJavaMajor(mcVersion) });
    delete normalized.files['src/main/resources/META-INF/mods.toml'];
    delete normalized.files['src/main/resources/META-INF/neoforge.mods.toml'];
  } else if (request.loader === 'forge') {
    normalized.files['settings.gradle'] = buildForgeSettingsGradle(modId);
    buildGradle = buildForgeBuildGradle({ modId, version, mcVersion, loaderVersion });
    normalized.files['src/main/resources/META-INF/mods.toml'] = buildForgeModsToml({ modId, modName, version, description, mcVersion, loaderVersion });
    delete normalized.files['src/main/resources/fabric.mod.json'];
    delete normalized.files['src/main/resources/META-INF/neoforge.mods.toml'];
  } else if (request.loader === 'neoforge') {
    normalized.files['settings.gradle'] = buildNeoForgeSettingsGradle(modId);
    buildGradle = buildNeoForgeBuildGradle({ modId, version, mcVersion, loaderVersion });
    normalized.files['src/main/resources/META-INF/neoforge.mods.toml'] = buildNeoForgeModsToml({ modId, modName, version, description, mcVersion, loaderVersion });
    delete normalized.files['src/main/resources/fabric.mod.json'];
    delete normalized.files['src/main/resources/META-INF/mods.toml'];
  }

  if (!normalized.files['src/main/resources/pack.mcmeta']) {
    normalized.files['src/main/resources/pack.mcmeta'] = buildDefaultPackMcmeta(description);
  }

  // Merge original files if this is a fix request (so we don't lose untouched files)
  if (originalFiles) {
    for (const [key, val] of Object.entries(originalFiles)) {
      if (!normalized.files[key]) {
        normalized.files[key] = val;
      }
    }
  }

  buildGradle = injectDynamicDependencies(buildGradle, request.loader, mcVersion, normalized.files);
  normalized.files['build.gradle'] = buildGradle;

  const ideConfigs = buildIDEConfigs(modId);
  for (const [p, c] of Object.entries(ideConfigs)) normalized.files[p] = c;

  return normalized;
}

// ==========================================
// MAIN GENERATION PIPELINE
// ==========================================
async function generateMod(request, onProgress) {
  const jobId = uuidv4();
  const workDir = path.join(WORKSPACE_DIR, jobId);
  const isFixRequest = !!request.previousJobId;
  
  function emit(type, message) { logger.info(`[${type}] ${message}`); if (onProgress) onProgress({ type, message, jobId }); }

  try {
    await fs.ensureDir(workDir);
    emit('status', isFixRequest ? `Starting FIX pass for Job: ${request.previousJobId}` : `Starting mod generation (Job: ${jobId})`);

    let originalContext = null;
    let promptFactory;

    if (isFixRequest) {
      emit('pipeline', 'Loading previous mod context...');
      originalContext = await loadPreviousJobContext(request.previousJobId);
      promptFactory = (req) => buildFixPrompt(req, originalContext);
      if (!request.mcVersion) request.mcVersion = '1.21.1'; 
      if (!request.loaderVersion) request.loaderVersion = '0.16.9'; 
    } else {
      promptFactory = (req, analysis, architecture) => buildNewPrompt(req, analysis, architecture);
    }

    const helpers = {
      javaMajor: requiredJavaMajor(request.mcVersion), javaVersionEnum: getJavaVersionString(request.mcVersion),
      gradleVersion: getGradleVersion(request.mcVersion, request.loader), maxTokens: config.openrouter.maxTokens,
      temperature: config.openrouter.temperature, preferredModel: config.openrouter.codingPrimaryModel,
      fallbackModel: config.openrouter.codingFallbackModel, promptFactory,
    };

    let mod;
    if (isFixRequest) {
      emit('pipeline', 'Sending fix request to AI...');
      const fakePlan = { analysis: { tokenization: { approximateTokenCount: 0 }, vectorization: { inferredIntent: 'fix', topTerms: [] } }, architectureModel: 'fix' };
      const generation = await generateProjectFromPlan(request, fakePlan, helpers, emit, validateMod);
      mod = generation.mod;
    } else {
      emit('pipeline', 'Stage 1/4: tokenization and semantic mapping');
      const plan = await buildResponsePlan(request, helpers, emit);
      emit('pipeline', 'Stage 2/4: architecture prediction complete');
      emit('pipeline', 'Stage 3/4: iterative code generation');
      const generation = await generateProjectFromPlan(request, plan, helpers, emit, validateMod);
      mod = generation.mod;
      emit('pipeline', 'Stage 4/4: validation completed');
    }

    mod = normalizeGeneratedMod(mod, request, isFixRequest ? originalContext.files : null);
    validateMod(mod);

    const modId = mod.modId.toLowerCase().replace(/[^a-z0-9]/g, '');
    emit('files', `Mod ID: ${modId} | Writing ${Object.keys(mod.files).length} files...`);

    for (const [relPath, content] of Object.entries(mod.files)) {
      const fullPath = path.join(workDir, relPath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, normalizeFileContent(relPath, content), 'utf8');
    }

    await writeGradleWrapper(workDir, request.mcVersion, request.loader);

    const sourceZipPath = path.join(workDir, `${modId}-source.zip`);
    emit('build', 'Creating source ZIP...');
    await zipDirectory(workDir, sourceZipPath);

    emit('build', 'Compiling with Gradle...');
    let jarPath = null, buildSuccess = false, buildError = null;

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

    return {
      jobId, modId, modName: mod.modName || modId, version: mod.version || '1.0.0',
      description: mod.description || request.description, loader: request.loader, mcVersion: request.mcVersion,
      isFix: isFixRequest, previousJobId: request.previousJobId || null,
      files: Object.keys(mod.files), sourceZipPath, jarPath, buildSuccess, buildError, workDir,
    };
  } catch (error) {
    emit('error', `Generation failed: ${error.message}`);
    throw error;
  }
}

module.exports = { generateMod };
