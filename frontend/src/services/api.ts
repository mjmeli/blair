import type {
  NanitTokens,
  MfaChallenge,
  Baby,
  CalendarEvent,
  NanitMessage,
} from '../types';

const BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('blair_access_token');
}

function setTokens(tokens: NanitTokens) {
  localStorage.setItem('blair_access_token', tokens.access_token);
  localStorage.setItem('blair_token', tokens.token);
  localStorage.setItem('blair_refresh_token', tokens.refresh_token);
}

function clearTokens() {
  localStorage.removeItem('blair_access_token');
  localStorage.removeItem('blair_token');
  localStorage.removeItem('blair_refresh_token');
}

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    // Try to refresh token
    const refreshToken = localStorage.getItem('blair_refresh_token');
    const accessToken = getToken();
    if (refreshToken && accessToken) {
      try {
        const refreshRes = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
        });
        if (refreshRes.ok) {
          const newTokens = await refreshRes.json();
          setTokens(newTokens);
          // Retry original request with new token
          return fetch(url, {
            ...options,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${newTokens.access_token}`,
              ...options.headers,
            },
          });
        }
      } catch {
        // Refresh failed, clear tokens
      }
    }
    clearTokens();
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  return res;
}

// Auth
export async function login(email: string, password: string): Promise<NanitTokens | MfaChallenge> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (res.status === 482 || data.mfa_required) {
    return data as MfaChallenge;
  }
  if (!res.ok) throw new Error(data.message || 'Login failed');

  setTokens(data);
  return data as NanitTokens;
}

export async function loginMfa(
  email: string,
  password: string,
  mfaToken: string,
  mfaCode: string,
  channel: string,
): Promise<NanitTokens> {
  const res = await fetch(`${BASE}/auth/mfa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, mfa_token: mfaToken, mfa_code: mfaCode, channel }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'MFA verification failed');

  setTokens(data);
  return data;
}

export function logout() {
  clearTokens();
  window.location.href = '/login';
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

// Babies
export async function getBabies(): Promise<Baby[]> {
  const res = await authFetch(`${BASE}/babies`);
  const data = await res.json();
  return data.babies;
}

// Sleep (derived from calendar auto_sleep entries)
export async function getSleepScore(babyUid: string, start: number, end: number, birthdate: string, prematureWeeks: number = 0): Promise<any[]> {
  const params = new URLSearchParams({
    start: String(start),
    end: String(end),
    birthdate,
    premature_weeks: String(prematureWeeks),
    tz_offset: String(new Date().getTimezoneOffset()),
  });
  const res = await authFetch(`${BASE}/babies/${babyUid}/sleep/score?${params}`);
  const data = await res.json();
  return data.scores || [];
}

export async function updateSleepAnnotation(
  babyUid: string,
  sessionId: string,
  customStartTime?: number,
  customEndTime?: number,
  notes?: string,
): Promise<void> {
  await authFetch(`${BASE}/babies/${babyUid}/sleep/${sessionId}`, {
    method: 'PUT',
    body: JSON.stringify({
      custom_start_time: customStartTime,
      custom_end_time: customEndTime,
      notes,
    }),
  });
}

// Sleep trend (multi-day)
export interface TrendPoint {
  date: string;
  score: number | null;
  total_sleep_minutes: number | null;
  wake_count?: number;
  longest_stretch_minutes?: number;
  bedtime?: string;
  wake_time?: string;
}

export async function getSleepTrend(
  babyUid: string,
  birthdate: string,
  days: number = 7,
  bedtimeHour: number = 19,
  wakeHour: number = 8,
  prematureWeeks: number = 0,
): Promise<TrendPoint[]> {
  const params = new URLSearchParams({
    birthdate,
    days: String(days),
    bedtime_hour: String(bedtimeHour),
    wake_hour: String(wakeHour),
    premature_weeks: String(prematureWeeks),
    tz_offset: String(new Date().getTimezoneOffset()),
  });
  const res = await authFetch(`${BASE}/babies/${babyUid}/sleep/trend?${params}`);
  const data = await res.json();
  return data.trend || [];
}

// AI Insights
export interface NightInsights {
  summary: string;
  keyFactors: { positive: string[]; negative: string[] };
  comparison: string;
  patterns: string[];
  tip: string;
}

export async function getInsights(
  babyUid: string,
  start: number,
  end: number,
  birthdate: string,
  prematureWeeks: number = 0,
  bedtimeHour: number = 19,
  wakeHour: number = 8,
  force = false,
): Promise<NightInsights> {
  const params = new URLSearchParams({
    start: String(start),
    end: String(end),
    birthdate,
    premature_weeks: String(prematureWeeks),
    bedtime_hour: String(bedtimeHour),
    wake_hour: String(wakeHour),
    tz_offset: String(new Date().getTimezoneOffset()),
    ...(force ? { force: 'true' } : {}),
  });
  const res = await authFetch(`${BASE}/babies/${babyUid}/sleep/insights?${params}`);
  const data = await res.json();
  let insights = data.insights;

  // Defensive: backend may return insights as a JSON string (e.g. from stale cache)
  if (typeof insights === 'string') {
    try { insights = JSON.parse(insights); } catch { /* leave as-is */ }
  }
  // Defensive: Gemini sometimes stuffs the full JSON blob into the summary field
  if (insights && typeof insights.summary === 'string' && insights.summary.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(insights.summary);
      if (parsed && typeof parsed.summary === 'string' && !parsed.summary.trim().startsWith('{')) {
        insights = parsed;
      }
    } catch { /* leave as-is */ }
  }

  return insights;
}

// Events
export async function getEvents(babyUid: string, type?: string, limit = 100): Promise<NanitMessage[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (type) params.set('type', type);
  const res = await authFetch(`${BASE}/babies/${babyUid}/events?${params}`);
  const data = await res.json();
  return data.messages || [];
}

// Video events (with clip URLs)
export async function getVideoEvents(babyUid: string, limit = 20): Promise<any> {
  const res = await authFetch(`${BASE}/babies/${babyUid}/video/events?limit=${limit}`);
  return res.json();
}

export async function analyzeVideoClip(
  babyUid: string,
  clipUrl: string | null,
  thumbnailUrl: string | null,
  eventType: string,
  eventTitle: string,
  birthdate: string,
  prematureWeeks: number,
): Promise<any> {
  const res = await authFetch(`${BASE}/babies/${babyUid}/video/analyze`, {
    method: 'POST',
    body: JSON.stringify({
      clip_url: clipUrl,
      thumbnail_url: thumbnailUrl,
      event_type: eventType,
      event_title: eventTitle,
      birthdate,
      premature_weeks: prematureWeeks,
    }),
  });
  return res.json();
}

export async function getVideoStatus(babyUid: string): Promise<{ ffmpeg_available: boolean; gemini_available: boolean }> {
  const res = await authFetch(`${BASE}/babies/${babyUid}/video/status`);
  return res.json();
}

// Long-term video patterns across multiple nights
export interface VideoPatterns {
  summary: string;
  patterns: Array<{ title: string; observation: string; evidence: string[] }>;
  correlations: Array<{ factor: string; impact: string; nights_affected: number }>;
  environmental_trends: string[];
  behavioral_trends: string[];
  recommendations: string[];
}

export async function getVideoPatterns(
  babyUid: string,
  birthdate: string,
  prematureWeeks: number,
  days: number = 5,
  bedtimeHour: number = 19,
  wakeHour: number = 8,
): Promise<{ patterns: VideoPatterns | null; nights_analyzed?: number; events_analyzed?: number; message?: string }> {
  const params = new URLSearchParams({
    birthdate,
    premature_weeks: String(prematureWeeks),
    days: String(days),
    bedtime_hour: String(bedtimeHour),
    wake_hour: String(wakeHour),
    tz_offset: String(new Date().getTimezoneOffset()),
  });
  const res = await authFetch(`${BASE}/babies/${babyUid}/video/patterns?${params}`);
  return res.json();
}

// Care
export async function getCareEvents(babyUid: string, start: number, end: number): Promise<{ events: CalendarEvent[]; all_types: string[] }> {
  const res = await authFetch(`${BASE}/babies/${babyUid}/care?start=${start}&end=${end}`);
  const data = await res.json();
  return { events: data.events || [], all_types: data.all_types || [] };
}
