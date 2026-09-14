import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../config.js';
import type { SleepAnnotation } from '../types/app.js';
import type { NightInsights } from './ai-insights.js';

// Initialize Firebase Admin with default credentials (works on Cloud Run automatically)
if (getApps().length === 0) {
  initializeApp({
    projectId: config.firebase.projectId || 'divine-energy-128120',
  });
}

const db = getFirestore(undefined as any, 'blair');

// ===== SLEEP ANNOTATIONS =====

const annotationsCol = () => db.collection('sleep_annotations');

export async function getAnnotation(babyUid: string, nightKey: string): Promise<SleepAnnotation | null> {
  const docId = `${babyUid}:${nightKey}`;
  const doc = await annotationsCol().doc(docId).get();
  return doc.exists ? (doc.data() as SleepAnnotation) : null;
}

export async function saveAnnotation(annotation: SleepAnnotation): Promise<void> {
  const docId = `${annotation.baby_uid}:${annotation.session_id}`;
  await annotationsCol().doc(docId).set(annotation);
}

// ===== USER SETTINGS =====

const settingsCol = () => db.collection('user_settings');

export interface UserSettings {
  user_id: string;
  bedtime_hour: number;
  wake_hour: number;
  premature_weeks: number;
  updated_at: number;
}

export async function getSettings(userId: string): Promise<UserSettings | null> {
  const doc = await settingsCol().doc(userId).get();
  return doc.exists ? (doc.data() as UserSettings) : null;
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  await settingsCol().doc(settings.user_id).set(settings);
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

// ===== SLEEP HISTORY =====
// Store nightly scores for fast trend queries without re-calling Nanit API

const historyCol = () => db.collection('sleep_history');

export interface SleepHistoryEntry {
  baby_uid: string;
  date: string;
  score: number;
  total_sleep_minutes: number;
  wake_count: number;
  longest_stretch_minutes: number;
  bedtime: string;
  wake_time: string;
  created_at: number;
}

export async function saveSleepHistory(entry: SleepHistoryEntry): Promise<void> {
  const docId = `${entry.baby_uid}:${entry.date}`;
  await historyCol().doc(docId).set(entry);
}

export async function getSleepHistory(babyUid: string, days: number): Promise<SleepHistoryEntry[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const snapshot = await historyCol()
    .where('baby_uid', '==', babyUid)
    .where('date', '>=', cutoffStr)
    .orderBy('date', 'asc')
    .get();

  return snapshot.docs.map(doc => doc.data() as SleepHistoryEntry);
}
