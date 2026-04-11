const axios = require('axios');

// ==========================================
// LM STUDIO CLIENT (Local AI — No API Key Needed)
// https://lmstudio.ai/docs/api
// ==========================================

// LM Studio exposes an OpenAI-compatible endpoint at localhost:1234 by default.
// Start it with: lms server start
// Set LM_STUDIO_URL in .env to override (e.g. for remote/headless deployments).
const LM_STUDIO_URL = (process.env.LM_STUDIO_URL || 'http://localhost:1234') + '/v1/chat/completions';

// Model identifier — set LM_STUDIO_MODEL in .env to match whatever model you have loaded.
// Examples: "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF"
//           "openai/gpt-oss-20b"
// Leave as "local-model" to use whatever is currently loaded in LM Studio.
const PRIMARY_MODEL = process.env.LM_STUDIO_MODEL || 'local-model';
const FAST_MODEL = process.env.LM_STUDIO_FAST_MODEL || PRIMARY_MODEL;

async function callLMStudio({ messages, maxTokens = 4096, temperature = 0.2, isRepair = false }) {
  const model = isRepair ? FAST_MODEL : PRIMARY_MODEL;

  // Optional bearer token — set LM_API_TOKEN in .env if you've enabled auth.
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.LM_API_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.LM_API_TOKEN}`;
  }

  try {
    const response = await axios.post(LM_STUDIO_URL, {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }, {
      headers,
      timeout: 180000, // 3 minutes — local models can be slow
    });

    const content = response.data.choices[0].message.content;
    return {
      content,
      model: response.data.model || model,
    };
  } catch (error) {
    const status = error.response?.status;
    const msg = error.response?.data?.error?.message || error.message;

    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
      throw new Error(
        `Cannot connect to LM Studio at ${LM_STUDIO_URL}. ` +
        `Make sure LM Studio is running and the server is started:\n` +
        `  lms server start\n` +
        `Or set LM_STUDIO_URL in your .env to the correct address.`
      );
    }
    if (status === 503) {
      throw new Error(
        `LM Studio returned 503 — no model is loaded. ` +
        `Load a model in the LM Studio UI or run: lms get <model-name>`
      );
    }
    if (status === 401) throw new Error(`LM Studio auth error: ${msg}. Check LM_API_TOKEN in your .env.`);
    throw new Error(`LM Studio API error (${status || 'unknown'}): ${msg}`);
  }
}

// ==========================================
// TEXT ANALYSIS HELPERS
// ==========================================
function approximateTokenCount(text) {
  return Math.max(1, Math.ceil((text || '').length / 4));
}

function tokenizePrompt(text) {
  const chunks = (text || '').match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) || [];
  return {
    originalLength: (text || '').length,
    approximateTokenCount: approximateTokenCount(text),
    preview: chunks.slice(0, 24),
    chunks,
  };
}

function vectorizePrompt(text) {
  const normalized = (text || '').toLowerCase();
  const terms = normalized.match(/[a-z0-9_]{3,}/g) || [];
  const uniqueTerms = [...new Set(terms)];
  const weightedTerms = uniqueTerms.slice(0, 12).map((term, index) => ({
    term,
    weight: Number((1 - (index * 0.05)).toFixed(2)),
  }));
  return {
    approximateEmbeddingDimensions: 1536,
    topTerms: weightedTerms,
    inferredIntent: inferIntent(normalized),
    constraints: inferConstraints(normalized),
  };
}

function inferIntent(text) {
  if (text.includes('item')) return 'item-driven gameplay extension';
  if (text.includes('block')) return 'block and world interaction';
  if (text.includes('mob') || text.includes('entity')) return 'entity behavior feature';
  if (text.includes('magic') || text.includes('spell')) return 'ability and power system';
  return 'general gameplay mod feature';
}

function inferConstraints(text) {
  const constraints = [];
  if (text.includes('simple')) constraints.push('prefer straightforward architecture');
  if (text.includes('multiplayer')) constraints.push('keep logic server-safe');
  if (text.includes('gui') || text.includes('screen')) constraints.push('include client-side separation');
  if (text.includes('craft') || text.includes('recipe')) constraints.push('include data-driven content files');
  return constraints;
}

// ==========================================
// PROMPT BUILDERS
// ==========================================
function buildArchitectureMessages(request, analysis, helpers) {
  return [
    {
      role: 'system',
      content: 'You are a senior Minecraft mod architect. Design a concise build plan. Return ONLY valid JSON with no markdown formatting, no code fences, and no extra text before or after.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        request: {
          description: request.description,
          loader: request.loader,
          mcVersion: request.mcVersion,
          loaderVersion: request.loaderVersion,
        },
        analysis,
        buildRules: {
          javaMajor: helpers.javaMajor,
          javaVersionEnum: helpers.javaVersionEnum,
          gradleVersion: helpers.gradleVersion,
        },
        outputSchema: {
          modId: 'lowercase mod id',
          modName: 'user-friendly mod name',
          summary: '1-2 sentence summary',
          architecture: ['list of components'],
          requiredFiles: ['list of important relative file paths'],
          risks: ['list of implementation risks to avoid'],
        },
      }),
    },
  ];
}

function buildGenerationMessages(request, analysis, architecture, helpers) {
  return [
    {
      role: 'system',
      content: 'You are an expert Minecraft mod developer. Build the final response containing complete project files. Return ONLY a valid JSON object with no markdown formatting, no code fences, and no extra text.',
    },
    {
      role: 'user',
      content: helpers.promptFactory(request, analysis, architecture),
    },
  ];
}

function buildRepairMessages(request, architecture, previousResponse, validationError, helpers) {
  return [
    {
      role: 'system',
      content: 'Repair the generated Minecraft mod JSON. Return ONLY valid JSON with no markdown or extra text. Keep the project complete and compilable.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        request,
        architecture,
        validationError,
        previousResponse,
        requirementsReminder: {
          javaMajor: helpers.javaMajor,
          javaVersionEnum: helpers.javaVersionEnum,
          gradleVersion: helpers.gradleVersion,
        },
      }),
    },
  ];
}

function extractJSON(text) {
  try {
    return JSON.parse(text.trim());
  } catch {}

  // Strip markdown code fences — local models often wrap JSON in them
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch {}
  }

  // Last resort: find outermost { }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  throw new Error('Failed to parse JSON from AI response');
}

// ==========================================
// MAIN PIPELINE FUNCTIONS
// ==========================================
async function buildResponsePlan(request, helpers, emit) {
  const analysis = {
    tokenization: tokenizePrompt(request.description),
    vectorization: vectorizePrompt(request.description),
  };

  emit('pipeline', `Tokenized prompt into ~${analysis.tokenization.approximateTokenCount} tokens`);
  emit('pipeline', `Mapped semantic intent: ${analysis.vectorization.inferredIntent}`);

  const architectureResult = await callLMStudio({
    messages: buildArchitectureMessages(request, analysis, helpers),
    maxTokens: 3000,
    temperature: 0.2,
  });

  const architecture = extractJSON(architectureResult.content);
  emit('pipeline', `Predicted architecture with ${Array.isArray(architecture.requiredFiles) ? architecture.requiredFiles.length : 0} key files`);

  return {
    analysis,
    architecture,
    architectureModel: architectureResult.model,
  };
}

async function generateProjectFromPlan(request, plan, helpers, emit, validateMod) {
  const generationResult = await callLMStudio({
    messages: buildGenerationMessages(request, plan.analysis, plan.architecture, helpers),
    maxTokens: helpers.maxTokens || 8000,
    temperature: helpers.temperature || 0.2,
  });

  emit('pipeline', `Generated project draft with ${generationResult.model}`);

  try {
    const parsed = extractJSON(generationResult.content);
    validateMod(parsed);
    return {
      mod: parsed,
      modelUsed: generationResult.model,
      repaired: false,
    };
  } catch (error) {
    emit('pipeline', 'Validation failed, running repair pass');

    const repairResult = await callLMStudio({
      messages: buildRepairMessages(
        request,
        plan.architecture,
        generationResult.content,
        error.message,
        helpers
      ),
      maxTokens: helpers.maxTokens || 8000,
      temperature: 0.15,
      isRepair: true,
    });

    const parsed = extractJSON(repairResult.content);
    validateMod(parsed);

    return {
      mod: parsed,
      modelUsed: repairResult.model,
      repaired: true,
    };
  }
}

module.exports = {
  buildResponsePlan,
  generateProjectFromPlan,
  extractJSON,
};
