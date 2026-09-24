import { Router } from 'express';
import { config } from '../config.js';
import { store } from '../services/store.js';

const router = Router();

// Per-IP rate limit: 5 submissions per hour, in memory (fine for a single small instance)
const recent = new Map<string, number[]>();
function allowed(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter(t => now - t < 60 * 60 * 1000);
  if (hits.length >= 5) return false;
  hits.push(now);
  recent.set(ip, hits);
  return true;
}

async function emailFeedback(subject: string, body: string, replyTo?: string): Promise<boolean> {
  const { resendApiKey, toEmail, fromEmail } = config.feedback;
  if (!resendApiKey || !toEmail) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromEmail, to: [toEmail], subject, text: body, ...(replyTo && { reply_to: replyTo }) }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    console.error(`[feedback] Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return false;
  }
  return true;
}

/**
 * Anonymous feedback / bug report. No Nanit token required so login problems
 * can be reported too. The destination address lives only in server env.
 */
router.post('/', async (req, res) => {
  try {
    const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
    const { message, email, page, kind, website } = req.body ?? {};

    // Honeypot: real users never fill "website"
    if (website) { res.json({ ok: true }); return; }
    if (typeof message !== 'string' || message.trim().length < 3) {
      res.status(400).json({ error: 'bad_request', message: 'Add a few more words so I know what to look at.' });
      return;
    }
    if (!allowed(ip)) {
      res.status(429).json({ error: 'rate_limited', message: 'Too many submissions from this network. Try again in an hour.' });
      return;
    }

    const entry = {
      message: message.trim().slice(0, 4000),
      email: typeof email === 'string' && email.includes('@') ? email.trim().slice(0, 200) : null,
      page: typeof page === 'string' ? page.slice(0, 200) : null,
      kind: kind === 'bug' ? 'bug' : 'feedback',
      user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
      created_at: Date.now(),
    };
    const feedbackId = await store.addFeedback(entry);

    const subject = `[blAIr ${entry.kind}] ${entry.message.slice(0, 60).replace(/\s+/g, ' ')}`;
    const body = `${entry.message}\n\n—\nFrom: ${entry.email ?? 'not provided'}\nPage: ${entry.page ?? '?'}\nUA: ${entry.user_agent}\nFeedback: ${feedbackId}`;
    const emailed = await emailFeedback(subject, body, entry.email ?? undefined).catch(err => {
      console.error(`[feedback] email failed: ${err.message}`);
      return false;
    });

    res.json({ ok: true, emailed });
  } catch (err: any) {
    console.error('[feedback] error:', err.message);
    res.status(500).json({ error: 'feedback_failed', message: 'Could not save your feedback. Please try again.' });
  }
});

export default router;
