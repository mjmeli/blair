import dotenv from 'dotenv';
dotenv.config();

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
function parseEffort(raw: string | undefined, fallback: Effort): Effort {
  return EFFORTS.includes(raw as Effort) ? (raw as Effort) : fallback;
}

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  analyticsDisabled: ['1', 'true', 'yes'].includes((process.env.DISABLE_ANALYTICS || '').toLowerCase()),
  nanit: {
    baseUrl: 'https://api.nanit.com',
    userAgent: 'Nanit/6.0.0 (iOS; iPhone; Scale/2.00)',
    apiVersion: '1',
    platform: 'unknown',
    serviceVersion: '3.52.0 (882)',
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
  },
  // Claude powers every text + image feature: night insights, night comparison,
  // schedule optimizer, long-term video patterns, and clip/thumbnail analysis.
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.BLAIR_AI_MODEL || 'claude-opus-5',
    // Effort is the main latency/cost lever. "medium" keeps dashboard cards snappy;
    // raise to "high" via BLAIR_AI_EFFORT if you want deeper analysis.
    effort: parseEffort(process.env.BLAIR_AI_EFFORT, 'medium'),
  },
  // Gemini is only used for audio (cry-type) classification, because Claude
  // does not accept audio input.
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
  },
  // Daily caps on AI calls, per baby and across everyone, so a public deploy
  // can't run up the API bill. Cached responses don't count.
  aiBudget: {
    perBabyPerDay: parseInt(process.env.AI_DAILY_LIMIT_PER_BABY || '40', 10),
    globalPerDay: parseInt(process.env.AI_DAILY_LIMIT_GLOBAL || '400', 10),
  },
  // Optional comma-separated allowlist of Nanit account emails. Empty = anyone with a Nanit login.
  allowedEmails: (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean),
  // Feedback form: stored in Firestore always; emailed via Resend when configured.
  feedback: {
    resendApiKey: process.env.RESEND_API_KEY || '',
    toEmail: process.env.FEEDBACK_TO_EMAIL || '',
    fromEmail: process.env.FEEDBACK_FROM_EMAIL || 'blAIr <onboarding@resend.dev>',
  },
};
