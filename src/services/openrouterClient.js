const axios = require('axios');
const config = require('../config');

function getModelCandidates(preferredModel) {
  const candidates = [
    preferredModel,
    config.openrouter.primaryModel,
    config.openrouter.fallbackModel,
    config.openrouter.model,
  ].filter(Boolean);

  return [...new Set(candidates)];
}

function getReasoningEffort(reasoningEffort) {
  return reasoningEffort || config.openrouter.reasoningEffort || 'medium';
}

function formatProviderError(error, model) {
  const status = error?.response?.status;
  const providerMessage =
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.response?.data?.error?.metadata?.raw ||
    error?.message;

  if (status === 402) {
    return new Error(`OpenRouter billing/credits error (402) for ${model}: ${providerMessage || 'the selected model is not currently available for this API key'}`);
  }

  if (status === 401) {
    return new Error(`OpenRouter authentication error (401): ${providerMessage || 'check OPENROUTER_API_KEY'}`);
  }

  if (status === 429) {
    return new Error(`OpenRouter rate limit error (429) for ${model}: ${providerMessage || 'too many requests, please try again shortly'}`);
  }

  if (status) {
    return new Error(`OpenRouter request failed (${status}) for ${model}: ${providerMessage || 'unknown provider error'}`);
  }

  return new Error(providerMessage || `Unknown OpenRouter error for ${model}`);
}

async function callOpenRouter({
  messages,
  maxTokens = config.openrouter.maxTokens,
  temperature = config.openrouter.temperature,
  preferredModel,
  reasoningEffort,
}) {
  const candidates = getModelCandidates(preferredModel);
  let lastError = null;

  for (const model of candidates) {
    try {
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        reasoning: {
          effort: getReasoningEffort(reasoningEffort),
        },
      }, {
        headers: {
          Authorization: `Bearer ${config.openrouter.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': config.server.siteUrl,
          'X-Title': 'CodexMC',
        },
        timeout: 240000,
      });

      const choice = response.data?.choices?.[0];
      const content = choice?.message?.content;
      if (!content) {
        throw new Error(`OpenRouter returned no message content for ${model}`);
      }

      return {
        model,
        content,
        raw: response.data,
      };
    } catch (error) {
      lastError = formatProviderError(error, model);
    }
  }

  throw lastError || new Error('OpenRouter request failed');
}

module.exports = {
  callOpenRouter,
  getModelCandidates,
};
