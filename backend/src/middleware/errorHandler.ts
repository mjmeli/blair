import type { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { NanitAuthError } from '../services/nanit-client.js';
import { AiBudgetError } from '../services/ai-budget.js';
import { aiApiErrorResponse } from '../services/ai-api-error.js';

/**
 * Converts a caught error to an appropriate HTTP response.
 * - NanitAuthError (or a raw Nanit 401)  -> 401 so the frontend redirects to login
 * - AI provider API error                -> 502/429 with an ai_error code (never a 401,
 *                                           otherwise a bad provider key logs the user out)
 * - Anything else                        -> 500 with the given error code
 */
export function handleRouteError(res: Response, err: any, errorCode: string = 'server_error'): void {
  if (err instanceof AiBudgetError) {
    res.status(429).json({ error: 'ai_budget_exceeded', message: err.message });
    return;
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 502;
    return handleAiApiError(res, 'Claude', status, err.message, 'ANTHROPIC_API_KEY');
  }
  if (err instanceof OpenAI.APIError) {
    const status = err.status ?? 502;
    return handleAiApiError(res, 'OpenAI', status, err.message, 'OPENAI_API_KEY');
  }

  if (err instanceof NanitAuthError) {
    res.status(401).json({
      error: 'nanit_auth_expired',
      message: 'Your Nanit session has expired. Please sign in again.',
    });
    return;
  }
  // Also catch plain-message 401s that came through as regular Error
  const msg = String(err?.message || '');
  if (msg.includes('401') || msg.includes('Unauthorized')) {
    res.status(401).json({
      error: 'nanit_auth_expired',
      message: 'Your Nanit session has expired. Please sign in again.',
    });
    return;
  }
  res.status(500).json({ error: errorCode, message: msg || 'Internal server error' });
}

function handleAiApiError(res: Response, provider: string, status: number, detail: string, keyName: string): void {
  console.error(`[ai] ${provider} API error ${status}: ${detail}`);
  const response = aiApiErrorResponse(status, detail, keyName);
  res.status(response.status).json(response.body);
}
