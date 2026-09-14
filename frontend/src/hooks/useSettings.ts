import { useState, useCallback, useEffect, useRef } from 'react';
import * as api from '../services/api';

export interface BabyMilestones {
  rolls_back_to_belly: boolean;
  rolls_belly_to_back: boolean;
  sits_unassisted: boolean;
  pulls_to_stand: boolean;
}

export type Sleepwear = 'swaddle' | 'sleep_sack' | 'none';

export interface SleepSettings {
  bedtimeHour: number;      // 0-23, default 19 (7 PM)
  wakeHour: number;         // 0-23, default 8 (8 AM)
  prematureWeeks: number;   // 0-16, weeks born early (0 = full term)
  milestones: BabyMilestones;
  sleepwear: Sleepwear;
  pacifier: boolean;
  notes: string;            // free text the AI should know
}

const STORAGE_KEY = 'blair_sleep_settings';

export const defaultSettings: SleepSettings = {
  bedtimeHour: 19,
  wakeHour: 8,
  prematureWeeks: 0,
  milestones: { rolls_back_to_belly: false, rolls_belly_to_back: false, sits_unassisted: false, pulls_to_stand: false },
  sleepwear: 'sleep_sack',
  pacifier: false,
  notes: '',
};

function load(): SleepSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaultSettings, ...parsed, milestones: { ...defaultSettings.milestones, ...(parsed.milestones ?? {}) } };
    }
  } catch {
    // corrupt or unavailable localStorage: fall through to defaults
  }
  return defaultSettings;
}

function fromServer(s: api.BabySettings): Partial<SleepSettings> {
  return {
    ...(s.bedtime_hour != null && { bedtimeHour: s.bedtime_hour }),
    ...(s.wake_hour != null && { wakeHour: s.wake_hour }),
    ...(s.premature_weeks != null && { prematureWeeks: s.premature_weeks }),
    ...(s.milestones && { milestones: { ...defaultSettings.milestones, ...s.milestones } }),
    ...(s.sleepwear && { sleepwear: s.sleepwear }),
    ...(s.pacifier != null && { pacifier: s.pacifier }),
    ...(s.notes != null && { notes: s.notes }),
  };
}

function toServer(s: SleepSettings): Omit<api.BabySettings, 'baby_uid' | 'updated_at'> {
  return {
    bedtime_hour: s.bedtimeHour,
    wake_hour: s.wakeHour,
    premature_weeks: s.prematureWeeks,
    milestones: s.milestones,
    sleepwear: s.sleepwear,
    pacifier: s.pacifier,
    notes: s.notes,
  };
}

/**
 * Sleep settings and the baby's developmental profile. localStorage is the
 * fast local copy; when a baby is known the server copy is loaded (it wins)
 * and every change is pushed back so settings follow you across devices.
 */
export function useSettings(babyUid?: string) {
  const [settings, setSettingsState] = useState<SleepSettings>(load);
  const [synced, setSynced] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // Pull the server copy once per baby
  useEffect(() => {
    if (!babyUid) return;
    let cancelled = false;
    api.getBabySettings(babyUid)
      .then(server => {
        if (cancelled) return;
        if (server) {
          setSettingsState(prev => {
            const next = { ...prev, ...fromServer(server) };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
          });
        } else {
          // First device to sync: seed the server with what this browser has
          api.saveBabySettings(babyUid, toServer(load())).catch(() => {});
        }
        setSynced(true);
      })
      .catch(() => { /* offline or server down: keep using the local copy */ });
    return () => { cancelled = true; };
  }, [babyUid]);

  const setSettings = useCallback((patch: Partial<SleepSettings>) => {
    setSettingsState(prev => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      if (babyUid) {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        // Debounce so sliders and typing don't spam the server
        saveTimer.current = window.setTimeout(() => {
          api.saveBabySettings(babyUid, toServer(next)).catch(err => console.error('Settings sync failed:', err));
        }, 600);
      }
      return next;
    });
  }, [babyUid]);

  return { settings, setSettings, synced };
}

/**
 * Calculate adjusted age in months, accounting for prematurity.
 */
export function adjustedAgeMonths(birthdateStr: string, prematureWeeks: number): number {
  const birthdate = new Date(birthdateStr);
  const now = new Date();
  const chronologicalMonths = (now.getFullYear() - birthdate.getFullYear()) * 12 + (now.getMonth() - birthdate.getMonth()) + (now.getDate() - birthdate.getDate()) / 30;
  const adjustmentMonths = prematureWeeks / 4.33; // weeks to months
  return Math.max(0, chronologicalMonths - adjustmentMonths);
}

/**
 * Given a date string (YYYY-MM-DD) and sleep settings,
 * returns the unix timestamps for the night window.
 * "Night of Apr 12" = Apr 12 at bedtimeHour -> Apr 13 at wakeHour + buffer
 */
export function nightWindow(dateStr: string, settings: SleepSettings): { start: number; end: number } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const nightStart = new Date(year, month - 1, day, settings.bedtimeHour, 0, 0);
  const nightEnd = new Date(year, month - 1, day + 1, settings.wakeHour + 4, 0, 0);
  return {
    start: Math.floor(nightStart.getTime() / 1000),
    end: Math.floor(nightEnd.getTime() / 1000),
  };
}
