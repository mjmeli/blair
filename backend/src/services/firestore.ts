import { initializeApp, getApps } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { config } from '../config.js';
import type { SleepAnnotation } from '../types/app.js';
import type { NightInsights } from './ai-insights.js';
import type { NightSummary } from './sleep-scorer.js';
import type { Storage, FeedbackEntry, BabySettings, CachedInsightValue } from './storage.js';
import type { DayStats } from './stats.js';

// Initialize Firebase Admin with default credentials (works on Cloud Run automatically).
// Project comes from FIREBASE_PROJECT_ID; if unset, the SDK infers it from the environment.
if (getApps().length === 0) {
  initializeApp(config.firebase.projectId ? { projectId: config.firebase.projectId } : undefined);
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
  insights: CachedInsightValue;
  created_at: number;
}

export async function getCachedInsight<T extends CachedInsightValue = NightInsights>(babyUid: string, nightKey: string): Promise<T | null> {
  const docId = `${babyUid}:${nightKey}`;
  const doc = await insightsCol().doc(docId).get();
  if (!doc.exists) return null;
  const data = doc.data() as CachedInsight;
  // Cache expires after 24 hours
  if (Date.now() - data.created_at > 24 * 60 * 60 * 1000) return null;
  return data.insights as T;
}

export async function cacheInsight(babyUid: string, nightKey: string, insights: CachedInsightValue): Promise<void> {
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

export const firestoreStore: Storage = {
  getAnnotation, saveAnnotation, deleteAnnotation, getBabySettings, saveBabySettings,
  getCachedInsight, cacheInsight, getCachedNights, cacheNights,
  async reserveAiCall(day, babyUid, label, perBabyLimit, globalLimit) {
    const usage = db.collection('ai_usage');
    const babyRef = usage.doc(`${day}:${babyUid}`);
    const globalRef = usage.doc(`${day}:global`);
    return db.runTransaction(async tx => {
      const [babyDoc, globalDoc] = await Promise.all([tx.get(babyRef), tx.get(globalRef)]);
      if (((babyDoc.data()?.count as number) ?? 0) >= perBabyLimit) return 'baby';
      if (((globalDoc.data()?.count as number) ?? 0) >= globalLimit) return 'global';
      tx.set(babyRef, { day, baby_uid: babyUid, count: FieldValue.increment(1), [`by_label.${label}`]: FieldValue.increment(1), updated_at: Date.now() }, { merge: true });
      tx.set(globalRef, { day, count: FieldValue.increment(1), [`by_label.${label}`]: FieldValue.increment(1), updated_at: Date.now() }, { merge: true });
      return null;
    });
  },
  async incrementStats(day, fields, babyUid) {
    await db.collection('stats').doc(day).set({
      day, updated_at: Date.now(),
      ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, FieldValue.increment(value as number)])),
      ...(babyUid && { [`baby_ids.${babyUid}`]: true }),
    }, { merge: true });
  },
  async getStats(cutoff): Promise<DayStats[]> {
    const snap = await db.collection('stats').where('day', '>=', cutoff).orderBy('day', 'desc').get();
    return snap.docs.map(doc => {
      const row = doc.data();
      return { day: row.day, page_views: row.page_views ?? 0, unique_visitors: row.unique_visitors ?? 0, logins: row.logins ?? 0, active_babies: row.active_babies ?? 0 };
    });
  },
  async addFeedback(entry: FeedbackEntry) {
    const doc = await db.collection('feedback').add(entry);
    return doc.id;
  },
  async getFeedback(limit) {
    const snap = await db.collection('feedback').orderBy('created_at', 'desc').limit(limit).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() as FeedbackEntry }));
  },
};
