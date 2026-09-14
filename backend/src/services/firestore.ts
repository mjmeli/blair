import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../config.js';
import type { SleepAnnotation } from '../types/app.js';
import type { NightInsights } from './ai-insights.js';
import type { NightSummary } from './sleep-scorer.js';
import type { BabyMilestones, Pronouns, Sleepwear } from './baby-context.js';

// Initialize Firebase Admin with default credentials (works on Cloud Run automatically)
if (getApps().length === 0) {
  initializeApp({
    projectId: config.firebase.projectId || 'divine-energy-128120',
  });
}

export const db = getFirestore(undefined as any, 'blair');

// ===== SLEEP ANNOTATIONS =====

const annotationsCol = () => db.collection('sleep_annotations');

export async function getAnnotation(babyUid: string, nightKey: string): Promise<SleepAnnotation | null> {
  const docId = `${babyUid}:${nightKey}`;
  const doc = await annotationsCol().doc(docId).get();
  return doc.exists ? (doc.data() as SleepAnnotation) : null;
}

export async function saveAnnotation(annotation: SleepAnnotation): Promise<void> {
  const docId = `${annotation.baby_uid}:${annotation.session_id}`;
  // Firestore rejects undefined values, so drop absent optional fields
  const clean = Object.fromEntries(Object.entries(annotation).filter(([, v]) => v !== undefined));
  await annotationsCol().doc(docId).set(clean);
}

export async function deleteAnnotation(babyUid: string, nightKey: string): Promise<void> {
  await annotationsCol().doc(`${babyUid}:${nightKey}`).delete();
}

// ===== BABY SETTINGS =====
// Sleep settings + developmental profile, keyed by baby so they follow the
// parent across devices and are available server-side for AI prompts.

const settingsCol = () => db.collection('baby_settings');

export interface BabySettings {
  baby_uid: string;
  name?: string;
  pronouns?: Pronouns;
  bedtime_hour?: number;
  wake_hour?: number;
  premature_weeks?: number;
  milestones?: Partial<BabyMilestones>;
  sleepwear?: Sleepwear;
  pacifier?: boolean;
  notes?: string;
  updated_at: number;
}

export async function getBabySettings(babyUid: string): Promise<BabySettings | null> {
  const doc = await settingsCol().doc(babyUid).get();
  return doc.exists ? (doc.data() as BabySettings) : null;
}

export async function saveBabySettings(settings: BabySettings): Promise<void> {
  const clean = JSON.parse(JSON.stringify(settings)); // strip undefined
  await settingsCol().doc(settings.baby_uid).set(clean, { merge: true });
}

// ===== CACHED INSIGHTS =====

const insightsCol = () => db.collection('cached_insights');

interface CachedInsight {
  baby_uid: string;
  night_key: string;
  insights: NightInsights;
  created_at: number;
}

export async function getCachedInsight(babyUid: string, nightKey: string): Promise<NightInsights | null> {
  const docId = `${babyUid}:${nightKey}`;
  const doc = await insightsCol().doc(docId).get();
  if (!doc.exists) return null;
  const data = doc.data() as CachedInsight;
  // Cache expires after 24 hours
  if (Date.now() - data.created_at > 24 * 60 * 60 * 1000) return null;
  return data.insights;
}

export async function cacheInsight(babyUid: string, nightKey: string, insights: NightInsights): Promise<void> {
  const docId = `${babyUid}:${nightKey}`;
  await insightsCol().doc(docId).set({
    baby_uid: babyUid,
    night_key: nightKey,
    insights,
    created_at: Date.now(),
  });
}

// ===== NIGHT CACHE =====
// Raw Nanit sleep segments for a completed night window. Scores are NOT cached
// here on purpose: annotations, age, and settings can change how a night is
// scored, but the underlying segments from Nanit do not.

const nightCacheCol = () => db.collection('night_cache');

interface CachedNights {
  baby_uid: string;
  start: number;
  end: number;
  nights: NightSummary[];
  cached_at: number;
}

const NIGHT_CACHE_VERSION = 'v1';

export async function getCachedNights(babyUid: string, start: number, end: number): Promise<NightSummary[] | null> {
  const doc = await nightCacheCol().doc(`${NIGHT_CACHE_VERSION}:${babyUid}:${start}:${end}`).get();
  if (!doc.exists) return null;
  return (doc.data() as CachedNights).nights;
}

export async function cacheNights(babyUid: string, start: number, end: number, nights: NightSummary[]): Promise<void> {
  const entry: CachedNights = { baby_uid: babyUid, start, end, nights, cached_at: Date.now() };
  await nightCacheCol().doc(`${NIGHT_CACHE_VERSION}:${babyUid}:${start}:${end}`).set(entry);
}
