import type { Storage, CachedInsightValue } from './storage.js';
import type { NightInsights } from './ai-insights.js';

const backend = process.env.STORAGE_BACKEND || 'firestore';
if (backend !== 'firestore' && backend !== 'sqlite') {
  throw new Error(`Invalid STORAGE_BACKEND=${backend}; expected firestore or sqlite`);
}

export const store: Storage = backend === 'sqlite'
  ? (await import('./sqlite.js')).sqliteStore
  : (await import('./firestore.js')).firestoreStore;

export const getAnnotation = store.getAnnotation.bind(store);
export const saveAnnotation = store.saveAnnotation.bind(store);
export const deleteAnnotation = store.deleteAnnotation.bind(store);
export const getBabySettings = store.getBabySettings.bind(store);
export const saveBabySettings = store.saveBabySettings.bind(store);
export function getCachedInsight<T extends CachedInsightValue = NightInsights>(babyUid: string, nightKey: string): Promise<T | null> {
  return store.getCachedInsight<T>(babyUid, nightKey);
}
export const cacheInsight = store.cacheInsight.bind(store);
export const getCachedNights = store.getCachedNights.bind(store);
export const cacheNights = store.cacheNights.bind(store);
