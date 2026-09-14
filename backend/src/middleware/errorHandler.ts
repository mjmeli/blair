import type { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { NanitAuthError } from '../services/nanit-client.js';
import { AiBudgetError } from '../services/ai-budget.js';

/**
 * Converts a caught error to an appropriate HTTP response.
 * - NanitAuthError (or a raw Nanit 401)  -> 401 so the frontend redirects to login
 * - Anthropic API error                  -> 502 with an ai_error code (never a 401,
 *                                           otherwise a bad API key would log the user out)
 * - Anything else                        -> 500 with the given error code
 */
export function handleRouteError(res: Response, err: any, errorCode: string = 'server_error'): void {
  if (err instanceof AiBudgetError) {
    res.status(429).json({ error: 'ai_budget_exceeded', message: err.message });
    return;
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 502;
    console.error(`[ai] Anthropic API error ${status}: ${err.message}`);
    res.status(status === 429 ? 429 : 502).json({
      error: 'ai_error',
      message:
        status === 401
          ? 'The AI service rejected the API key. Check ANTHROPIC_API_KEY on the server.'
          : status === 429
            ? 'The AI service is rate-limited right now. Try again in a minute.'
            : `AI request failed: ${err.message}`,
    });
    return;
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
