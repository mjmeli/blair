import type { Request, Response, NextFunction } from 'express';

// Simple middleware that extracts the Nanit token from the Authorization header
// and makes it available on the request object.
// The actual token is managed client-side (stored in localStorage).
export function requireToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid authorization header' });
    return;
  }
  (req as any).nanitToken = authHeader.slice(7);
  next();
}
