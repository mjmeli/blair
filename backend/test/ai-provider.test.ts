import test from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import { hasProviderApiKey, resolveAiSettings } from '../src/config.js';
import { generateClaudeStructured } from '../src/services/claude.js';
import { generateOpenAIStructured } from '../src/services/openai-adapter.js';
import { aiApiErrorResponse } from '../src/services/ai-api-error.js';
import { handleRouteError } from '../src/middleware/errorHandler.js';

const ResultSchema = z.object({ result: z.string() });
const jpegData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]).toString('base64');
const pngData = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64');
const request = {
  label: 'test',
  schema: ResultSchema,
  system: 'Return the result.',
  prompt: 'Say hello.',
};

function openAIResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'response_test',
    object: 'response',
    created_at: 1,
    model: 'gpt-6-luna',
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"result":"hello"}', annotations: [], logprobs: [], parsed: { result: 'hello' } }], id: 'message_test', status: 'completed' }],
    output_parsed: { result: 'hello' },
    output_text: '{"result":"hello"}',
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 1 } },
    incomplete_details: null,
    error: null,
    ...overrides,
  };
}

function mockOpenAI(response: unknown, onParse: (body: any) => void = () => {}): OpenAI {
  return {
    responses: {
      parse: async (body: any) => {
        onParse(body);
        return response;
      },
    },
  } as unknown as OpenAI;
}

test('provider defaults preserve Claude and choose Luna for OpenAI', () => {
  assert.deepEqual(resolveAiSettings(), { provider: 'anthropic', model: 'claude-opus-5', effort: 'medium' });
  assert.deepEqual(resolveAiSettings('openai'), { provider: 'openai', model: 'gpt-6-luna', effort: 'medium' });
  assert.deepEqual(resolveAiSettings('openai', 'gpt-6-sol', 'high'), { provider: 'openai', model: 'gpt-6-sol', effort: 'high' });
  assert.deepEqual(resolveAiSettings('openai', 'gpt-6-luna', 'none'), { provider: 'openai', model: 'gpt-6-luna', effort: 'none' });
  assert.throws(() => resolveAiSettings('openai', 'claude-sonnet-5'), /Claude model/);
  assert.throws(() => resolveAiSettings('anthropic', 'gpt-6-sol'), /OpenAI model/);
});

test('provider key availability uses only the selected provider key', () => {
  assert.equal(hasProviderApiKey('anthropic', { anthropic: 'ant-key' }), true);
  assert.equal(hasProviderApiKey('anthropic', { openai: 'oa-key' }), false);
  assert.equal(hasProviderApiKey('openai', { openai: 'oa-key' }), true);
  assert.equal(hasProviderApiKey('openai', { anthropic: 'ant-key' }), false);
});

test('OpenAI adapter sends text-only structured output with storage disabled', async () => {
  let body: any;
  const result = await generateOpenAIStructured(request, mockOpenAI(openAIResponse(), value => { body = value; }));
  assert.deepEqual(result, { result: 'hello' });
  assert.equal(body.store, false);
  assert.equal(body.input[0].role, 'system');
  assert.equal(body.input[1].content[0].text, request.prompt);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.max_output_tokens, 25_000);
});

test('OpenAI adapter preserves image labels and image order in multimodal input', async () => {
  let body: any;
  await generateOpenAIStructured({
    ...request,
    images: [
      { mimeType: 'application/octet-stream', data: jpegData, label: 'Frame 1' },
      { mimeType: 'image/jpeg', data: pngData, label: 'Frame 2' },
    ],
  }, mockOpenAI(openAIResponse(), value => { body = value; }));
  const content = body.input[1].content;
  assert.deepEqual(content.map((item: any) => item.type), ['input_text', 'input_image', 'input_text', 'input_image', 'input_text']);
  assert.equal(content[0].text, 'Frame 1');
  assert.equal(content[1].image_url, `data:image/jpeg;base64,${jpegData}`);
  assert.equal(content[2].text, 'Frame 2');
  assert.equal(content[3].image_url, `data:image/png;base64,${pngData}`);
  assert.equal(content[4].text, request.prompt);
});

test('OpenAI adapter rejects unsupported image bytes before sending a request', async () => {
  let sent = false;
  await assert.rejects(
    generateOpenAIStructured({ ...request, images: [{ mimeType: 'image/jpeg', data: 'bm90IGFuIGltYWdl' }] }, mockOpenAI(openAIResponse(), () => { sent = true; })),
    /Unsupported image format/,
  );
  assert.equal(sent, false);
});

test('OpenAI adapter rejects refusals, incomplete responses, and absent parsed output', async () => {
  await assert.rejects(
    generateOpenAIStructured(request, mockOpenAI(openAIResponse({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'declined' }] }] }))),
    /declined this request/,
  );
  await assert.rejects(
    generateOpenAIStructured(request, mockOpenAI(openAIResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }))),
    /incomplete \(max_output_tokens\)/,
  );
  await assert.rejects(generateOpenAIStructured(request, mockOpenAI(openAIResponse({ output_parsed: null }))), /no parseable structured output/);
});

test('Claude adapter retains the current structured request behavior', async () => {
  let body: any;
  const client = {
    beta: {
      messages: {
        parse: async (value: any) => {
          body = value;
          return {
            model: 'claude-opus-5',
            stop_reason: 'end_turn',
            parsed_output: { result: 'hello' },
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      },
    },
  } as unknown as Anthropic;
  const result = await generateClaudeStructured({ ...request, images: [{ mimeType: 'image/jpeg', data: 'aGVsbG8=', label: 'Camera frame' }] }, client);
  assert.deepEqual(result, { result: 'hello' });
  assert.equal(body.messages[0].content[0].text, 'Camera frame');
  assert.equal(body.messages[0].content[1].type, 'image');
  assert.equal('fallbacks' in body, false);
});

test('OpenAI authentication and rate limit errors map to AI responses', () => {
  const unauthorized = aiApiErrorResponse(401, 'Unauthorized', 'OPENAI_API_KEY');
  assert.equal(unauthorized.status, 502);
  assert.equal(unauthorized.body.error, 'ai_error');
  assert.match(unauthorized.body.message, /Check OPENAI_API_KEY/);

  const rateLimited = aiApiErrorResponse(429, 'Rate limited', 'OPENAI_API_KEY');
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.body.error, 'ai_error');
  assert.match(rateLimited.body.message, /rate-limited/);
});

test('provider API errors do not look like expired Nanit sessions', () => {
  const captureResponse = () => {
    let status = 0;
    let body: unknown;
    const res = {
      status(code: number) { status = code; return this; },
      json(value: unknown) { body = value; return this; },
    } as any;
    return { res, get status() { return status; }, get body() { return body; } };
  };

  const auth = captureResponse();
  handleRouteError(auth.res, new OpenAI.APIError(401, { message: 'Unauthorized' }, 'Unauthorized', new Headers()));
  assert.equal(auth.status, 502);
  assert.equal((auth.body as any).error, 'ai_error');
  assert.match((auth.body as any).message, /OPENAI_API_KEY/);

  const rateLimit = captureResponse();
  handleRouteError(rateLimit.res, new OpenAI.APIError(429, { message: 'Rate limited' }, 'Rate limited', new Headers()));
  assert.equal(rateLimit.status, 429);
  assert.equal((rateLimit.body as any).error, 'ai_error');
});
