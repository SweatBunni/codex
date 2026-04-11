/**
 * CodexMC AI Generation Service (ULTIMATE VERSION)
 * - Self-healing AI generator
 * - Auto compile validation
 * - Retry systems
 * - Java + Gradle safety layer
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const { spawn, execSync } = require('child_process');

const MISTRAL_API = 'https://api.mistral.ai/v1/chat/completions';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/tmp/codexmc-workspaces';
const TEMPLATE_GRADLE_DIR = process.env.TEMPLATE_GRADLE_DIR || '/srv/codex/gradletmp';

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

function getFabricLoomVersion(mcVersion) {
  const [, majorMinor] = mcVersion.split('.');
  const versionMap = {
    '1.21': '1.8-SNAPSHOT',
    '1.20': '1.7-SNAPSHOT',
    '1.19': '1.6-SNAPSHOT',
    '1.18': '1.4-SNAPSHOT',
    '1.17': '1.2-SNAPSHOT',
    '1.16': '0.12-SNAPSHOT',
    default: '1.7-SNAPSHOT'
  };
  return versionMap[majorMinor] || versionMap.default;
}

function getFabricApiVersion(mcVersion) {
  if (!mcVersion) return '0.100.0+1.21';
  const [, minor] = mcVersion.split('.').map(Number);
  // Map Minecraft versions to stable Fabric API versions
  if (minor >= 21) return '0.100.0+1.21';
  if (minor >= 20) return '0.91.0+1.20.1';
  if (minor >= 19) return '0.75.0+1.19.2';
  if (minor >= 18) return '0.58.0+1.18.2';
  if (minor >= 17) return '0.47.0+1.17.1';
  return '0.47.0+1.17.1';
}

// ─────────────────────────────────────────────
// RETRY WRAPPER (AI + BUILD)
// ─────────────────────────────────────────────

async function retry(fn, times = 2) {
  let last;
  for (let i = 0; i <= times; i++) {
    try { return await fn(i); }
    catch (e) { last = e; }
  }
  throw last;
}

/**
 * Extracts compile errors from build output.
 * Returns array of error objects with file, line, message.
 */
function parseCompileErrors(buildOutput) {
  const errors = [];
  const lines = buildOutput.split('\n');
  
  for (const line of lines) {
    // Match: /path/to/File.java:10: error: message
    const match = line.match(/(.+?\.java):(\d+):\s+error:\s+(.+)/);
    if (match) {
      errors.push({
        file: match[1],
        line: parseInt(match[2]),
        message: match[3]
      });
    }
  }
  
  return errors;
}

// ─────────────────────────────────────────────
// AUTO FIX SYSTEMS
// ─────────────────────────────────────────────

function autoFixJava(files) {
  const out = {};

  for (const [file, content] of Object.entries(files)) {
    if (!file.endsWith('.java')) {
      out[file] = content;
      continue;
    }

    let code = content;
    const name = path.basename(file, '.java');

    if (!code.includes(`class ${name}`)) {
      code = code.replace(/public class \w+/, `public class ${name}`);
    }

    if (!code.includes('package ') && file.includes('java')) {
      const pkg = file
        .split('/')
        .slice(0, -1)
        .join('.')
        .replace('src.main.java.', '');
      code = `package ${pkg};\n\n` + code;
    }

    out[file] = code;
  }

  return out;
}

async function fixGradle(workDir) {
  const file = path.join(workDir, 'build.gradle');
  if (!await fs.pathExists(file)) return;

  let g = await fs.readFile(file, 'utf8');

  // Step 1: Count braces to see if file is balanced
  const openCount = (g.match(/\{/g) || []).length;
  const closeCount = (g.match(/\}/g) || []).length;
  
  // Step 2: Remove extra closing braces at the end
  if (closeCount > openCount) {
    // Find the last closing brace
    for (let i = 0; i < closeCount - openCount; i++) {
      g = g.replace(/\}\s*$/, '');
    }
  }

  // Step 3: Fix pluginManagement if present (belongs in settings.gradle)
  if (g.includes('pluginManagement')) {
    g = g.replace(/pluginManagement\s*\{[\s\S]*?\}\s*/m, '');
  }

  // Step 4: Replace problematic yarn mappings
  if (g.includes('yarn:') || g.includes('net.fabricmc:yarn')) {
    g = g.replace(/mappings\s+['"]net\.fabricmc:yarn:[^'"]+['"]/g, "mappings loom.officialMojangMappings()");
  }

  // Step 5: Fix officialMojangMappings format
  if (g.includes('officialMojangMappings') && !g.includes('loom.officialMojangMappings()')) {
    g = g.replace(/officialMojangMappings/g, 'loom.officialMojangMappings()');
  }

  // Step 6: Keep Fabric API dependencies as-is (they're now provided with correct versions)
  // Just verify they're not using obviously bad versions
  g = g.replace(/('net\.fabricmc\.fabric-api:fabric-api:)([^'"]*')/, (match, prefix, version) => {
    // If version looks obviously wrong (like old invalid versions), keep it - fixSettings will handle it
    return match;
  });
  
  // Step 7: Ensure proper structure - add repositories if missing
  if (!g.includes('repositories')) {
    // Find where to insert (after plugins block)
    const pluginsEnd = g.indexOf('plugins');
    if (pluginsEnd !== -1) {
      const nextBrace = g.indexOf('}', pluginsEnd);
      if (nextBrace !== -1) {
        const insertPos = nextBrace + 1;
        g = g.slice(0, insertPos) + '\n\nrepositories {\n  mavenCentral()\n  maven {\n    url = "https://maven.fabricmc.net/"\n  }\n}' + g.slice(insertPos);
      }
    }
  } else if (!g.includes('mavenCentral')) {
    // repositories exists but missing mavenCentral
    g = g.replace(/repositories\s*\{/g, 'repositories {\n  mavenCentral()');
  }

  // Step 8: Clean up excess whitespace
  g = g.replace(/\n\s*\n\s*\n/g, '\n\n');
  
  // Step 9: Ensure file ends with single closing brace and newline
  g = g.trim();
  if (!g.endsWith('}')) {
    g = g + '\n}';
  }
  g = g + '\n';

  await fs.writeFile(file, g);
}

async function fixSettings(workDir) {
  const settingsFile = path.join(workDir, 'settings.gradle');
  const buildFile = path.join(workDir, 'build.gradle');

  // If build.gradle has pluginManagement, extract it to settings.gradle
  if (await fs.pathExists(buildFile)) {
    let build = await fs.readFile(buildFile, 'utf8');
    const pluginMgmtMatch = build.match(/pluginManagement\s*\{[\s\S]*?\}/);
    
    if (pluginMgmtMatch) {
      // Create or update settings.gradle with the extracted pluginManagement
      let settings = '';
      if (await fs.pathExists(settingsFile)) {
        settings = await fs.readFile(settingsFile, 'utf8');
      }
      
      // Add pluginManagement at the START if not already present
      if (!settings.includes('pluginManagement')) {
        settings = pluginMgmtMatch[0] + '\n\n' + settings;
        await fs.writeFile(settingsFile, settings);
      }

      // Remove from build.gradle
      build = build.replace(/pluginManagement\s*\{[\s\S]*?\}\s*/m, '');
      await fs.writeFile(buildFile, build);
    }
  }

  // Ensure settings.gradle has proper format
  if (await fs.pathExists(settingsFile)) {
    let settings = await fs.readFile(settingsFile, 'utf8');
    
    // pluginManagement MUST be first; move it if it isn't
    if (settings.includes('pluginManagement')) {
      const pluginMgmtMatch = settings.match(/(pluginManagement\s*\{[\s\S]*?\})/m);
      if (pluginMgmtMatch) {
        const pluginMgmt = pluginMgmtMatch[0];
        // Remove pluginManagement from its current position
        settings = settings.replace(pluginMgmt, '').trim();
        // Add it back at the start
        settings = pluginMgmt + '\n\n' + settings;
      }
    } else {
      // pluginManagement doesn't exist, add it at the start
      const pluginMgmt = `pluginManagement {
  repositories {
    maven {
      name = 'Fabric'
      url = 'https://maven.fabricmc.net/'
    }
    gradlePluginPortal()
  }
}`;
      settings = pluginMgmt + '\n\n' + settings;
    }
    
    // Add rootProject.name if missing - MUST be AFTER pluginManagement
    if (!settings.includes('rootProject.name')) {
      // Add after the pluginManagement block
      settings = settings.replace(
        /(pluginManagement\s*\{[\s\S]*?\})/,
        '$1\n\nrootProject.name = \'modproject\''
      );
    }
    
    // Fix common mistake: Fabric() method instead of proper maven block
    if (settings.includes('Fabric()') || settings.includes('Fabric {')) {
      settings = settings.replace(
        /Fabric\s*\{[^}]*\}/g,
        `maven {
      name = 'Fabric'
      url = 'https://maven.fabricmc.net/'
    }`
      );
    }
    
    // Fix: missing proper maven block syntax
    if (settings.includes('maven {') && !settings.includes('name =')) {
      settings = settings.replace(
        /maven\s*\{\s*url\s*=\s*['"]https:\/\/maven\.fabricmc\.net\/["']\s*\}/g,
        `maven {
      name = 'Fabric'
      url = 'https://maven.fabricmc.net/'
    }`
      );
    }
    
    await fs.writeFile(settingsFile, settings);
  }
}

// ─────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────

function validate(mod) {
  if (!mod.files) throw new Error('Missing files');
  if (!mod.modId) throw new Error('Missing modId');
}

// ─────────────────────────────────────────────
// THINKING LEVEL CONFIG
// ─────────────────────────────────────────────

const THINKING_CONFIGS = {
  low: {
    model: 'mistral-7b-instruct-v0.3',
    max_tokens: 4000,
    temperature: 0.3,
    extraSystemNote: 'Be concise. Generate only required files.',
  },
  medium: {
    model: 'mistral-7b-instruct-v0.3',
    max_tokens: 8000,
    temperature: 0.25,
    extraSystemNote: 'Include proper mod structure and registration.',
  },
  high: {
    model: 'mistral-large',
    max_tokens: 16000,
    temperature: 0.2,
    extraSystemNote: 'Deep production-grade Minecraft mod with full correctness.',
  },
};

// ─────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────

function buildSystemPrompt(request, thinkingLevel) {
  const cfg = THINKING_CONFIGS[thinkingLevel] || THINKING_CONFIGS.medium;
  const loader = request.loader || 'fabric';
  const mcVersion = request.mcVersion || '1.21.1';
  const loomVer = loader === 'fabric' ? getFabricLoomVersion(mcVersion) : '';
  const fabricApiVer = loader === 'fabric' ? getFabricApiVersion(mcVersion) : '';
  const loaderVer = request.loaderVersion || '';

  let loaderInstructions = '';
  if (loader === 'fabric') {
    loaderInstructions = `
CRITICAL FABRIC REQUIREMENTS:

settings.gradle MUST start with pluginManagement (FIRST), then rootProject name:
pluginManagement {
  repositories {
    maven {
      name = 'Fabric'
      url = 'https://maven.fabricmc.net/'
    }
    gradlePluginPortal()
  }
}

rootProject.name = 'modname'

build.gradle MUST start with:
plugins {
  id 'fabric-loom' version '${loomVer}'
  id 'maven-publish'
}

repositories {
  mavenCentral()
  maven {
    url = 'https://maven.fabricmc.net/'
  }
}

dependencies {
  minecraft 'com.mojang:minecraft:${mcVersion}'
  mappings loom.officialMojangMappings()
  modImplementation 'net.fabricmc:fabric-loader:0.15.11'
  modImplementation 'net.fabricmc.fabric-api:fabric-api:${fabricApiVer}'
}

CRITICAL: Use loom.officialMojangMappings() instead of yarn mappings. Yarn mappings can cause "Unsupported unpick version" errors.

INCLUDE Fabric API in dependencies with version: ${fabricApiVer}

fabric.mod.json EXACT FORMAT: 
{
  "schemaVersion": 1,
  "version": "1.0.0",
  "name": "Your Mod Name",
  "description": "A simple mod",
  "authors": ["You"],
  "contact": {},
  "license": "MIT",
  "icon": "assets/icon.png",
  "environment": "*",
  "entrypoints": {
    "main": ["com.example.yourmod.YourMod"]
  },
  "mixins": [],
  "depends": {
    "fabricloader": ">=0.14.0",
    "minecraft": "${mcVersion}",
    "java": ">=17"
  }
}

CRITICAL JAVA CODE GUIDELINES FOR ${mcVersion}:
- DO NOT use net.minecraft.command.* packages - they don't exist
- DO NOT use net.minecraft.server.command.* packages - they don't exist  
- DO NOT use net.minecraft.text.Text - use net.minecraft.text.Text from fabric-api
- Keep Java code MINIMAL - only implement ModInitializer.onInitialize()
- For commands or advanced features, ask the user to provide specifications
- Default mod should just log a message when initializing`;
  } else if (loader === 'forge') {
    loaderInstructions = `
FORGE REQUIREMENTS:

plugins {
  id 'net.minecraftforge.gradle' version '6.+'
  id 'java'
}

For Forge: minecraft_version='${mcVersion}'
forge_version='${loaderVer || '52.0.29'}'  // Use provided loaderVersion or latest stable`;
  } else if (loader === 'neoforge') {
    loaderInstructions = `
NEOFORGE REQUIREMENTS:

plugins {
  id 'neoforge'
}

neoforge_version='${loaderVer || '21.1.77'}'
minecraft_version='${mcVersion}'`;
  }

  return `You are an expert Minecraft mod developer. Generate COMPLETE production-ready mods.

${cfg.extraSystemNote}

${loaderInstructions}

IMPORTANT:
- Use EXACT plugin versions above
- All files MUST be valid and COMPLETE
- Include BOTH settings.gradle AND build.gradle
- settings.gradle: pluginManagement MUST be FIRST, then rootProject.name
- build.gradle: plugins first, then repositories, then dependencies
- Do NOT put pluginManagement in build.gradle (settings.gradle ONLY)
- Return COMPLETE file contents with proper \\n escapes
- File content must be valid Gradle/Java/JSON syntax
- DO NOT include optional comments in file contents

JAVA CODE SAFETY:
- For simple mods, ONLY use: ModInitializer, org.slf4j.Logger
- DO NOT import net.minecraft.command.* - these don't exist in ${mcVersion}
- DO NOT import net.minecraft.server.command.* - these don't exist
- DO NOT import net.minecraft.text.Text or net.minecraft.text.* directly
- If user asks for commands/blocks/items, ask what specific feature first
- Keep example code MINIMAL - it should compile without errors

Return ONLY valid JSON (absolutely no markdown, no code blocks, pure JSON):
{
  "modName": "ExampleMod",
  "modId": "example-mod",
  "packageName": "com.example.examplemod",
  "mcVersion": "${mcVersion}",
  "files": {
    "settings.gradle": "pluginManagement {\\n  repositories {\\n    maven {\\n      name = 'Fabric'\\n      url = 'https://maven.fabricmc.net/'\\n    }\\n    gradlePluginPortal()\\n  }\\n}\\n\\nrootProject.name = 'example-mod'",
    "build.gradle": "plugins {\\n  id 'fabric-loom' version '${loomVer}'\\n  id 'maven-publish'\\n}\\n\\nrepositories {\\n  mavenCentral()\\n  maven {\\n    url = 'https://maven.fabricmc.net/'\\n  }\\n}\\n\\ndependencies {\\n  minecraft 'com.mojang:minecraft:${mcVersion}'\\n  mappings loom.officialMojangMappings()\\n  modImplementation 'net.fabricmc:fabric-loader:0.15.11'\\n  modImplementation 'net.fabricmc.fabric-api:fabric-api:${fabricApiVer}'\\n}",
    "gradle.properties": "org.gradle.jvmargs=-Xmx1G",
    "src/main/resources/fabric.mod.json": "{\\"schemaVersion\\":1,\\"id\\":\\"example-mod\\",\\"version\\":\\"1.0.0\\",\\"name\\":\\"ExampleMod\\",\\"description\\":\\"A mod\\",\\"environment\\":\\"*\\",\\"entrypoints\\":{\\"main\\":[\\"com.example.examplemod.ExampleMod\\"]},\\"mixins\\":[],\\"depends\\":{\\"fabricloader\\":\\">=0.14.0\\",\\"minecraft\\":\\"${mcVersion}\\",\\"java\\":\\">=17\\"}}",
    "src/main/java/com/example/examplemod/ExampleMod.java": "package com.example.examplemod;\\n\\nimport net.fabricmc.api.ModInitializer;\\nimport org.slf4j.Logger;\\nimport org.slf4j.LoggerFactory;\\n\\npublic class ExampleMod implements ModInitializer {\\n  public static final String MOD_ID = \\\"example-mod\\\";\\n  public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);\\n\\n  @Override\\n  public void onInitialize() {\\n    LOGGER.info(\\\"Hello from ExampleMod!\\\");\\n  }\\n}"
  }
}`;
}

function buildUserPrompt(req) {
  return `Create a ${req.loader} mod for Minecraft ${req.mcVersion}.

Detailed mod request: ${req.prompt}

Make sure to follow all loader-specific instructions in system prompt exactly.`;
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
  if (start === -1) throw new Error('No JSON object found in AI response');
  
  let json = cleaned.slice(start);

  try { 
    return JSON.parse(json); 
  } catch (e) {
    // Fix common AI JSON mistakes
    
    // 1. Remove trailing commas before } or ]
    json = json.replace(/,\s*([}\]])/g, '$1');
    
    // 2. Fix unquoted property names that are valid (simple identifiers)
    json = json.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
    
    // 3. Fix single quotes to double quotes in property names
    json = json.replace(/'([^']*)'(\s*:)/g, '"$1"$2');
    
    try {
      return JSON.parse(json);
    } catch (e2) {
      // Try truncating to last complete object
      const last = json.lastIndexOf('}');
      if (last !== -1 && last > 10) {
        try {
          return JSON.parse(json.slice(0, last + 1));
        } catch (e3) {
          // Continue to error below
        }
      }
      
      throw new Error(`Invalid JSON from AI response: ${e.message}\nTry to find valid JSON in: ${json.slice(0, 200)}...`);
    }
  }
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
    const buildOutput = [];

    let javaHome;
    try {
      javaHome = resolveJavaHome(javaMajor);
    } catch (err) {
      return reject(err);
    }

    // Clean up stale gradle daemon locks and caches
    const gradleLockFile = path.join(workDir, '.gradle', 'daemon', '*.lock');
    const logsDir = path.join(workDir, '.gradle', 'daemon');
    try {
      if (fs.existsSync(logsDir)) {
        const files = fs.readdirSync(logsDir);
        files.forEach(f => {
          if (f.endsWith('.lock')) {
            try { fs.unlinkSync(path.join(logsDir, f)); } catch { }
          }
        });
      }
    } catch { }

    emit('info', `Using Java ${javaMajor} (${javaHome})`);

    const cmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

    const proc = spawn(cmd, ['clean', 'build', '--no-daemon', '--warning-mode=none'], {
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

    proc.stdout.on('data', d => {
      const lines = d.toString().split('\n');
      lines.forEach(l => {
        if (l.trim()) {
          emit('build', l);
          buildOutput.push(l);
        }
      });
    });

    proc.stderr.on('data', d => {
      const lines = d.toString().split('\n');
      lines.forEach(l => {
        if (l.trim()) {
          emit('warn', l);
          buildOutput.push(l);
        }
      });
    });

    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(buildOutput.join('\n')));
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
  const conversationHistory = [];

  function emit(type, msg) {
    if (onProgress) onProgress({ type, message: msg, workId });
  }

  await fs.ensureDir(workDir);
  emit('info', 'Starting AI generation...');

  // Step 1: Initial generation
  const systemPrompt = buildSystemPrompt(request, request.thinkingLevel);
  const userPrompt = buildUserPrompt(request);
  
  const initialResponse = await retry(async () => axios.post(MISTRAL_API, {
    model: THINKING_CONFIGS[request.thinkingLevel || 'medium'].model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt }
    ]
  }, {
    headers: {
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
      'Content-Type': 'application/json'
    }
  }));

  const aiFirstResponse = initialResponse.data.choices[0].message.content;
  
  conversationHistory.push({
    timestamp: new Date().toISOString(),
    sender: 'User',
    message: userPrompt,
    type: 'initial_request'
  });
  
  conversationHistory.push({
    timestamp: new Date().toISOString(),
    sender: 'AI',
    message: aiFirstResponse,
    type: 'initial_response'
  });

  let modData = extractJSON(aiFirstResponse);
  validate(modData);
  modData.files = autoFixJava(modData.files);

  for (const filePath of Object.keys(modData.files)) {
    const fullPath = path.join(workDir, filePath);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, modData.files[filePath]);
  }

  await fixGradle(workDir);
  await fixSettings(workDir);
  await writeGradleWrapper(workDir, request.mcVersion);
  
  // Step 2: Try to build - if it fails, ask AI to fix errors
  let buildAttempts = 0;
  let buildSuccess = false;
  let lastError = null;

  while (buildAttempts < 3 && !buildSuccess) {
    buildAttempts++;
    emit('info', `Building mod (attempt ${buildAttempts}/3)...`);
    
    try {
      await retry(() => buildMod(workDir, request.mcVersion, emit), 0); // Single attempt, no internal retries
      buildSuccess = true;
    } catch (err) {
      lastError = err;
      const errorMsg = err.message || err.toString();
      emit('warn', `Build failed: ${errorMsg}`);
      
      // Try to extract and parse compile errors
      const compileErrors = parseCompileErrors(errorMsg);
      
      if (compileErrors.length > 0 && buildAttempts < 3) {
        emit('info', 'Sending compilation errors to AI for fixing...');
        
        const errorSummary = compileErrors
          .slice(0, 10) // First 10 errors
          .map(e => `Line ${e.line}: ${e.message}`)
          .join('\n');

        const fixPrompt = `COMPILATION ERRORS TO FIX:
${errorSummary}

CRITICAL FIX INSTRUCTIONS:
1. These errors mean the imported packages do NOT exist in Minecraft ${request.mcVersion}
2. DO NOT try to use net.minecraft.command.*, net.minecraft.server.command.*, or other missing packages
3. ONLY use these guaranteed-to-exist packages:
   - net.fabricmc.api.ModInitializer (for main entry point)
   - org.slf4j.Logger, org.slf4j.LoggerFactory (for logging)
   - net.fabricmc.fabric.api.* (for Fabric API features that EXIST)
4. For MOST mods, just implement ModInitializer and log in onInitialize()
5. If the mod request requires specific features (like commands, blocks, items), keep it SIMPLE

Please regenerate ONLY the Java source files (.java files) to fix these errors.
Use simple, safe code that definitely compiles.
Keep Gradle config unchanged.

Return ONLY the corrected "files" object with the complete "files" JSON structure.`;

        try {
          emit('info', `Sending fix request to AI with errors:\n${errorSummary}`);
          
          const fixResponse = await axios.post(MISTRAL_API, {
            model: THINKING_CONFIGS[request.thinkingLevel || 'medium'].model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
              { role: 'assistant', content: aiFirstResponse },
              { role: 'user', content: fixPrompt }
            ]
          }, {
            headers: {
              Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
              'Content-Type': 'application/json'
            }
          });

          const aiFixResponse = fixResponse.data.choices[0].message.content;
          
          conversationHistory.push({
            timestamp: new Date().toISOString(),
            sender: 'User',
            message: fixPrompt,
            type: 'error_fix_request',
            errors: errorSummary
          });
          
          conversationHistory.push({
            timestamp: new Date().toISOString(),
            sender: 'AI',
            message: aiFixResponse,
            type: 'error_fix_response'
          });

          const fixedData = extractJSON(aiFixResponse);
          
          // Merge fixed files with existing ones
          modData.files = { ...modData.files, ...fixedData.files };
          modData.files = autoFixJava(modData.files);

          // Write updated Java files
          for (const filePath of Object.keys(modData.files)) {
            if (filePath.endsWith('.java')) {
              const fullPath = path.join(workDir, filePath);
              await fs.ensureDir(path.dirname(fullPath));
              await fs.writeFile(fullPath, modData.files[filePath]);
            }
          }
          
          emit('info', `Applied AI fixes, retrying build...`);
        } catch (fixErr) {
          emit('warn', `Error getting AI fix: ${fixErr.message}`);
        }
      } else {
        break; // Don't retry further if no compile errors found or max attempts reached
      }
    }
  }

  if (!buildSuccess) {
    throw lastError || new Error('Build failed after multiple attempts');
  }

  const jarPath = path.join(workDir, 'build/libs');
  emit('done', { workId, modName: modData.modName, jarPath });

  // Save conversation history to workspace for reference
  const historyFile = path.join(workDir, 'ai-conversation-history.json');
  await fs.writeFile(historyFile, JSON.stringify({
    workId,
    modName: modData.modName,
    modId: modData.modId,
    loader: request.loader,
    mcVersion: request.mcVersion,
    createdAt: new Date().toISOString(),
    conversations: conversationHistory
  }, null, 2));

  return { success: true, workId };
}

module.exports = { generateMod };
