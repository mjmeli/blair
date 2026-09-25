import { config, hasProviderApiKey } from '../config.js';
import type { z } from 'zod';
import { generateClaudeStructured, isClaudeConfigured } from './claude.js';
import { generateOpenAIStructured, isOpenAIConfigured } from './openai-adapter.js';
import type { StructuredRequest } from './ai-types.js';

export type { ImageInput } from './ai-types.js';

export function isAiConfigured(): boolean {
  return hasProviderApiKey(config.ai.provider, {
    anthropic: isClaudeConfigured() ? config.anthropic.apiKey : '',
    openai: isOpenAIConfigured() ? config.openai.apiKey : '',
  });
}

export function missingAiApiKey(): string {
  return config.ai.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
}

export function generateStructured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
  if (config.ai.provider === 'openai') return generateOpenAIStructured(req);
  return generateClaudeStructured(req);
}
