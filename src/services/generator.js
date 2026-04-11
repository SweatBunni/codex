/**
 * CodexMC v6 - AI-powered Minecraft Mod Generator (Auto-Fix Engine)
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const { execSync, spawn } = require('child_process');
const config = require('../config');
const { logger } = require('../utils/logger');
const { buildResponsePlan, generateProjectFromPlan, checkLMStudioHealth } = require('./responsePipeline');

const WORKSPACE_DIR = path.resolve(config.workspace.dir);
const MAX_AUTO_FIX_RETRIES = 2;

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

async function loadPreviousJobContext(previousJobId) {
  const prevWorkDir = path.join(WORKSPACE_DIR, previousJobId);
  if (!await fs.pathExists(prevWorkDir)) throw new Error(`Previous job ${previousJobId} not found.`);
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

function buildNewPrompt(req) {
  const { description, loader, mcVersion, loaderVersion } = req;
  const javaMajor = requiredJavaMajor(mcVersion);
  const moduleInstructions = (loader === 'forge' || loader === 'neoforge') ? `\n- Put client-only code in: "src/client/java/com/codexmc/..."\n- Put shared code in: "src/main/java/com/codexmc/..."` : '';
  return `You are an expert Minecraft mod developer. Generate a complete, working, multi-file Minecraft mod.
REQUIREMENTS:
- Mod description: ${description}
- Mod loader: ${loader.toUpperCase()} | Minecraft: ${mcVersion} | Loader Version: ${loaderVersion}
- Java version: ${javaMajor}
 ${moduleInstructions}

CRITICAL RULES:
1. Output ONLY a raw JSON object. Absolutely NO markdown, NO \`\`\`json code fences, NO commentary before or after.
2. Split Java code into multiple files - one class per file.
3. DO NOT GENERATE build.gradle, settings.gradle, mods.toml, or fabric.mod.json. The system generates these automatically.
4. The "files" JSON key MUST be an object containing at least one ".java" file.
5. Escape all backslashes in Java source as \\\\ and double-quotes as \\". Newlines as \\n.

OUTPUT FORMAT - You must output EXACTLY this structure, nothing else:
{
  "modId": "examplemod",
  "modName": "Example Mod",
  "version": "1.0.0",
  "description": "what the mod does",
  "files": {
    "src/main/java/com/codexmc/examplemod/ExampleMod.java": "package com.codexmc.examplemod;\\n\\npublic class ExampleMod {\\n    // code here\\n}"
  }
}`;
}

function buildFixPrompt(req, originalContext) {
  const existingFilesString = Object.entries(originalContext.files).map(([p, c]) => `--- ${p} ---\n${c}`).join('\n\n');
  return `You are an expert Minecraft mod developer fixing an EXISTING mod.
USER REQUEST: "${req.description}"

EXISTING MOD FILES:
 ${existingFilesString}

CRITICAL FIX RULES:
1. Output ONLY a raw JSON object. NO markdown, NO \`\`\`json code fences.
2. DO NOT GENERATE A BRAND NEW MOD.
3. Output EXACTLY this JSON structure, including the SAME modId, modName, version, and description:
{
  "modId": "existingmodid",
  "modName": "Existing Mod Name",
  "version": "1.0.0",
  "description": "original description",
  "files": {
    "src/main/java/com/codexmc/examplemod/File.java": "fixed code here..."
  }
}
4. In the "files" object, ONLY include files that you actually changed.
5. Provide the COMPLETE new content for modified files.
6. DO NOT output build.gradle, settings.gradle, or metadata files.
7. Escape backslashes as \\\\ and quotes as \\". Newlines as \\n.`;
}

function buildAutoFixPrompt(request, errorLogs) {
  return `The Gradle build for this Minecraft mod failed with Java compiler errors. You MUST fix these exact errors.
MINECRAFT VERSION: ${request.mcVersion}
MOD LOADER: ${request.loader}

BUILD ERRORS:
 ${errorLogs}

CRITICAL RULES:
1. Output ONLY a raw JSON object. NO markdown, NO \`\`\`json code fences.
2. You MUST include the exact keys "modId", "modName", "version", "description", and "files" in your JSON.
3. In the "files" object, ONLY include files that you modified to fix the errors. Do NOT include unchanged files.
4. Provide the COMPLETE new content for any modified file.
5. Ensure all imports actually exist for Minecraft ${request.mcVersion} ${request.loader}.
6. DO NOT output build.gradle, settings.gradle, or metadata files.

OUTPUT FORMAT:
{
  "modId": "autofixmod",
  "modName": "Auto Fix Mod",
  "version": "1.0.0",
  "description": "auto fix",
  "files": {
    "src/main/java/com/codexmc/examplemod/BrokenFile.java": "fixed code here..."
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
    const proc = spawn(cmd, ['build', '--no-daemon', '--stacktrace'], { cwd: workDir, env, stdio: 'pipe' });
    let output = '';
    const onData = (d) => { const line = d.toString(); output += line; line.split('\n').filter(l => l.trim()).forEach(l => emit('build', l)); };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData);
    proc.on('close', code => code === 0 ? resolve(output) : reject(new Error(output)));
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
  if (javaFiles.length === 0) throw new Error('Missing files');
  return { javaFileCount: javaFiles.length };
}

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

function buildFabricSettingsGradle(rootName) { return `pluginManagement {\n    repositories {\n        maven {\n            name = 'Fabric'\n            url = 'https://maven.fabricmc.net/'\n        }\n        mavenCentral()\n        gradlePluginPortal()\n    }\n}\n\nrootProject.name = '${rootName}'`; }
function buildFabricBuildGradle({ modId, version, mcVersion, loaderVersion }) { const javaMajor = requiredJavaMajor(mcVersion); return `plugins {\n    id 'fabric-loom' version '${getFabricLoom(mcVersion)}'\n    id 'maven-publish'\n}\n\nversion = '${version}'\ngroup = 'com.codexmc'\n\nbase { archivesName = '${modId}' }\n\nrepositories {\n    mavenCentral()\n}\n\ndependencies {\n    minecraft "com.mojang:minecraft:${mcVersion}"\n    mappings loom.layered() { officialMojangMappings() }\n    modImplementation "net.fabricmc:fabric-loader:${loaderVersion || '0.15.11'}"\n    modImplementation "net.fabricmc.fabric-api:fabric-api:${getFabricApi(mcVersion)}"\n}\n\nprocessResources {\n    inputs.property "version", project.version\n    filesMatching("fabric.mod.json") { expand "version", inputs.properties.version }\n}\n\ntasks.withType(JavaCompile).configureEach { it.options.release = ${javaMajor} }\n\njava {\n    toolchain { languageVersion = JavaLanguageVersion.of(${javaMajor}) }\n    withSourcesJar()\n    sourceCompatibility = ${getJavaVersionString(mcVersion)}\n    targetCompatibility = ${getJavaVersionString(mcVersion)}\n}\n\npublishing {\n    publications { mavenJava(MavenPublication) { from components.java } }\n}`; }
function buildForgeSettingsGradle(rootName) { return `pluginManagement {\n    repositories {\n        gradlePluginPortal()\n        maven {\n            url = 'https://maven.minecraftforge.net/'\n        }\n    }\n}\n\nrootProject.name = '${rootName}'`; }
function buildForgeBuildGradle({ modId, version, mcVersion, loaderVersion }) { const javaMajor = requiredJavaMajor(mcVersion); return `plugins {\n    id 'net.minecraftforge.gradle' version '[6.0,6.2)'\n}\n\nversion = '${version}'\ngroup = 'com.codexmc'\n\nbase { archivesName = '${modId}' }\n\nsourceSets {\n    main { resources { srcDirs = ["src/main/resources"] } }\n    client { compileClasspath += main.output; runtimeClasspath += main.output }\n    server { compileClasspath += main.output; runtimeClasspath += main.output }\n}\n\njava {\n    toolchain { languageVersion = JavaLanguageVersion.of(${javaMajor}) }\n    withSourcesJar()\n}\n\nminecraft {\n    mappings channel: 'official', version: '${mcVersion}'\n    copyIdeResources = true\n    runs {\n        client { workingDirectory project.file('run'); property 'forge.logging.markers', 'REGISTRIES'; mods { ${modId} { source sourceSets.main } } }\n        server { workingDirectory project.file('run'); property 'forge.logging.markers', 'REGISTRIES'; mods { ${modId} { source sourceSets.main } } }\n    }\n}\n\ndependencies {\n    minecraft "net.minecraftforge:forge:${mcVersion}-${loaderVersion}"\n}\n\ntasks.withType(JavaCompile).configureEach { options.encoding = 'UTF-8' }\n\npublishing {\n    publications { register('mavenJava', MavenPublication) { from components.java } }\n}`; }
function buildNeoForgeSettingsGradle(rootName) { return `pluginManagement {\n    repositories {\n        gradlePluginPortal()\n        maven {\n            url = 'https://maven.neoforged.net/releases/'\n        }\n    }\n}\n\nrootProject.name = '${rootName}'`; }
function buildNeoForgeBuildGradle({ modId, version, mcVersion, loaderVersion }) { const javaMajor = requiredJavaMajor(mcVersion); return `plugins {\n    id 'java-library'\n    id 'net.neoforged.moddev' version '2.0.28-beta'\n}\n\nversion = '${version}'\ngroup = 'com.codexmc'\n\nbase { archivesName = '${modId}' }\n\nsourceSets {\n    main { resources { srcDirs = ["src/main/resources"] } }\n    client { compileClasspath += main.output; runtimeClasspath += main.output }\n    server { compileClasspath += main.output; runtimeClasspath += main.output }\n}\n\njava {\n    toolchain { languageVersion = JavaLanguageVersion.of(${javaMajor}) }\n    withSourcesJar()\n}\n\nrepositories { mavenLocal() }\n\nneoForge {\n    version = "${loaderVersion}"\n    runs {\n        client { client(); systemProperty 'neoforge.enabledGameTestNamespaces', project.mod_id }\n        server { server(); programArgument '--nogui'; systemProperty 'neoforge.enabledGameTestNamespaces', project.mod_id }\n    }\n    mods { "${modId}" { sourceSet sourceSets.main } }\n}\n\ntasks.withType(JavaCompile).configureEach { options.encoding = 'UTF-8' }\n\npublishing {\n    publications { register('mavenJava', MavenPublication) { from components.java } }\n}`; }

function inferEntrypoint(mod, fallbackId, type) {
  const javaFiles = Object.entries(mod.files).filter(([file]) => file.endsWith('.java'));
  let preferred = type === 'fabric' ? (javaFiles.find(([, c]) => /implements\s+ModInitializer\b/.test(c)) || javaFiles[0]) : (javaFiles.find(([, c]) => /@Mod\b/.test(c)) || javaFiles[0]);
  if (!preferred) return `com.codexmc.${fallbackId}.${fallbackId}Mod`;
  const [file] = preferred; const className = path.basename(file, '.java');
  const pkg = (file.match(/^src\/(?:main|client|server)\/java\/(.+)\/[^/]+\.java$/) || [])[1]?.replace(/\//g, '.') || `com.codexmc.${fallbackId}`;
  return `${pkg}.${className}`;
}

function buildFabricModJson({ modId, modName, version, description, entrypoint, javaMajor }) { return JSON.stringify({ schemaVersion: 1, id: modId, version, name: modName, description, authors: ['CodexMC'], contact: {}, license: 'All Rights Reserved', environment: '*', entrypoints: { main: [entrypoint] }, depends: { fabricloader: '>=0.15.11', minecraft: '*', java: `>=${javaMajor}`, 'fabric-api': '*' } }, null, 2); }
function buildForgeModsToml({ modId, modName, version, description, mcVersion, loaderVersion }) { const major = (loaderVersion || '47').split('.')[0]; return `modLoader="javafml"\nloaderVersion="[${major},)"\nlicense="All Rights Reserved"\n\n[[mods]]\nmodId="${modId}"\nversion="${version}"\ndisplayName="${modName}"\ndescription=\'\'\'${description}\'\'\'\n\n[[dependencies.${modId}]]\nmodId="forge"\nmandatory=true\nversionRange="[${major},)"\nordering="NONE"\nside="BOTH"\n\n[[dependencies.${modId}]]\nmodId="minecraft"\nmandatory=true\nversionRange="[${mcVersion},)"\nordering="NONE"\nside="BOTH"`; }
function buildNeoForgeModsToml({ modId, modName, version, description, mcVersion, loaderVersion }) { const parts = (loaderVersion || '20.4.167').split('.'); return `modLoader="javafml"\nloaderVersion="[4,)"\nlicense="All Rights Reserved"\n\n[[mods]]\nmodId="${modId}"\nversion="${version}"\ndisplayName="${modName}"\ndescription=\'\'\'${description}\'\'\'\n\n[[dependencies.${modId}]]\nmodId="neoforge"\nmandatory=true\nversionRange="[${parts[0]}.${parts[1]},)"\nordering="NONE"\nside="BOTH"\n\n[[dependencies.${modId}]]\nmodId="minecraft"\nmandatory=true\nversionRange="[${mcVersion},)"\nordering="NONE"\nside="BOTH"`; }

function buildIDEConfigs(modId) {
  return {
    '.vscode/tasks.json': JSON.stringify({ version: "2.0.0", tasks: [ { label: "Run Client", type: "shell", command: "./gradlew runClient", problemMatcher: [], group: { kind: "build", isDefault: true } }, { label: "Build Mod", type: "shell", command: "./gradlew build", problemMatcher: [] } ] }, null, 2),
    '.idea/runConfigurations/Run_Client.xml': `<?xml version="1.0" encoding="UTF-8"?><component name="ProjectRunConfigurationManager"><configuration default="false" name="Run Client" type="GradleRunConfiguration" factoryName="Gradle"><ExternalSystemSettings><option name="executionName" /><option name="externalProjectPath" value="$PROJECT_DIR$" /><option name="externalSystemIdString" value="GRADLE" /><option name="scriptParameters" value="" /><option name="taskDescriptions"><list /></option><option name="taskNames"><list><option value="runClient" /></list></option><option name="vmOptions" value="" /></ExternalSystemSettings><method v="2" /></configuration></component>`
  };
}

function buildDefaultPackMcmeta(description) { return JSON.stringify({ pack: { pack_format: 15, description: description.replace(/"/g, '\\"') } }, null, 2); }

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
    delete normalized.files['src/main/resources/META-INF/mods.toml']; delete normalized.files['src/main/resources/META-INF/neoforge.mods.toml'];
  } else if (request.loader === 'forge') {
    normalized.files['settings.gradle'] = buildForgeSettingsGradle(modId);
    buildGradle = buildForgeBuildGradle({ modId, version, mcVersion, loaderVersion });
    normalized.files['src/main/resources/META-INF/mods.toml'] = buildForgeModsToml({ modId, modName, version, description, mcVersion, loaderVersion });
    delete normalized.files['src/main/resources/fabric.mod.json']; delete normalized.files['src/main/resources/META-INF/neoforge.mods.toml'];
  } else if (request.loader === 'neoforge') {
    normalized.files['settings.gradle'] = buildNeoForgeSettingsGradle(modId);
    buildGradle = buildNeoForgeBuildGradle({ modId, version, mcVersion, loaderVersion });
    normalized.files['src/main/resources/META-INF/neoforge.mods.toml'] = buildNeoForgeModsToml({ modId, modName, version, description, mcVersion, loaderVersion });
    delete normalized.files['src/main/resources/fabric.mod.json']; delete normalized.files['src/main/resources/META-INF/mods.toml'];
  }

  if (!normalized.files['src/main/resources/pack.mcmeta']) normalized.files['src/main/resources/pack.mcmeta'] = buildDefaultPackMcmeta(description);
  if (originalFiles) { for (const [key, val] of Object.entries(originalFiles)) { if (!normalized.files[key]) normalized.files[key] = val; } }

  buildGradle = injectDynamicDependencies(buildGradle, request.loader, mcVersion, normalized.files);
  normalized.files['build.gradle'] = buildGradle;
  
  const ideConfigs = buildIDEConfigs(modId);
  for (const [p, c] of Object.entries(ideConfigs)) normalized.files[p] = c;
  return normalized;
}

async function generateMod(request, onProgress) {
  const jobId = uuidv4();
  const workDir = path.join(WORKSPACE_DIR, jobId);
  const isFixRequest = !!request.previousJobId;
  
  function emit(type, message) { logger.info(`[${type}] ${message}`); if (onProgress) onProgress({ type, message, jobId }); }

  try {
    await fs.ensureDir(workDir);
    emit('status', isFixRequest ? `Starting FIX pass for Job: ${request.previousJobId}` : `Starting mod generation (Job: ${jobId})`);

    // PRE-FLIGHT CHECK
    emit('pipeline', 'Verifying LM Studio connection...');
    await checkLMStudioHealth();
    emit('pipeline', 'LM Studio connected. Starting AI pipeline...');

    let originalContext = null;
    let promptFactory;

    if (isFixRequest) {
      emit('pipeline', 'Loading previous mod context...');
      originalContext = await loadPreviousJobContext(request.previousJobId);
      promptFactory = (req) => buildFixPrompt(req, originalContext);
      if (!request.mcVersion) request.mcVersion = '1.21.1'; 
      if (!request.loaderVersion) request.loaderVersion = '0.16.9'; 
    } else {
      promptFactory = (req) => buildNewPrompt(req);
    }

    const helpers = {
      javaMajor: requiredJavaMajor(request.mcVersion), 
      javaVersionEnum: getJavaVersionString(request.mcVersion),
      gradleVersion: getGradleVersion(request.mcVersion, request.loader), 
      maxTokens: 8000,
      temperature: 0.2,
      promptFactory,
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

    // ==========================================
    // AUTO-FIX COMPILATION LOOP
    // ==========================================
    emit('build', 'Compiling with Gradle...');
    let jarPath = null, buildSuccess = false, buildError = null;

    for (let attempt = 0; attempt <= MAX_AUTO_FIX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          emit('pipeline', `Auto-fix attempt ${attempt}/${MAX_AUTO_FIX_RETRIES}...`);
          const errorLogs = buildError.split('\n').filter(l => l.includes('.java:') && l.includes('error:')).join('\n');
          if (!errorLogs) { emit('warning', 'Build failed with non-fixable Gradle error.'); break; }

          const fixHelpers = { ...helpers, promptFactory: (req) => buildAutoFixPrompt(req, errorLogs) };
          const fakePlan = { analysis: { tokenization: { approximateTokenCount: 0 }, vectorization: { inferredIntent: 'autofix', topTerms: [] } }, architectureModel: 'autofix' };
          
          try {
            const fixGeneration = await generateProjectFromPlan(request, fakePlan, fixHelpers, emit, () => {});
            const fixedMod = fixGeneration.mod;
            for (const [relPath, content] of Object.entries(fixedMod.files)) {
              if (relPath.endsWith('.java')) {
                const fullPath = path.join(workDir, relPath);
                await fs.ensureDir(path.dirname(fullPath));
                await fs.writeFile(fullPath, normalizeFileContent(relPath, content), 'utf8');
                emit('pipeline', `Patched ${relPath}`);
              }
            }
          } catch (aiError) { emit('warning', `AI failed to generate patch: ${aiError.message}`); break; }
        }

        await buildMod(workDir, request.mcVersion, request.loader, attempt > 0 ? () => {} : emit);
        jarPath = await findJar(workDir);
        buildSuccess = true;
        emit('success', attempt > 0 ? `BUILD SUCCESSFUL (Fixed on attempt ${attempt})` : 'BUILD SUCCESSFUL');
        if (jarPath) emit('success', `JAR: ${path.basename(jarPath)}`);
        break;

      } catch (err) {
        buildError = err.message;
        if (attempt === MAX_AUTO_FIX_RETRIES) emit('warning', 'Compile failed after max auto-fix attempts');
      }
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
