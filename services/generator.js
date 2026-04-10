/**
 * CodexMC AI Generation Service
 * Fixed: stable JSON parsing + OpenRouter reliability
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

// ─────────────────────────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────────────────────────

function buildSystemPrompt() {
  return `
You are CodexMC, an expert Minecraft mod developer.

You MUST return ONLY valid JSON.

No markdown.
No backticks.
No explanations.

Return exactly this structure:

{
  "modName": "ExampleMod",
  "modId": "examplemod",
  "description": "What the mod does",
  "version": "1.0.0",
  "files": {
    "src/main/java/.../ExampleMod.java": "// java code",
    "build.gradle": "// gradle file"
  },
  "gradlewNeeded": true,
  "jdkRequired": "21"
}
`;
}

function buildUserPrompt(request) {
  const { prompt, loader, mcVersion, loaderVersion } = request;

  return `Create a complete Minecraft ${loader} mod for Minecraft ${mcVersion} using ${loaderVersion || "latest"}.

Request: ${prompt}

Return ONLY valid JSON.`;
}

// ─────────────────────────────────────────────────────────────
// SAFE JSON PARSER (IMPORTANT FIX)
// ─────────────────────────────────────────────────────────────

function extractJSON(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Empty AI response");
  }

  let cleaned = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  if (start === -1) {
    throw new Error("No JSON found in AI response");
  }

  let jsonString = cleaned.slice(start);

  // 🔥 FIX: attempt parse first
  try {
    return JSON.parse(jsonString);
  } catch {}

  // 🔥 FIX: auto-repair truncated JSON
  try {
    let openBraces = (jsonString.match(/{/g) || []).length;
    let closeBraces = (jsonString.match(/}/g) || []).length;

    // add missing closing braces
    while (closeBraces < openBraces) {
      jsonString += "}";
      closeBraces++;
    }

    return JSON.parse(jsonString);
  } catch {}

  // 🔥 LAST RESORT: hard cut at last valid brace
  const lastValidIndex = jsonString.lastIndexOf("}");
  if (lastValidIndex !== -1) {
    try {
      return JSON.parse(jsonString.slice(0, lastValidIndex + 1));
    } catch {}
  }

  throw new Error("Invalid JSON from AI (unrecoverable)");
}

// ─────────────────────────────────────────────────────────────
// CORE FUNCTION
// ─────────────────────────────────────────────────────────────

async function generateMod(request, onProgress) {
  const workId = uuidv4();
  const workDir = path.join(
    process.env.WORKSPACE_DIR || "/tmp/codexmc-workspaces",
    workId
  );

  const emit = (type, message) => {
    if (onProgress) onProgress({ type, message, workId });
  };

  try {
    emit("info", "🚀 Starting mod generation...");

    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY not set");
    }

    emit("ai", "🤖 Calling OpenRouter...");

    // ✅ FIX: stream disabled (prevents broken JSON)
    const response = await axios.post(
      OPENROUTER_API,
      {
        model: "minimax/minimax-m2.5:free",
        temperature: 0.4,

        // ✅ IMPORTANT FIX
        stream: false,

        max_tokens: 8000,

        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(request) }
        ]
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://codexmc.ai",
          "X-Title": "CodexMC"
        },
        timeout: 120000
      }
    );

    const fullResponse =
      response.data?.choices?.[0]?.message?.content || "";

    emit("ai", "✅ AI response received");

    // ─────────────────────────────────────────────
    // FIXED JSON PARSING
    // ─────────────────────────────────────────────

    const modData = extractJSON(fullResponse);

    emit("info", "📁 Writing files...");

    await fs.ensureDir(workDir);

    for (const [filePath, content] of Object.entries(modData.files || {})) {
      const fullPath = path.join(workDir, filePath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, content, "utf8");
    }

    emit("success", "🎉 Mod generated successfully");

    setTimeout(() => fs.remove(workDir).catch(() => {}), 60000);

    return {
      success: true,
      modName: modData.modName,
      modId: modData.modId,
      workDir
    };
  } catch (err) {
    emit("error", err.message);
    await fs.remove(workDir).catch(() => {});
    throw err;
  }
}

module.exports = { generateMod };
