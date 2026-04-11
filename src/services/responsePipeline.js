const { callOpenRouter } = require('./openrouterClient');

function approximateTokenCount(text) {
  return Math.max(1, Math.ceil((text || '').length / 4));
}

function tokenizePrompt(text) {
  const chunks = (text || '')
    .match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) || [];

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

function buildArchitectureMessages(request, analysis, helpers) {
  return [
    {
      role: 'system',
      content: [
        'You are a senior Minecraft mod architect.',
        'Design the response in a ChatGPT-style staged process: tokenize request, map meaning, predict ideal file structure, then produce a concise build plan.',
        'Return ONLY valid JSON.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        request: {
          description: request.description,
          loader: request.loader,
          mcVersion: request.mcVersion,
          loaderVersion: request.loaderVersion,
          thinkingLevel: request.thinkingLevel,
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
      content: [
        'You are an expert Minecraft mod developer.',
        'Build the final response the way ChatGPT would: consume tokenized intent, use the semantic map, predict the most likely next implementation steps, then iteratively complete a full mod.',
        'Return ONLY a valid JSON object containing the complete project files.',
        'No markdown. No code fences. No explanations.',
      ].join(' '),
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
      content: 'Repair the generated Minecraft mod JSON. Return ONLY valid JSON. Keep the project complete and compilable.',
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

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }

  const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
  return JSON.parse(stripped);
}

async function buildResponsePlan(request, helpers, emit) {
  const analysis = {
    tokenization: tokenizePrompt(request.description),
    vectorization: vectorizePrompt(request.description),
  };

  emit('pipeline', `Tokenized prompt into ~${analysis.tokenization.approximateTokenCount} tokens`);
  emit('pipeline', `Mapped semantic intent: ${analysis.vectorization.inferredIntent}`);

  const architectureResult = await callOpenRouter({
    messages: buildArchitectureMessages(request, analysis, helpers),
    maxTokens: 3000,
    temperature: 0.2,
    reasoningEffort: request.thinkingLevel,
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
  const generationResult = await callOpenRouter({
    messages: buildGenerationMessages(request, plan.analysis, plan.architecture, helpers),
    maxTokens: helpers.maxTokens,
    temperature: helpers.temperature,
    preferredModel: helpers.preferredModel,
    reasoningEffort: request.thinkingLevel,
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

    const repairResult = await callOpenRouter({
      messages: buildRepairMessages(
        request,
        plan.architecture,
        generationResult.content,
        error.message,
        helpers
      ),
      maxTokens: helpers.maxTokens,
      temperature: 0.15,
      preferredModel: helpers.fallbackModel || helpers.preferredModel,
      reasoningEffort: request.thinkingLevel,
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
