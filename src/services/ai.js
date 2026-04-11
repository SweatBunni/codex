/**
 * AI Service Integration
 * Supports multiple AI providers with streaming responses
 */

const axios = require('axios');
const { logger } = require('../utils/logger');
const config = require('../config');

class AIService {
  constructor() {
    this.provider = config.ai.provider;
    this.apiKey = config.ai.apiKey;
    this.model = config.ai.model;
    this.maxTokens = config.ai.maxTokens;
    this.temperature = config.ai.temperature;
  }

  async generateResponse(messages, options = {}) {
    try {
      const startTime = Date.now();
      
      let response;
      if (this.provider === 'openrouter') {
        response = await this.openRouterGenerate(messages, options);
      } else if (this.provider === 'openai') {
        response = await this.openAIGenerate(messages, options);
      } else if (this.provider === 'anthropic') {
        response = await this.anthropicGenerate(messages, options);
      } else {
        throw new Error(`Unsupported AI provider: ${this.provider}`);
      }

      const duration = Date.now() - startTime;
      logger.performance('AI generation', duration, { 
        provider: this.provider, 
        model: this.model,
        messages: messages.length 
      });

      return response;
    } catch (error) {
      logger.error('AI generation failed', { 
        provider: this.provider, 
        model: this.model, 
        error: error.message 
      });
      throw error;
    }
  }

  async openRouterGenerate(messages, options = {}) {
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    
    const payload = {
      model: this.model,
      messages: this.formatMessages(messages),
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature || this.temperature,
      stream: options.stream || false,
      ...options
    };

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': config.server.siteUrl,
        'X-Title': 'CodexMC AI Mod Generator'
      },
      timeout: 60000
    });

    if (options.stream) {
      return this.handleStreamResponse(response);
    }

    const choice = response.data.choices[0];
    return {
      content: choice.message.content,
      metadata: {
        provider: this.provider,
        model: this.model,
        usage: response.data.usage,
        finishReason: choice.finish_reason
      }
    };
  }

  async openAIGenerate(messages, options = {}) {
    const url = 'https://api.openai.com/v1/chat/completions';
    
    const payload = {
      model: this.model,
      messages: this.formatMessages(messages),
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature || this.temperature,
      stream: options.stream || false,
      ...options
    };

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    if (options.stream) {
      return this.handleStreamResponse(response);
    }

    const choice = response.data.choices[0];
    return {
      content: choice.message.content,
      metadata: {
        provider: this.provider,
        model: this.model,
        usage: response.data.usage,
        finishReason: choice.finish_reason
      }
    };
  }

  async anthropicGenerate(messages, options = {}) {
    const url = 'https://api.anthropic.com/v1/messages';
    
    const payload = {
      model: this.model,
      messages: this.formatAnthropicMessages(messages),
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature || this.temperature,
      stream: options.stream || false,
      ...options
    };

    const response = await axios.post(url, payload, {
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      timeout: 60000
    });

    if (options.stream) {
      return this.handleStreamResponse(response);
    }

    return {
      content: response.data.content[0].text,
      metadata: {
        provider: this.provider,
        model: this.model,
        usage: response.data.usage,
        finishReason: response.data.stop_reason
      }
    };
  }

  formatMessages(messages) {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  formatAnthropicMessages(messages) {
    // Anthropic format is slightly different
    return messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));
  }

  async handleStreamResponse(response) {
    const stream = response.data;
    const chunks = [];

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        chunks.push(chunk);
        // Emit chunk for real-time streaming
        if (this.onChunk) {
          this.onChunk(chunk);
        }
      });

      stream.on('end', () => {
        const fullResponse = Buffer.concat(chunks).toString();
        resolve(this.parseStreamResponse(fullResponse));
      });

      stream.on('error', reject);
    });
  }

  parseStreamResponse(streamData) {
    try {
      const lines = streamData.split('\n');
      const content = [];
      let usage = null;

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) content.push(delta);
            
            if (parsed.usage) usage = parsed.usage;
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }

      return {
        content: content.join(''),
        metadata: {
          provider: this.provider,
          model: this.model,
          usage,
          streamed: true
        }
      };
    } catch (error) {
      logger.error('Failed to parse stream response', { error: error.message });
      throw error;
    }
  }

  // Streaming wrapper for WebSocket
  async generateStreamingResponse(messages, sessionId, onChunk) {
    this.onChunk = (chunk) => {
      if (onChunk) {
        onChunk({
          type: 'chunk',
          sessionId,
          data: chunk
        });
      }
    };

    try {
      const response = await this.generateResponse(messages, { stream: true });
      
      // Send final message
      if (onChunk) {
        onChunk({
          type: 'complete',
          sessionId,
          data: response
        });
      }

      return response;
    } catch (error) {
      if (onChunk) {
        onChunk({
          type: 'error',
          sessionId,
          error: error.message
        });
      }
      throw error;
    } finally {
      this.onChunk = null;
    }
  }

  // Code generation specific methods
  async generateCode(prompt, context = {}) {
    const systemPrompt = this.buildCodePrompt(context);
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    return await this.generateResponse(messages, {
      temperature: 0.3, // Lower temperature for code generation
      maxTokens: this.maxTokens
    });
  }

  buildCodePrompt(context) {
    const { loader, minecraftVersion, loaderVersion, modType } = context;
    
    return `You are an expert Minecraft mod developer specializing in ${loader} mods for Minecraft ${minecraftVersion}.

Generate clean, well-documented code following best practices:
- Use proper package naming conventions
- Include comprehensive comments
- Follow ${loader} modding patterns
- Ensure compatibility with ${loaderVersion || 'latest'}
- Include error handling and validation

Context:
- Mod Loader: ${loader}
- Minecraft Version: ${minecraftVersion}
- Loader Version: ${loaderVersion || 'latest'}
- Mod Type: ${modType || 'general'}

Provide only the code without explanations unless specifically requested.`;
  }

  // Conversation continuation
  async continueConversation(sessionId, newMessage, conversationService) {
    const context = await conversationService.getContextWindow(sessionId);
    
    // Add system message for context if needed
    if (context.length === 0 || context[0].role !== 'system') {
      context.unshift({
        role: 'system',
        content: 'You are CodexMC, an AI assistant specialized in Minecraft mod development. Help users create, debug, and understand Minecraft mods.'
      });
    }

    // Add new message
    context.push({
      role: 'user',
      content: newMessage
    });

    return await this.generateResponse(context);
  }
}

module.exports = new AIService();
