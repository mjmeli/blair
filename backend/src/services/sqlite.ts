import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Storage, FeedbackEntry } from './storage.js';
import type { BabySettings } from './storage.js';
import type { SleepAnnotation } from '../types/app.js';
import type { NightSummary } from './sleep-scorer.js';
import type { DayStats } from './stats.js';

export function createSqliteStore(path: string): Storage & { close(): void } {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > 1) throw new Error(`SQLite database schema ${version} is newer than this blAIr build`);
  if (version === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS documents (kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (kind, key));
      CREATE TABLE IF NOT EXISTS ai_usage (day TEXT NOT NULL, scope TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, labels TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (day, scope));
      CREATE TABLE IF NOT EXISTS stats (day TEXT PRIMARY KEY, page_views INTEGER NOT NULL DEFAULT 0, unique_visitors INTEGER NOT NULL DEFAULT 0, logins INTEGER NOT NULL DEFAULT 0, active_babies INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS active_babies (day TEXT NOT NULL, baby_uid TEXT NOT NULL, PRIMARY KEY (day, baby_uid));
      CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS feedback_recent ON feedback(created_at DESC);
      PRAGMA user_version = 1;
    `);
  }

  const read = db.prepare('SELECT value, created_at FROM documents WHERE kind = ? AND key = ?');
  const put = db.prepare('INSERT INTO documents(kind, key, value, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at');
  const del = db.prepare('DELETE FROM documents WHERE kind = ? AND key = ?');
  const get = <T>(kind: string, key: string): { value: T; created_at: number } | null => {
    const row = read.get(kind, key) as { value: string; created_at: number } | undefined;
    return row ? { value: JSON.parse(row.value) as T, created_at: row.created_at } : null;
  };
  const set = (kind: string, key: string, value: unknown) => put.run(kind, key, JSON.stringify(value), Date.now());
  const reserve = db.transaction((day: string, babyUid: string, label: string, perBabyLimit: number, globalLimit: number): 'baby' | 'global' | null => {
    const select = db.prepare('SELECT count, labels FROM ai_usage WHERE day = ? AND scope = ?');
    const baby = select.get(day, babyUid) as { count: number; labels: string } | undefined;
    const global = select.get(day, 'global') as { count: number; labels: string } | undefined;
    if ((baby?.count ?? 0) >= perBabyLimit) return 'baby';
    if ((global?.count ?? 0) >= globalLimit) return 'global';
    const update = db.prepare('INSERT INTO ai_usage(day, scope, count, labels) VALUES (?, ?, ?, ?) ON CONFLICT(day, scope) DO UPDATE SET count = excluded.count, labels = excluded.labels');
    for (const [scope, old] of [[babyUid, baby], ['global', global]] as const) {
      const labels = old ? JSON.parse(old.labels) as Record<string, number> : {};
      labels[label] = (labels[label] ?? 0) + 1;
      update.run(day, scope, (old?.count ?? 0) + 1, JSON.stringify(labels));
    }
    return null;
  });

  return {
    close: () => db.close(),
    async getAnnotation(babyUid, nightKey) { return get<SleepAnnotation>('annotation', `${babyUid}:${nightKey}`)?.value ?? null; },
    async saveAnnotation(annotation) { set('annotation', `${annotation.baby_uid}:${annotation.session_id}`, annotation); },
    async deleteAnnotation(babyUid, nightKey) { del.run('annotation', `${babyUid}:${nightKey}`); },
    async getBabySettings(babyUid) { return get<BabySettings>('settings', babyUid)?.value ?? null; },
    async saveBabySettings(settings) {
      const previous = get<BabySettings>('settings', settings.baby_uid)?.value ?? {};
      set('settings', settings.baby_uid, { ...previous, ...JSON.parse(JSON.stringify(settings)) });
    },
    async getCachedInsight<T>(babyUid: string, nightKey: string): Promise<T | null> {
      const row = get<T>('insight', `${babyUid}:${nightKey}`);
      return row && Date.now() - row.created_at <= 86400000 ? row.value : null;
    },
    async cacheInsight(babyUid, nightKey, insights) { set('insight', `${babyUid}:${nightKey}`, insights); },
    async getCachedNights(babyUid, start, end) { return get<NightSummary[]>('nights', `v1:${babyUid}:${start}:${end}`)?.value ?? null; },
    async cacheNights(babyUid, start, end, nights) { set('nights', `v1:${babyUid}:${start}:${end}`, nights); },
    async reserveAiCall(day, babyUid, label, perBabyLimit, globalLimit) { return reserve(day, babyUid, label, perBabyLimit, globalLimit); },
    async incrementStats(day, fields, babyUid) {
      db.transaction(() => {
        db.prepare('INSERT INTO stats(day) VALUES (?) ON CONFLICT(day) DO NOTHING').run(day);
        const allowed: Array<keyof Omit<DayStats, 'day'>> = ['page_views', 'unique_visitors', 'logins', 'active_babies'];
        for (const field of allowed) {
          const amount = fields[field] ?? 0;
          if (amount) db.prepare(`UPDATE stats SET ${field} = ${field} + ? WHERE day = ?`).run(amount, day);
        }
        if (babyUid) db.prepare('INSERT INTO active_babies(day, baby_uid) VALUES (?, ?) ON CONFLICT(day, baby_uid) DO NOTHING').run(day, babyUid);
      })();
    },
    async getStats(cutoff) { return db.prepare('SELECT day, page_views, unique_visitors, logins, active_babies FROM stats WHERE day >= ? ORDER BY day DESC').all(cutoff) as DayStats[]; },
    async addFeedback(entry: FeedbackEntry) {
      const id = randomUUID();
      db.prepare('INSERT INTO feedback(id, created_at, value) VALUES (?, ?, ?)').run(id, entry.created_at, JSON.stringify(entry));
      return id;
    },
    async getFeedback(limit) {
      const rows = db.prepare('SELECT id, value FROM feedback ORDER BY created_at DESC LIMIT ?').all(limit) as Array<{ id: string; value: string }>;
      return rows.map(row => ({ id: row.id, ...JSON.parse(row.value) as FeedbackEntry }));
    },
  };
}

export const sqliteStore = createSqliteStore(process.env.NODE_ENV === 'test' ? ':memory:' : '/data/blair.db');
