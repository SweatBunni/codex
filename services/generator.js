/**
 * CodexMC AI Generation Service
 * FULL PRODUCTION VERSION
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
// PROMPTS
// ─────────────────────────────────────────────

function buildSystemPrompt() {
  return `
You are an expert Minecraft mod developer.

Return ONLY valid JSON.
No markdown. No backticks. No explanations.

Ensure JSON is COMPLETE and never cut off.

Structure:
{
  "modName": "ExampleMod",
  "modId": "examplemod",
  "description": "desc",
  "version": "1.0.0",
  "files": {
    "build.gradle": "...",
    "src/main/java/...": "..."
  },
  "gradlewNeeded": true,
  "jdkRequired": "17"
}
`;
}

function buildUserPrompt(req) {
  return `Create a ${req.loader} mod for Minecraft ${req.mcVersion}.

Request: ${req.prompt}

Return ONLY JSON.`;
}

// ─────────────────────────────────────────────
// SAFE JSON FIX (handles truncation)
// ─────────────────────────────────────────────

function extractJSON(text) {
  if (!text) throw new Error("Empty AI response");

  let cleaned = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("No JSON found");

  let json = cleaned.slice(start);

  try {
    return JSON.parse(json);
  } catch {}

  try {
    let open = (json.match(/{/g) || []).length;
    let close = (json.match(/}/g) || []).length;

    while (close < open) {
      json += "}";
      close++;
    }

    return JSON.parse(json);
  } catch {}

  const last = json.lastIndexOf("}");
  if (last !== -1) {
    return JSON.parse(json.slice(0, last + 1));
  }

  throw new Error("Invalid JSON from AI");
}

// ─────────────────────────────────────────────
// ZIP SOURCE
// ─────────────────────────────────────────────

async function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = require('fs').createWriteStream(outPath);
    const archive = archiver('zip');

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

function buildMod(workDir) {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

    const proc = spawn(cmd, ['build'], {
      cwd: workDir,
      shell: true
    });

    proc.stdout.on('data', d => console.log(d.toString()));
    proc.stderr.on('data', d => console.error(d.toString()));

    proc.on('close', code => {
      if (code !== 0) return reject(new Error("Gradle build failed"));
      resolve();
    });
  });
}

function findJar(workDir) {
  const dir = path.join(workDir, 'build', 'libs');
  if (!fs.existsSync(dir)) return null;

  const file = fs.readdirSync(dir).find(f => f.endsWith('.jar'));
  return file ? path.join(dir, file) : null;
}

// ─────────────────────────────────────────────
// OPENROUTER CALL WITH RETRY
// ─────────────────────────────────────────────

async function callAI(messages, retries = 3) {
  try {
    const res = await axios.post(
      OPENROUTER_API,
      {
        model: "qwen/qwen2.5-coder-32b-instruct:free", // safe free model
        messages,
        temperature: 0.3,
        max_tokens: 4000 // 🔴 LOWER THIS (12000 causes 400 sometimes)
      },
      {
        headers: {
  "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
  "Content-Type": "application/json",
  "HTTP-Referer": "https://codexmc.net", // or your domain
  "X-OpenRouter-Title": "CodexMC"
},
        timeout: 120000
      }
    );

    console.log("✅ OpenRouter OK");

    const content = res?.data?.choices?.[0]?.message?.content;

    if (!content) {
      console.error("❌ RAW RESPONSE:", res.data);
      throw new Error("Empty AI response");
    }

    return content;

  } catch (err) {
    console.error("❌ OPENROUTER ERROR FULL:");
    console.error(err.response?.data || err.message);

    if (retries <= 0) throw err;

    await new Promise(r => setTimeout(r, 2000));
    return callAI(messages, retries - 1);
  }
}
// ─────────────────────────────────────────────
// MAIN FUNCTION
// ─────────────────────────────────────────────

async function generateMod(request, onProgress) {
  const workId = uuidv4();
  const workDir = path.join(WORKSPACE_DIR, workId);

  const emit = (type, msg) => {
    if (onProgress) onProgress({ type, message: msg, workId });
  };

  try {
    emit("info", "🚀 Generating mod...");

    await fs.ensureDir(workDir);

    const aiText = await callAI([
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(request) }
    ]);

    emit("ai", "✅ AI response received");

    const modData = extractJSON(aiText);

    emit("info", "📁 Writing files...");

    for (const [file, content] of Object.entries(modData.files || {})) {
      const full = path.join(workDir, file);
      await fs.ensureDir(path.dirname(full));
      await fs.writeFile(full, content, "utf8");
    }

    // ── ZIP SOURCE
    const zipPath = path.join(workDir, "source.zip");
    await zipDirectory(workDir, zipPath);

    // ── BUILD MOD
    let jarPath = null;

    try {
      emit("info", "🔨 Building mod...");
      await buildMod(workDir);
      jarPath = findJar(workDir);
    } catch {
      emit("warn", "Build failed (source still available)");
    }

    emit("success", "🎉 Done!");

    return {
      success: true,
      modName: modData.modName,
      modId: modData.modId,
      workId,
      downloads: {
        source: `/download/source/${workId}`,
        jar: jarPath ? `/download/jar/${workId}` : null
      }
    };
  } catch (err) {
    emit("error", err.message);
    await fs.remove(workDir).catch(() => {});
    throw err;
  }
}

module.exports = { generateMod };
