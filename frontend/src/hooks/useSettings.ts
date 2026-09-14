import { useState, useCallback } from 'react';

export interface SleepSettings {
  bedtimeHour: number;      // 0-23, default 19 (7 PM)
  wakeHour: number;         // 0-23, default 8 (8 AM)
  prematureWeeks: number;   // 0-16, weeks born early (0 = full term)
}

const STORAGE_KEY = 'blair_sleep_settings';

const defaults: SleepSettings = {
  bedtimeHour: 19,
  wakeHour: 8,
  prematureWeeks: 5, // Blair was 5 weeks premature
};

function load(): SleepSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return defaults;
}

export function useSettings() {
  const [settings, setSettingsState] = useState<SleepSettings>(load);

  const setSettings = useCallback((patch: Partial<SleepSettings>) => {
    setSettingsState(prev => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { settings, setSettings };
}

/**
 * Calculate adjusted age in months, accounting for prematurity.
 */
export function adjustedAgeMonths(birthdateStr: string, prematureWeeks: number): number {
  const birthdate = new Date(birthdateStr);
  const now = new Date();
  const chronologicalMonths = (now.getFullYear() - birthdate.getFullYear()) * 12 + now.getMonth() - birthdate.getMonth();
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
