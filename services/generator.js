/**
 * CodexMC — AI Generation Service
 * Free models via OpenRouter:
 *   Low:    deepseek/deepseek-chat-v3-0324:free  (fast)
 *   Medium: deepseek/deepseek-r1-0528:free        (reasoning)
 *   High:   deepseek/deepseek-r1-0528:free        (deep reasoning)
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
// THINKING LEVEL CONFIG
// Confirmed free model IDs on OpenRouter (April 2026)
// ─────────────────────────────────────────────

const THINKING_CONFIGS = {
  low: {
    model: 'qwen/qwen3-coder:free',
    max_tokens: 4000,
    temperature: 0.3,
    extraSystemNote: 'Be concise. Generate only the essential files needed for the mod.',
  },
  medium: {
    model: 'qwen/qwen3-coder:free',
    max_tokens: 8000,
    temperature: 0.25,
    extraSystemNote: 'Think carefully about the mod architecture. Include proper event handling and all required registrations.',
  },
  high: {
    model: 'qwen/qwen3-coder:free',
    max_tokens: 16000,
    temperature: 0.2,
    extraSystemNote: 'Think deeply and thoroughly. Consider all edge cases, proper Minecraft API usage, version compatibility, registration order, and common pitfalls. Generate complete, well-commented, production-quality code with all necessary files.',
  },
};

// ─────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────

function buildSystemPrompt(thinkingLevel) {
  const cfg = THINKING_CONFIGS[thinkingLevel] || THINKING_CONFIGS.medium;
  return `You are an expert Minecraft mod developer specializing in Java modding.

${cfg.extraSystemNote}

Return ONLY valid JSON — no markdown, no backticks, no explanations.
Ensure the JSON is COMPLETE and never truncated.

Required structure:
{
  "modName": "ExampleMod",
  "modId": "examplemod",
  "description": "A short description",
  "version": "1.0.0",
  "jdkRequired": "17",
  "gradlewNeeded": true,
  "files": {
    "build.gradle": "...",
    "settings.gradle": "...",
    "gradle/wrapper/gradle-wrapper.properties": "...",
    "src/main/java/com/codex/modid/ModNameMod.java": "...",
    "src/main/resources/META-INF/mods.toml": "...",
    "src/main/resources/pack.mcmeta": "..."
  }
}

Include ALL files needed to compile. For Fabric use fabric.mod.json instead of mods.toml.`;
}

function buildUserPrompt(req) {
  const loaderNote = {
    forge: `Use Forge ${req.loaderVersion || 'latest'} APIs. Use @Mod, @EventBusSubscriber, IEventBus. Register items/blocks via DeferredRegister.`,
    fabric: 'Use Fabric API. Implement ModInitializer. Use fabric.mod.json. Register via Registry.register.',
    neoforge: 'Use NeoForge APIs. Use @Mod and NeoForge event system and registries.',
  }[req.loader] || '';

  return `Create a ${req.loader} mod for Minecraft ${req.mcVersion}.
${loaderNote}

Mod request: ${req.prompt}

Return ONLY complete JSON with all required files.`;
}

// ─────────────────────────────────────────────
// JSON EXTRACTION
// ─────────────────────────────────────────────

function extractJSON(text) {
  if (!text) throw new Error('Empty AI response');

  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();

  const start = cleaned.indexOf('{');
  if (start === -1) throw new Error('No JSON object in AI response');

  let json = cleaned.slice(start);

  try { return JSON.parse(json); } catch {}

  try {
    let open = (json.match(/{/g) || []).length;
    let close = (json.match(/}/g) || []).length;
    while (close < open) { json += '}'; close++; }
    return JSON.parse(json);
  } catch {}

  const last = json.lastIndexOf('}');
  if (last !== -1) {
    try { return JSON.parse(json.slice(0, last + 1)); } catch {}
  }

  throw new Error('Could not parse AI response as JSON');
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
// BUILD
// ─────────────────────────────────────────────

function getJavaHome(version) {
  const map = {
    '8':  process.env.JDK_8_PATH  || '/opt/jdk/8',
    '17': process.env.JDK_17_PATH || '/opt/jdk/17',
    '21': process.env.JDK_21_PATH || '/opt/jdk/21',
    '25': process.env.JDK_25_PATH || '/opt/jdk/25',
  };
  return map[version] || map['17'];
}

function buildMod(workDir, emit) {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    try {
      const gw = path.join(workDir, 'gradlew');
      if (fs.existsSync(gw)) fs.chmodSync(gw, '755');
    } catch {}

    const proc = spawn(cmd, ['build', '--no-daemon'], {
      cwd: workDir,
      shell: true,
      env: { ...process.env, JAVA_HOME: getJavaHome('17') },
    });

    proc.stdout.on('data', d => d.toString().split('\n').forEach(l => l.trim() && emit('build', l)));
    proc.stderr.on('data', d => d.toString().split('\n').forEach(l => l.trim() && emit('warn', l)));
    proc.on('close', code => code !== 0 ? reject(new Error(`Gradle exited ${code}`)) : resolve());
    proc.on('error', reject);
  });
}

function findJar(workDir) {
  const dir = path.join(workDir, 'build', 'libs');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jar') && !f.includes('sources') && !f.includes('javadoc'));
  return files.length ? path.join(dir, files[0]) : null;
}

async function writeGradleWrapper(workDir) {
  const wrapperDir = path.join(workDir, 'gradle', 'wrapper');
  await fs.ensureDir(wrapperDir);
  const props = path.join(wrapperDir, 'gradle-wrapper.properties');
  if (!fs.existsSync(props)) {
    await fs.writeFile(props, `distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-8.1.1-bin.zip\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists\n`);
  }
}

// ─────────────────────────────────────────────
// AI CALL
// ─────────────────────────────────────────────

async function callAI(messages, thinkingLevel, retries) {
  if (thinkingLevel === undefined) thinkingLevel = 'medium';
  if (retries === undefined) retries = 2;

  const cfg = THINKING_CONFIGS[thinkingLevel] || THINKING_CONFIGS.medium;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey || apiKey === 'your_openrouter_api_key_here') {
    throw new Error('OPENROUTER_API_KEY not set. Get a free key at https://openrouter.ai/keys');
  }

  console.log('[AI] model=' + cfg.model + ' thinking=' + thinkingLevel + ' max_tokens=' + cfg.max_tokens);

  let res;
  try {
    res = await axios.post(
      OPENROUTER_API,
      {
        model: cfg.model,
        messages: messages,
        temperature: cfg.temperature,
        max_tokens: cfg.max_tokens,
      },
      {
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.SITE_URL || 'https://codexmc.net',
          'X-Title': 'CodexMC',
        },
        timeout: 180000,
        validateStatus: function() { return true; },
      }
    );
  } catch (netErr) {
    if (retries <= 0) throw new Error('Network error: ' + netErr.message);
    console.warn('[AI] Network error, retrying (' + retries + ' left):', netErr.message);
    await new Promise(function(r) { setTimeout(r, 3000); });
    return callAI(messages, thinkingLevel, retries - 1);
  }

  if (res.status !== 200) {
    const body = res.data;
    const msg = (body && body.error && body.error.message) || (body && body.message) || JSON.stringify(body);
    console.error('[AI] HTTP ' + res.status + ':', msg);

    if (res.status === 404) {
      throw new Error('Model not found: "' + cfg.model + '". Visit openrouter.ai/models for valid model IDs.');
    }
    if (res.status === 401) {
      throw new Error('Invalid OpenRouter API key. Check OPENROUTER_API_KEY in your .env file.');
    }
    if (res.status === 429) {
      if (retries <= 0) throw new Error('Rate limit hit. Wait a moment and try again.');
      await new Promise(function(r) { setTimeout(r, 5000); });
      return callAI(messages, thinkingLevel, retries - 1);
    }
    throw new Error('OpenRouter ' + res.status + ': ' + msg);
  }

  const content = res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content;
  if (!content) {
    console.error('[AI] Empty content. Response:', JSON.stringify(res.data));
    throw new Error('AI returned an empty response. Try again.');
  }

  console.log('[AI] Got response: ' + content.length + ' chars');
  return content;
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function generateMod(request, onProgress) {
  const workId = uuidv4();
  const workDir = path.join(WORKSPACE_DIR, workId);
  const thinkingLevel = request.thinkingLevel || 'medium';

  function emit(type, msg) {
    if (onProgress) onProgress({ type: type, message: msg, workId: workId });
  }

  try {
    await fs.ensureDir(workDir);

    emit('thinking_start', thinkingLevel);

    const thinkLabels = { low: '⚡ Fast mode', medium: '🧩 Reasoning mode', high: '🧠 Deep chain-of-thought' };
    emit('info', '🚀 Starting mod generation...');
    emit('ai', '🤖 Model: ' + THINKING_CONFIGS[thinkingLevel].model);
    emit('ai', (thinkLabels[thinkingLevel] || '') + ' active');
    emit('info', '📦 ' + request.loader + ' · MC ' + request.mcVersion);
    emit('info', '💡 ' + request.prompt);
    emit('info', '');
    emit('ai', 'Calling AI... (30–120s depending on thinking level)');

    const aiText = await callAI(
      [
        { role: 'system', content: buildSystemPrompt(thinkingLevel) },
        { role: 'user', content: buildUserPrompt(request) },
      ],
      thinkingLevel
    );

    emit('thinking_end', null);
    emit('ai', '✅ AI response received — parsing...');

    let modData;
    try {
      modData = extractJSON(aiText);
    } catch (e) {
      emit('error', 'JSON parse failed: ' + e.message);
      throw e;
    }

    emit('success', '✨ Mod "' + (modData.modName || 'Unknown') + '" generated');
    emit('info', '');
    emit('info', '📁 Writing project files...');

    const files = modData.files || {};
    for (const filePath of Object.keys(files)) {
      const content = files[filePath];
      const fullPath = path.join(workDir, filePath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, content, 'utf8');
      emit('file', '  📄 ' + filePath);
    }

    await writeGradleWrapper(workDir);

    emit('info', '');
    emit('info', '🗜️  Creating source ZIP...');
    const sourceZipPath = path.join(workDir, 'source.zip');
    await zipDirectory(workDir, sourceZipPath);
    emit('success', '✅ source.zip ready');

    let buildSuccess = false;
    let jarPath = null;

    emit('info', '');
    emit('build', '🏗️  Running Gradle build...');
    emit('build', '');

    try {
      await buildMod(workDir, emit);
      jarPath = findJar(workDir);
      buildSuccess = !!jarPath;

      if (buildSuccess) {
        emit('success', '');
        emit('success', '✅ BUILD SUCCESSFUL');
        emit('success', '🎉 ' + path.basename(jarPath) + ' is ready!');
      } else {
        emit('warn', '⚠️  Build succeeded but JAR not found');
      }
    } catch (buildErr) {
      emit('warn', '');
      emit('warn', '⚠️  Build failed: ' + buildErr.message);
      emit('warn', 'Source ZIP is still available for download.');
    }

    emit('info', '');
    emit('done', '🏁 Generation complete!');

    return {
      success: true,
      modName: modData.modName || 'YourMod',
      modId: modData.modId || 'yourmod',
      workId: workId,
      buildSuccess: buildSuccess,
      downloads: {
        source: '/download/source/' + workId,
        jar: (buildSuccess && jarPath) ? '/download/jar/' + workId : null,
      },
    };

  } catch (err) {
    emit('error', err.message);
    throw err;
  }
}

module.exports = { generateMod };
