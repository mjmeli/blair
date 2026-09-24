import { createHash } from 'crypto';
import { store } from './store.js';

/**
 * Cookie-free daily usage counters. Visitors are counted by a salted hash of
 * their IP + user agent that rotates daily, so nothing identifies a person
 * across days and nothing is stored in the browser.
 */
const SALT = process.env.STATS_SALT || 'blair';

function day(): string {
  return new Date().toISOString().slice(0, 10);
}

function visitorHash(ip: string, ua: string): string {
  return createHash('sha256').update(`${SALT}:${day()}:${ip}:${ua}`).digest('hex').slice(0, 16);
}

// Small in-memory dedupe so a single visitor's 30 asset/API requests don't each hit Firestore
const seenToday = new Map<string, string>(); // hash -> day

async function bump(fields: Partial<Omit<DayStats, 'day'>>, babyUid?: string): Promise<void> {
  await store.incrementStats(day(), fields, babyUid).catch(err => {
    console.log(`[stats] write failed: ${err.message}`);
  });
}

/** A page load of the SPA shell. */
export function recordPageView(ip: string, ua: string): void {
  const h = visitorHash(ip, ua);
  const isNew = seenToday.get(h) !== day();
  seenToday.set(h, day());
  if (seenToday.size > 5000) seenToday.clear();
  void bump({
    page_views: 1,
    ...(isNew && { unique_visitors: 1 }),
  });
}

/** A successful Nanit sign-in (password step or MFA step that returned tokens). */
export function recordLogin(): void {
  void bump({ logins: 1 });
}

/** A baby whose dashboard was opened today (distinct per day). */
export function recordActiveBaby(babyUid: string): void {
  const h = `baby:${babyUid}`;
  if (seenToday.get(h) === day()) return;
  seenToday.set(h, day());
  void bump({ active_babies: 1 }, babyUid);
}

export interface DayStats {
  day: string;
  page_views: number;
  unique_visitors: number;
  logins: number;
  active_babies: number;
}

export async function getStats(days: number): Promise<DayStats[]> {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return store.getStats(cutoff);
}
