import { Router } from 'express';
import * as nanit from '../services/nanit-client.js';
import { config } from '../config.js';
import { recordLogin } from '../services/stats.js';

function emailAllowed(email: string): boolean {
  return config.allowedEmails.length === 0 || config.allowedEmails.includes(String(email).trim().toLowerCase());
}

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'bad_request', message: 'Email and password required' });
      return;
    }
    if (!emailAllowed(email)) {
      res.status(403).json({ error: 'not_invited', message: 'This deployment is invite-only right now. Use the feedback link to ask for access.' });
      return;
    }
    const result = await nanit.login(email, password);
    // If MFA is required, the response will include mfa_token
    if (result.mfa_token && !result.access_token) {
      res.status(482).json({
        mfa_required: true,
        mfa_token: result.mfa_token,
        phone_suffix: result.phone_suffix,
        channel: result.channel,
        message: result.message,
      });
      return;
    }
    recordLogin();
    res.json({
      access_token: result.access_token,
      token: result.token,
      refresh_token: result.refresh_token,
    });
  } catch (err: any) {
    res.status(401).json({ error: 'auth_failed', message: err.message });
  }
});

router.post('/mfa', async (req, res) => {
  try {
    const { email, password, mfa_token, mfa_code, channel } = req.body;
    if (!emailAllowed(email)) {
      res.status(403).json({ error: 'not_invited', message: 'This deployment is invite-only right now.' });
      return;
    }
    const result = await nanit.loginMfa(email, password, mfa_token, mfa_code, channel);
    recordLogin();
    res.json({
      access_token: result.access_token,
      token: result.token,
      refresh_token: result.refresh_token,
    });
  } catch (err: any) {
    res.status(401).json({ error: 'mfa_failed', message: err.message });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const { access_token, refresh_token } = req.body;
    const result = await nanit.refreshToken(access_token, refresh_token);
    res.json({
      access_token: result.access_token,
      token: result.token,
      refresh_token: result.refresh_token,
    });
  } catch (err: any) {
    const expired = err instanceof nanit.NanitAuthError;
    res.status(expired ? 401 : 502).json({
      error: expired ? 'refresh_failed' : 'refresh_unavailable',
      message: expired ? 'Your Nanit session has expired.' : 'Nanit is temporarily unavailable. Please try again.',
    });
  }
});

export default router;
