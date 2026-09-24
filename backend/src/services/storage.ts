import type { SleepAnnotation } from '../types/app.js';
import type { NightSummary } from './sleep-scorer.js';
import type { DayStats } from './stats.js';
import type { BabyMilestones, Pronouns, Sleepwear } from './baby-context.js';

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

export interface FeedbackEntry {
  message: string;
  email: string | null;
  page: string | null;
  kind: string;
  user_agent: string;
  created_at: number;
}

export interface Storage {
  getAnnotation(babyUid: string, nightKey: string): Promise<SleepAnnotation | null>;
  saveAnnotation(annotation: SleepAnnotation): Promise<void>;
  deleteAnnotation(babyUid: string, nightKey: string): Promise<void>;
  getBabySettings(babyUid: string): Promise<BabySettings | null>;
  saveBabySettings(settings: BabySettings): Promise<void>;
  getCachedInsight<T = unknown>(babyUid: string, nightKey: string): Promise<T | null>;
  cacheInsight(babyUid: string, nightKey: string, insights: unknown): Promise<void>;
  getCachedNights(babyUid: string, start: number, end: number): Promise<NightSummary[] | null>;
  cacheNights(babyUid: string, start: number, end: number, nights: NightSummary[]): Promise<void>;
  reserveAiCall(day: string, babyUid: string, label: string, perBabyLimit: number, globalLimit: number): Promise<'baby' | 'global' | null>;
  incrementStats(day: string, fields: Partial<Omit<DayStats, 'day'>>, babyUid?: string): Promise<void>;
  getStats(cutoff: string): Promise<DayStats[]>;
  addFeedback(entry: FeedbackEntry): Promise<string>;
  getFeedback(limit: number): Promise<Array<FeedbackEntry & { id: string }>>;
}
