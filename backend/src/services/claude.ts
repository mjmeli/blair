import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { config } from '../config.js';

/**
 * Shared Claude client for every AI feature in blAIr.
 *
 * All callers get:
 *  - Claude Opus 5 with adaptive thinking (on by default for this model)
 *  - Structured JSON output validated against a Zod schema (no fence-stripping,
 *    no brace-hunting, no "// comments" cleanup)
 *  - Server-side refusal fallbacks so a false-positive safety classifier hit
 *    is retried on another model inside the same request
 */
const client = new Anthropic({ apiKey: config.anthropic.apiKey || undefined });

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface ImageInput {
  mimeType: string; // normalized to ImageMediaType at send time
  data: string; // base64
  label?: string; // e.g. "Image 3: WOKE_UP at 2:14 AM" — placed immediately before the image
}

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

export interface StructuredRequest<S extends z.ZodType> {
  /** Short tag for log lines, e.g. "insights" */
  label: string;
  schema: S;
  system: string;
  prompt: string;
  images?: ImageInput[];
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/**
 * Ask Claude for a JSON object matching `schema`. Images (if any) are placed
 * before the prompt text, each preceded by its label so the model can match
 * "Image N" references in the prompt to the right picture.
 */
export async function generateStructured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
  if (!isClaudeConfigured()) {
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
  console.log(`[claude:${req.label}] ${config.anthropic.model} effort=${req.effort ?? config.anthropic.effort} images=${req.images?.length ?? 0}`);

  const response = await client.beta.messages.parse({
    model: config.anthropic.model,
    max_tokens: req.maxTokens ?? 8192,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: req.system,
    output_config: {
      effort: req.effort ?? config.anthropic.effort,
      format: betaZodOutputFormat(req.schema),
    },
    messages: [{ role: 'user', content }],
  });

  const ms = Date.now() - started;
  const u = response.usage;
  console.log(
    `[claude:${req.label}] done in ${ms}ms — served by ${response.model}, stop=${response.stop_reason}, in=${u.input_tokens} out=${u.output_tokens}`,
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
