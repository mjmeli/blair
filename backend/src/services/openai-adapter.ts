import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import { config } from '../config.js';
import type { StructuredRequest } from './ai-types.js';

type SupportedImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

function imageMimeType(base64: string): SupportedImageMimeType {
  // Nanit can serve images with generic or incorrect Content-Type headers.
  // Identify the actual bytes before constructing the OpenAI data URL.
  const bytes = Buffer.from(base64.slice(0, 32), 'base64');
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && (bytes.toString('ascii', 0, 6) === 'GIF87a' || bytes.toString('ascii', 0, 6) === 'GIF89a')) return 'image/gif';
  throw new Error('Unsupported image format for OpenAI analysis; expected JPEG, PNG, WebP, or GIF');
}

function createClient(): OpenAI {
  return new OpenAI({ apiKey: config.openai.apiKey || undefined });
}

export function isOpenAIConfigured(): boolean {
  return !!config.openai.apiKey;
}

export async function generateOpenAIStructured<S extends z.ZodType>(
  req: StructuredRequest<S>,
  injectedClient?: OpenAI,
): Promise<z.infer<S>> {
  if (!isOpenAIConfigured() && !injectedClient) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const userContent: OpenAI.Responses.ResponseInputContent[] = [];
  for (const img of req.images ?? []) {
    if (img.label) userContent.push({ type: 'input_text', text: img.label });
    userContent.push({
      type: 'input_image',
      image_url: `data:${imageMimeType(img.data)};base64,${img.data}`,
      detail: 'auto',
    });
  }
  userContent.push({ type: 'input_text', text: req.prompt });

  const started = Date.now();
  const effort = req.effort ?? config.ai.effort;
  console.log(`[ai:openai:${req.label}] ${config.ai.model} effort=${effort} images=${req.images?.length ?? 0}`);

  const client = injectedClient ?? createClient();
  const response = await client.responses.parse({
    model: config.ai.model,
    input: [
      { role: 'system', content: req.system },
      { role: 'user', content: userContent },
    ],
    reasoning: { effort },
    max_output_tokens: req.maxTokens ?? 25_000,
    text: { format: zodTextFormat(req.schema, req.label) },
    store: false,
  });

  const usage = response.usage;
  console.log(
    `[ai:openai:${req.label}] done in ${Date.now() - started}ms — served by ${response.model}, status=${response.status}, in=${usage?.input_tokens ?? 0} out=${usage?.output_tokens ?? 0} reasoning=${usage?.output_tokens_details?.reasoning_tokens ?? 0}`,
  );

  const refused = response.output.some(item =>
    item.type === 'message' && item.content.some(part => part.type === 'refusal'),
  );
  if (refused) throw new Error('OpenAI declined this request');
  if (response.status === 'incomplete') {
    throw new Error(`OpenAI response was incomplete${response.incomplete_details?.reason ? ` (${response.incomplete_details.reason})` : ''}`);
  }
  if (response.status !== 'completed') {
    throw new Error(`OpenAI response did not complete (${response.status})`);
  }
  if (!response.output_parsed) {
    throw new Error('OpenAI returned no parseable structured output');
  }
  return req.schema.parse(response.output_parsed);
}
