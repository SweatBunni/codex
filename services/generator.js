/**
 * CodexMC — AI Generation Service
 * Model: deepseek/deepseek-r1:free (best free reasoning model on OpenRouter)
 * Features: thinking levels, JAR compilation, source ZIP
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
// ─────────────────────────────────────────────

const THINKING_CONFIGS = {
  low: {
    model: 'deepseek/deepseek-r1:free',
    max_tokens: 4000,
    temperature: 0.3,
    // No extra thinking — fast
    extraSystemNote: 'Be concise. Generate only the essential files.',
  },
  medium: {
    model: 'deepseek/deepseek-r1:free',
    max_tokens: 8000,
    temperature: 0.25,
    extraSystemNote: 'Think carefully about the mod architecture before generating. Include proper event handling and registrations.',
  },
  high: {
    model: 'deepseek/deepseek-r1:free',
    max_tokens: 16000,
    temperature: 0.2,
    extraSystemNote: 'Think deeply and thoroughly. Consider all edge cases, proper Minecraft API usage, version compatibility, registration order, and common pitfalls. Generate complete, well-commented, production-quality code with all necessary files.',
  },
};

// ─────────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────────

function buildSystemPrompt(thinkingLevel = 'medium') {
  const cfg = THINKING_CONFIGS[thinkingLevel] || THINKING_CONFIGS.medium;

  return `You are an expert Minecraft mod developer specializing in Java modding.

${cfg.extraSystemNote}

Return ONLY valid JSON — no markdown, no backticks, no explanations, no comments.
Ensure the JSON is COMPLETE and never truncated.

Required JSON structure:
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

Include ALL files needed to build the mod. For Fabric, use fabric.mod.json instead of mods.toml.
Always include build.gradle, settings.gradle, gradle wrapper properties, and the main mod class.`;
}

function buildUserPrompt(req) {
  const loaderNote = {
    forge: `Use Forge ${req.loaderVersion || 'latest'} APIs. Use @Mod, @EventBusSubscriber, IEventBus. Register items/blocks via DeferredRegister.`,
    fabric: 'Use Fabric API. Implement ModInitializer. Use fabric.mod.json not mods.toml. Register via Registry.register.',
    neoforge: 'Use NeoForge APIs. Similar to Forge but uses NeoForge event system. Use @Mod and NeoForge registries.',
  }[req.loader] || '';

  return `Create a ${req.loader} mod for Minecraft ${req.mcVersion}.
${loaderNote}

Mod request: ${req.prompt}

JDK target: ${req.jdkRequired || '17'}
Loader version: ${req.loaderVersion || 'latest'}

Return ONLY complete JSON with all required files.`;
}

// ─────────────────────────────────────────────
// JSON EXTRACTION (handles truncation)
// ─────────────────────────────────────────────

function extractJSON(text) {
  if (!text) throw new Error('Empty AI response');

  // Strip any markdown fences
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Also strip DeepSeek thinking tags if present
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const start = cleaned.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in AI response');

  let json = cleaned.slice(start);

  // Try direct parse
  try { return JSON.parse(json); } catch {}

  // Try to balance braces (handles truncation)
  try {
    let open = (json.match(/{/g) || []).length;
    let close = (json.match(/}/g) || []).length;
    while (close < open) { json += '}'; close++; }
    return JSON.parse(json);
  } catch {}

  // Last resort: find last }
  const last = json.lastIndexOf('}');
  if (last !== -1) {
    try { return JSON.parse(json.slice(0, last + 1)); } catch {}
  }

  throw new Error('Could not parse AI response as valid JSON');
}

// ─────────────────────────────────────────────
// ZIP DIRECTORY
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
// BUILD MOD (GRADLE)
// ─────────────────────────────────────────────

function buildMod(workDir, emit) {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

    // Make gradlew executable
    try {
      const gradlewPath = path.join(workDir, 'gradlew');
      if (fs.existsSync(gradlewPath)) {
        fs.chmodSync(gradlewPath, '755');
      }
    } catch {}

    const proc = spawn(cmd, ['build', '--no-daemon', '--stacktrace'], {
      cwd: workDir,
      shell: true,
      env: {
        ...process.env,
        JAVA_HOME: getJavaHome('17'),
      }
    });

    proc.stdout.on('data', d => {
      const lines = d.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) emit('build', line);
      });
    });

    proc.stderr.on('data', d => {
      const lines = d.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) emit('warn', line);
      });
    });

    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`Gradle exited with code ${code}`));
      resolve();
    });

    proc.on('error', err => reject(err));
  });
}

function getJavaHome(version) {
  const paths = {
    '8':  process.env.JDK_8_PATH  || '/opt/jdk/8',
    '17': process.env.JDK_17_PATH || '/opt/jdk/17',
    '21': process.env.JDK_21_PATH || '/opt/jdk/21',
    '25': process.env.JDK_25_PATH || '/opt/jdk/25',
  };
  return paths[version] || paths['17'];
}

function findJar(workDir) {
  const dir = path.join(workDir, 'build', 'libs');
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jar') && !f.includes('sources') && !f.includes('javadoc'));
  return files.length > 0 ? path.join(dir, files[0]) : null;
}

// ─────────────────────────────────────────────
// OPENROUTER API CALL
// ─────────────────────────────────────────────

async function callAI(messages, thinkingLevel = 'medium', retries = 2) {
  const cfg = THINKING_CONFIGS[thinkingLevel] || THINKING_CONFIGS.medium;

  try {
    const res = await axios.post(
      OPENROUTER_API,
      {
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        max_tokens: cfg.max_tokens,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.SITE_URL || 'https://codexmc.net',
          'X-Title': 'CodexMC',
        },
        timeout: 180000,
      }
    );

    const content = res?.data?.choices?.[0]?.message?.content;
    if (!content) {
      console.error('Empty AI response. Full data:', JSON.stringify(res.data));
      throw new Error('AI returned empty response');
    }

    return content;

  } catch (err) {
    console.error('OpenRouter error:', err.response?.data || err.message);

    if (retries <= 0) throw err;
    await new Promise(r => setTimeout(r, 3000));
    return callAI(messages, thinkingLevel, retries - 1);
  }
}

// ─────────────────────────────────────────────
// DOWNLOAD GRADLEW WRAPPER (if not bundled)
// ─────────────────────────────────────────────

async function writeGradleWrapper(workDir) {
  const wrapperDir = path.join(workDir, 'gradle', 'wrapper');
  await fs.ensureDir(wrapperDir);

  const wrapperProps = path.join(wrapperDir, 'gradle-wrapper.properties');
  if (!fs.existsSync(wrapperProps)) {
    await fs.writeFile(wrapperProps, `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.1.1-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`);
  }
}

// ─────────────────────────────────────────────
// MAIN GENERATE FUNCTION
// ─────────────────────────────────────────────

async function generateMod(request, onProgress) {
  const workId = uuidv4();
  const workDir = path.join(WORKSPACE_DIR, workId);

  const emit = (type, msg) => {
    if (onProgress) onProgress({ type, message: msg, workId });
  };

  const thinkingLevel = request.thinkingLevel || 'medium';

  try {
    await fs.ensureDir(workDir);

    // Emit thinking start event
    emit('thinking_start', thinkingLevel);

    const thinkLabels = { low: '⚡ Fast', medium: '🧩 Extended reasoning', high: '🧠 Deep chain-of-thought' };
    emit('info', `🚀 Starting mod generation...`);
    emit('ai', `🤖 Model: deepseek/deepseek-r1:free (free OpenRouter)`);
    emit('ai', `${thinkLabels[thinkingLevel] || '🧩'} thinking mode active`);
    emit('info', `📦 Loader: ${request.loader} · MC ${request.mcVersion}`);
    emit('info', `💡 Prompt: ${request.prompt}`);
    emit('info', '');
    emit('ai', 'Calling AI API... (this may take 30–120s depending on thinking level)');

    // AI call
    const aiText = await callAI(
      [
        { role: 'system', content: buildSystemPrompt(thinkingLevel) },
        { role: 'user', content: buildUserPrompt(request) },
      ],
      thinkingLevel
    );

    emit('thinking_end', null);
    emit('ai', '✅ AI response received — parsing...');

    // Parse JSON
    let modData;
    try {
      modData = extractJSON(aiText);
    } catch (e) {
      emit('error', `JSON parse failed: ${e.message}`);
      emit('warn', 'AI response preview: ' + aiText.slice(0, 200));
      throw e;
    }

    emit('success', `✨ Mod "${modData.modName || 'Unknown'}" generated`);
    emit('info', '');

    // Write files
    emit('info', '📁 Writing project files...');

    const files = modData.files || {};

    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(workDir, filePath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, content, 'utf8');
      emit('file', `  📄 ${filePath}`);
    }

    // Write gradle wrapper if missing
    await writeGradleWrapper(workDir);

    emit('info', '');
    emit('info', '🗜️  Creating source ZIP...');

    // Source ZIP
    const sourceZipPath = path.join(workDir, 'source.zip');
    await zipDirectory(workDir, sourceZipPath);
    emit('success', '✅ source.zip ready');

    // Build attempt
    let buildSuccess = false;
    let jarPath = null;

    emit('info', '');
    emit('build', '🏗️  Attempting Gradle build...');
    emit('build', `./gradlew build --no-daemon`);
    emit('build', '');

    try {
      await buildMod(workDir, emit);
      jarPath = findJar(workDir);
      buildSuccess = !!jarPath;

      if (buildSuccess) {
        const jarName = path.basename(jarPath);
        emit('success', '');
        emit('success', `✅ BUILD SUCCESSFUL`);
        emit('success', `🎉 ${jarName} is ready!`);
      } else {
        emit('warn', '⚠️  Build succeeded but no JAR found');
      }
    } catch (buildErr) {
      emit('warn', '');
      emit('warn', `⚠️  Build failed: ${buildErr.message}`);
      emit('warn', 'Source code is still available for download.');
    }

    emit('info', '');
    emit('done', '🏁 Generation complete!');

    return {
      success: true,
      modName: modData.modName || 'YourMod',
      modId: modData.modId || 'yourmod',
      workId,
      buildSuccess,
      downloads: {
        source: `/download/source/${workId}`,
        jar: buildSuccess && jarPath ? `/download/jar/${workId}` : null,
      },
    };

  } catch (err) {
    emit('error', err.message);
    // Keep workspace for debugging
    throw err;
  }
}

module.exports = { generateMod };
