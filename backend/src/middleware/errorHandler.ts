import type { Response } from 'express';
import { NanitAuthError } from '../services/nanit-client.js';

/**
 * Converts a caught error to an appropriate HTTP response.
 * - NanitAuthError -> 401 so the frontend can redirect to login
 * - Anything else -> 500 with the given error code
 */
export function handleRouteError(res: Response, err: any, errorCode: string = 'server_error'): void {
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
