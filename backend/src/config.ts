import dotenv from 'dotenv';
dotenv.config();

export type AiProvider = 'anthropic' | 'openai';
export type Effort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

function parseAiProvider(raw: string | undefined): AiProvider {
  const provider = raw?.trim().toLowerCase() || 'anthropic';
  if (provider !== 'anthropic' && provider !== 'openai') {
    throw new Error(`Invalid BLAIR_AI_PROVIDER "${raw}". Use "anthropic" or "openai".`);
  }
  return provider;
}

function parseEffort(raw: string | undefined, provider: AiProvider): Effort {
  const effort = raw?.trim().toLowerCase() || 'medium';
  const allowed: Effort[] = provider === 'openai'
    ? ['none', 'low', 'medium', 'high', 'xhigh', 'max']
    : ['low', 'medium', 'high', 'xhigh', 'max'];
  if (!allowed.includes(effort as Effort)) {
    throw new Error(`Invalid BLAIR_AI_EFFORT "${raw}" for ${provider}. Allowed values: ${allowed.join(', ')}.`);
  }
  return effort as Effort;
}

export interface AiSettings {
  provider: AiProvider;
  model: string;
  effort: Effort;
}

export function resolveAiSettings(providerValue?: string, modelValue?: string, effortValue?: string): AiSettings {
  const provider = parseAiProvider(providerValue);
  const model = modelValue?.trim() || (provider === 'openai' ? 'gpt-6-luna' : 'claude-opus-5');
  if (provider === 'openai' && model.startsWith('claude-')) {
    throw new Error(`BLAIR_AI_MODEL "${model}" is a Claude model, but BLAIR_AI_PROVIDER is "openai".`);
  }
  if (provider === 'anthropic' && model.startsWith('gpt-')) {
    throw new Error(`BLAIR_AI_MODEL "${model}" is an OpenAI model, but BLAIR_AI_PROVIDER is "anthropic".`);
  }
  return { provider, model, effort: parseEffort(effortValue, provider) };
}

export function hasProviderApiKey(provider: AiProvider, keys: { anthropic?: string; openai?: string }): boolean {
  return provider === 'openai' ? !!keys.openai : !!keys.anthropic;
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
  // One Claude/OpenAI provider/model powers every text + image feature. Gemini remains separate for audio.
  ai: {
    ...resolveAiSettings(process.env.BLAIR_AI_PROVIDER, process.env.BLAIR_AI_MODEL, process.env.BLAIR_AI_EFFORT),
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
  },
  // Gemini is only used for audio (cry-type) classification.
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
