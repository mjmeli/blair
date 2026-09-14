import { createHash } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firestore.js';

/**
 * Cookie-free daily usage counters. Visitors are counted by a salted hash of
 * their IP + user agent that rotates daily, so nothing identifies a person
 * across days and nothing is stored in the browser.
 */
const statsCol = () => db.collection('stats');
const SALT = process.env.STATS_SALT || 'blair';

function day(): string {
  return new Date().toISOString().slice(0, 10);
}

function visitorHash(ip: string, ua: string): string {
  return createHash('sha256').update(`${SALT}:${day()}:${ip}:${ua}`).digest('hex').slice(0, 16);
}

// Small in-memory dedupe so a single visitor's 30 asset/API requests don't each hit Firestore
const seenToday = new Map<string, string>(); // hash -> day

async function bump(fields: Record<string, unknown>): Promise<void> {
  await statsCol().doc(day()).set({ day: day(), updated_at: Date.now(), ...fields }, { merge: true }).catch(err => {
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
    page_views: FieldValue.increment(1),
    ...(isNew && { unique_visitors: FieldValue.increment(1) }),
  });
}

/** A successful Nanit sign-in (password step or MFA step that returned tokens). */
export function recordLogin(): void {
  void bump({ logins: FieldValue.increment(1) });
}

/** A baby whose dashboard was opened today (distinct per day). */
export function recordActiveBaby(babyUid: string): void {
  const h = `baby:${babyUid}`;
  if (seenToday.get(h) === day()) return;
  seenToday.set(h, day());
  void bump({ active_babies: FieldValue.increment(1), [`baby_ids.${babyUid}`]: true });
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
  const snap = await statsCol().where('day', '>=', cutoff).orderBy('day', 'desc').get();
  return snap.docs.map(d => {
    const x = d.data();
    return {
      day: x.day,
      page_views: x.page_views ?? 0,
      unique_visitors: x.unique_visitors ?? 0,
      logins: x.logins ?? 0,
      active_babies: x.active_babies ?? 0,
    };
  });
}
