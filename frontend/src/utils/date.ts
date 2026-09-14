import { DateTime } from 'luxon';

export function formatAge(birthdateStr: string): string {
  const birthdate = DateTime.fromISO(birthdateStr);
  const now = DateTime.now();
  const diff = now.diff(birthdate, ['years', 'months', 'weeks', 'days']);

  if (diff.years >= 1) {
    const y = Math.floor(diff.years);
    const m = Math.floor(diff.months);
    return m > 0 ? `${y}y ${m}m` : `${y}y`;
  }
  if (diff.months >= 1) {
    const m = Math.floor(diff.months);
    const w = Math.floor(diff.weeks % 4);
    return w > 0 ? `${m}m ${w}w` : `${m}m`;
  }
  if (diff.weeks >= 1) {
    return `${Math.floor(diff.weeks)}w ${Math.floor(diff.days % 7)}d`;
  }
  return `${Math.floor(diff.days)}d`;
}

export function formatTime(isoOrUnix: string | number): string {
  const dt = typeof isoOrUnix === 'number'
    ? DateTime.fromSeconds(isoOrUnix)
    : DateTime.fromISO(isoOrUnix);
  return dt.toFormat('h:mm a');
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function todayStr(): string {
  return DateTime.now().toFormat('yyyy-MM-dd');
}

export function yesterdayStr(): string {
  return DateTime.now().minus({ days: 1 }).toFormat('yyyy-MM-dd');
}

export function dayStart(dateStr: string): number {
  return DateTime.fromISO(dateStr).startOf('day').toSeconds();
}

export function dayEnd(dateStr: string): number {
  return DateTime.fromISO(dateStr).endOf('day').toSeconds();
}
