const axios = require('axios');

// ==========================================
// GROQ AI CLIENT (Free, No Rate Limits)
// ==========================================
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// We use the 70b model for main generation, and the 8b model for instant auto-fixes
const PRIMARY_MODEL = 'llama-3.1-70b-versatile';
const FAST_MODEL = 'llama-3.1-8b-instant'; 

async function callGroq({ messages, maxTokens = 4096, temperature = 0.2, isRepair = false }) {
  if (!GROQ_API_KEY) {
    throw new Error('Missing GROQ_API_KEY environment variable. Get one free at https://console.groq.com/keys');
  }

  const model = isRepair ? FAST_MODEL : PRIMARY_MODEL;

  try {
    const response = await axios.post(GROQ_URL, {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" } // Forces perfect JSON, no markdown!
    }, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000, // 2 minute timeout
    });

    const content = response.data.choices[0].message.content;
    return {
      content,
      model: response.data.model,
    };
  } catch (error) {
    const status = error.response?.status;
    const msg = error.response?.data?.error?.message || error.message;
    if (status === 429) throw new Error(`Groq rate limit error: ${msg}`);
    if (status === 401) throw new Error(`Groq API key invalid: ${msg}`);
    throw new Error(`Groq API error: ${msg}`);
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
      content: 'You are a senior Minecraft mod architect. Design a concise build plan. Return ONLY valid JSON.'
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
      content: 'You are an expert Minecraft mod developer. Build the final response containing complete project files. Return ONLY a valid JSON object.'
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
      content: 'Repair the generated Minecraft mod JSON. Return ONLY valid JSON. Keep the project complete and compilable.'
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
  
  // Fallback just in case, though Groq's response_format prevents this
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

  const architectureResult = await callGroq({
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
  const generationResult = await callGroq({
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

    // Uses the FAST_MODEL automatically for repairs!
    const repairResult = await callGroq({
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
