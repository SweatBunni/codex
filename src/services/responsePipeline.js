/**
 * CodexMC — AI Pipeline powered by puter.js
 * Replaces LM Studio with puter.ai.chat() — no API keys required.
 */

const { init } = require('@heyputer/puter.js/src/init.cjs');

// Initialize puter with auth token from env (or anonymous if not set)
let puter;
function getPuter() {
  if (!puter) {
    const token = process.env.PUTER_API_TOKEN || '';
    puter = init(token || undefined);
  }
  return puter;
}

// Default model — can be overridden via PUTER_MODEL env var
// claude-sonnet-4-5 is a strong coding model available on puter.js
const PRIMARY_MODEL = process.env.PUTER_MODEL || 'claude-sonnet-4-5';
const FAST_MODEL = process.env.PUTER_FAST_MODEL || PRIMARY_MODEL;

const MAX_RETRIES = parseInt(process.env.PUTER_RETRIES, 10) || 2;

// ==========================================
// PUTER AI CLIENT
// ==========================================

async function checkPuterHealth() {
  try {
    const p = getPuter();
    const res = await p.ai.chat('Say "ok"', { model: PRIMARY_MODEL });
    const text = extractText(res);
    if (text) return true;
    throw new Error('Puter returned empty response');
  } catch (err) {
    throw new Error(`Puter.js health check failed: ${err.message}`);
  }
}

function extractText(response) {
  if (typeof response === 'string') return response;
  if (response?.message?.content) {
    const c = response.message.content;
    if (Array.isArray(c)) return c.map(b => (b.type === 'text' ? b.text : '')).join('');
    return String(c);
  }
  return String(response ?? '');
}

async function callPuter({ messages, maxTokens = 8000, temperature = 0.2, isRepair = false }) {
  const model = isRepair ? FAST_MODEL : PRIMARY_MODEL;
  const p = getPuter();
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const backoffMs = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
        console.log(`[puter] Retry attempt ${attempt + 1}/${MAX_RETRIES + 1} after ${backoffMs}ms...`);
        await new Promise(r => setTimeout(r, backoffMs));
      }

      const response = await p.ai.chat(messages, { model, max_tokens: maxTokens });
      const content = extractText(response);
      if (!content) throw new Error('Puter returned no content');
      return { content, model };
    } catch (error) {
      lastError = error;
      console.warn(`[puter] Attempt ${attempt + 1} failed: ${error.message}`);
    }
  }

  throw new Error(`Puter.js API error after ${MAX_RETRIES + 1} attempts: ${lastError.message}`);
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
  try { return JSON.parse(text.trim()); } catch {}
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) { try { return JSON.parse(fenceMatch[1].trim()); } catch {} }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) { try { return JSON.parse(text.slice(start, end + 1)); } catch {} }
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
  emit('pipeline', `Calling puter.ai (${PRIMARY_MODEL}) for architecture planning...`);

  const architectureResult = await callPuter({
    messages: buildArchitectureMessages(request, analysis, helpers),
    maxTokens: 3000,
    temperature: 0.2,
  });

  const architecture = extractJSON(architectureResult.content);
  emit('pipeline', `Predicted architecture with ${Array.isArray(architecture.requiredFiles) ? architecture.requiredFiles.length : 0} key files`);

  return { analysis, architecture, architectureModel: architectureResult.model };
}

async function generateProjectFromPlan(request, plan, helpers, emit, validateMod) {
  emit('pipeline', `Generating full project with puter.ai (${PRIMARY_MODEL})...`);

  const generationResult = await callPuter({
    messages: buildGenerationMessages(request, plan.analysis, plan.architecture, helpers),
    maxTokens: helpers.maxTokens || 8000,
    temperature: helpers.temperature || 0.2,
  });

  emit('pipeline', `Generated project draft`);

  try {
    const parsed = extractJSON(generationResult.content);
    validateMod(parsed);
    return { mod: parsed, modelUsed: generationResult.model, repaired: false };
  } catch (error) {
    emit('pipeline', 'Validation failed, running repair pass with puter.ai...');

    const repairResult = await callPuter({
      messages: buildRepairMessages(request, plan.architecture, generationResult.content, error.message, helpers),
      maxTokens: helpers.maxTokens || 8000,
      temperature: 0.15,
      isRepair: true,
    });

    const parsed = extractJSON(repairResult.content);
    validateMod(parsed);
    return { mod: parsed, modelUsed: repairResult.model, repaired: true };
  }
}

module.exports = {
  checkLMStudioHealth: checkPuterHealth, // kept for backward compat
  checkPuterHealth,
  buildResponsePlan,
  generateProjectFromPlan,
  extractJSON,
};
