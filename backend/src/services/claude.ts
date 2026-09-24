import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { config } from '../config.js';
import type { ImageInput, StructuredRequest } from './ai-types.js';

/**
 * Claude adapter for the provider-neutral AI interface.
 *
 * All callers get:
 *  - Configured Anthropic model with adaptive thinking
 *  - Structured JSON output validated against a Zod schema (no fence-stripping,
 *    no brace-hunting, no "// comments" cleanup)
 */
function createClient(): Anthropic {
  return new Anthropic({ apiKey: config.anthropic.apiKey || undefined });
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export function isClaudeConfigured(): boolean {
  return !!config.anthropic.apiKey;
}

function normalizeMediaType(mimeType: string): ImageMediaType {
  const mt = mimeType.split(';')[0].trim().toLowerCase();
  if (mt === 'image/jpeg' || mt === 'image/jpg') return 'image/jpeg';
  if (mt === 'image/png') return 'image/png';
  if (mt === 'image/gif') return 'image/gif';
  if (mt === 'image/webp') return 'image/webp';
  return 'image/jpeg';
}

/**
 * Ask Anthropic for a JSON object matching `schema`. Images (if any) are placed
 * before the prompt text, each preceded by its label so the model can match
 * "Image N" references in the prompt to the right picture.
 */
export async function generateClaudeStructured<S extends z.ZodType>(req: StructuredRequest<S>, injectedClient?: Anthropic): Promise<z.infer<S>> {
  if (!isClaudeConfigured() && !injectedClient) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const img of req.images ?? []) {
    if (img.label) content.push({ type: 'text', text: img.label });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: normalizeMediaType(img.mimeType), data: img.data },
    });
  }
  content.push({ type: 'text', text: req.prompt });

  const started = Date.now();
  const effort = req.effort ?? config.ai.effort;
  if (effort === 'none') throw new Error('BLAIR_AI_EFFORT=none is only supported by the OpenAI provider');
  console.log(`[ai:claude:${req.label}] ${config.ai.model} effort=${effort} images=${req.images?.length ?? 0}`);

  const client = injectedClient ?? createClient();
  const response = await client.beta.messages.parse({
    model: config.ai.model,
    max_tokens: req.maxTokens ?? 8192,
    system: req.system,
    output_config: {
      effort,
      format: betaZodOutputFormat(req.schema),
    },
    messages: [{ role: 'user', content }],
  });

  const ms = Date.now() - started;
  const u = response.usage;
  console.log(
    `[ai:claude:${req.label}] done in ${ms}ms — served by ${response.model}, stop=${response.stop_reason}, in=${u.input_tokens} out=${u.output_tokens}`,
  );

  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude declined this request (${response.stop_details?.category ?? 'unspecified'})`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Claude response was cut off by max_tokens');
  }
  if (!response.parsed_output) {
    throw new Error('Claude returned no parseable structured output');
  }
  return response.parsed_output;
}
