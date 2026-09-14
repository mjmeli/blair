import type { NanitCalendarEntry } from '../types/nanit.js';
import type { SleepAnnotation, SleepScoreBreakdown } from '../types/app.js';

// ===== AGE-ADJUSTED EXPECTATIONS =====
// All keyed by adjusted age in months

interface AgeExpectations {
  nightSleepHours: { min: number; ideal: number; max: number };
  expectedWakes: number;      // Normal number of night wakes
  maxNormalWakes: number;     // Above this is genuinely disruptive
  normalWakeDuration: number; // Minutes - a feeding wake is expected to last this long
  maxNormalWakeDuration: number; // Minutes - beyond this is excessive
  idealBedtimeRange: [number, number]; // Hour range (e.g. [18.5, 20.5])
}

const AGE_EXPECTATIONS: { maxMonths: number; expectations: AgeExpectations }[] = [
  {
    maxMonths: 1, // 0-1 month adjusted
    expectations: {
      nightSleepHours: { min: 7, ideal: 8.5, max: 10 },
      expectedWakes: 4,
      maxNormalWakes: 6,
      normalWakeDuration: 30,
      maxNormalWakeDuration: 60,
      idealBedtimeRange: [19, 23], // Very flexible for newborns
    },
  },
  {
    maxMonths: 2, // 1-2 months adjusted
    expectations: {
      nightSleepHours: { min: 8, ideal: 9.5, max: 11 },
      expectedWakes: 3,
      maxNormalWakes: 5,
      normalWakeDuration: 25,
      maxNormalWakeDuration: 50,
      idealBedtimeRange: [19, 22],
    },
  },
  {
    maxMonths: 3, // 2-3 months adjusted
    expectations: {
      nightSleepHours: { min: 8, ideal: 10, max: 12 },
      expectedWakes: 3,
      maxNormalWakes: 4,
      normalWakeDuration: 20,
      maxNormalWakeDuration: 45,
      idealBedtimeRange: [18.5, 21],
    },
  },
  {
    maxMonths: 4, // 3-4 months adjusted
    expectations: {
      nightSleepHours: { min: 9, ideal: 10.5, max: 12 },
      expectedWakes: 2,
      maxNormalWakes: 4,
      normalWakeDuration: 20,
      maxNormalWakeDuration: 40,
      idealBedtimeRange: [18.5, 20.5],
    },
  },
  {
    maxMonths: 6, // 4-6 months adjusted
    expectations: {
      nightSleepHours: { min: 9, ideal: 11, max: 12 },
      expectedWakes: 2,
      maxNormalWakes: 3,
      normalWakeDuration: 15,
      maxNormalWakeDuration: 30,
      idealBedtimeRange: [18, 20],
    },
  },
  {
    maxMonths: 9, // 6-9 months adjusted
    expectations: {
      nightSleepHours: { min: 9.5, ideal: 11, max: 12 },
      expectedWakes: 1,
      maxNormalWakes: 2,
      normalWakeDuration: 10,
      maxNormalWakeDuration: 20,
      idealBedtimeRange: [18, 20],
    },
  },
  {
    maxMonths: 12, // 9-12 months adjusted
    expectations: {
      nightSleepHours: { min: 10, ideal: 11, max: 12 },
      expectedWakes: 1,
      maxNormalWakes: 2,
      normalWakeDuration: 10,
      maxNormalWakeDuration: 15,
      idealBedtimeRange: [18, 19.5],
    },
  },
  {
    maxMonths: 24, // 12-24 months
    expectations: {
      nightSleepHours: { min: 10, ideal: 11.5, max: 12.5 },
      expectedWakes: 0,
      maxNormalWakes: 1,
      normalWakeDuration: 5,
      maxNormalWakeDuration: 15,
      idealBedtimeRange: [18, 19.5],
    },
  },
  {
    maxMonths: 999, // 24+ months
    expectations: {
      nightSleepHours: { min: 9.5, ideal: 11, max: 12 },
      expectedWakes: 0,
      maxNormalWakes: 1,
      normalWakeDuration: 5,
      maxNormalWakeDuration: 10,
      idealBedtimeRange: [18.5, 20],
    },
  },
];

function getExpectations(adjustedAgeMonths: number): AgeExpectations {
  for (const entry of AGE_EXPECTATIONS) {
    if (adjustedAgeMonths < entry.maxMonths) return entry.expectations;
  }
  return AGE_EXPECTATIONS[AGE_EXPECTATIONS.length - 1].expectations;
}

export function getAdjustedAgeMonths(birthdateStr: string, prematureWeeks: number): number {
  const birthdate = new Date(birthdateStr);
  const now = new Date();
  const chronologicalMonths = (now.getFullYear() - birthdate.getFullYear()) * 12 +
    (now.getMonth() - birthdate.getMonth()) +
    (now.getDate() - birthdate.getDate()) / 30;
  return Math.max(0, chronologicalMonths - prematureWeeks / 4.33);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ===== NIGHT SUMMARY =====

export interface NightSummary {
  night_start: number;
  night_end: number;
  total_duration_minutes: number;
  sleep_segments: NanitCalendarEntry[];
  gap_count: number;
  gaps: { start: number; end: number; duration_minutes: number }[];
  longest_stretch_minutes: number;
}

export function buildNightSummaries(sleepEntries: NanitCalendarEntry[]): NightSummary[] {
  if (sleepEntries.length === 0) return [];

  const sorted = [...sleepEntries].sort((a, b) => a.begin_ts - b.begin_ts);
  const nights: NightSummary[] = [];
  let currentNight: NanitCalendarEntry[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = currentNight[currentNight.length - 1];
    const curr = sorted[i];
    const gapMinutes = (curr.begin_ts - prev.end_ts) / 60;

    if (gapMinutes > 120) {
      nights.push(summarizeNight(currentNight));
      currentNight = [curr];
    } else {
      currentNight.push(curr);
    }
  }
  nights.push(summarizeNight(currentNight));

  return nights;
}

function summarizeNight(segments: NanitCalendarEntry[]): NightSummary {
  const nightStart = segments[0].begin_ts;
  const nightEnd = segments[segments.length - 1].end_ts;
  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0) / 60;

  const gaps: { start: number; end: number; duration_minutes: number }[] = [];
  for (let i = 1; i < segments.length; i++) {
    const gapStart = segments[i - 1].end_ts;
    const gapEnd = segments[i].begin_ts;
    if (gapEnd > gapStart) {
      gaps.push({ start: gapStart, end: gapEnd, duration_minutes: (gapEnd - gapStart) / 60 });
    }
  }

  const longestStretch = Math.max(...segments.map(s => s.duration / 60));

  return {
    night_start: nightStart,
    night_end: nightEnd,
    total_duration_minutes: totalDuration,
    sleep_segments: segments,
    gap_count: gaps.length,
    gaps,
    longest_stretch_minutes: longestStretch,
  };
}

// ===== SCORING =====

export function scoreNight(
  night: NightSummary,
  birthdate: string,
  prematureWeeks: number = 0,
  annotation?: SleepAnnotation,
  tzOffset: number = 0, // minutes from UTC (e.g. 420 for PDT which is UTC-7)
): SleepScoreBreakdown {
  const adjAge = getAdjustedAgeMonths(birthdate, prematureWeeks);
  const expect = getExpectations(adjAge);

  const startTime = annotation?.custom_start_time ?? night.night_start;
  const endTime = annotation?.custom_end_time ?? night.night_end;

  const actualSleepMinutes = night.total_duration_minutes;
  const targetMinutes = expect.nightSleepHours.ideal * 60;

  // Classify wakes by severity relative to age
  const normalWakes: typeof night.gaps = [];
  const excessiveWakes: typeof night.gaps = [];
  for (const gap of night.gaps) {
    if (gap.duration_minutes <= expect.normalWakeDuration) {
      normalWakes.push(gap);
    } else {
      excessiveWakes.push(gap);
    }
  }

  // === 1. DURATION SCORE (0-35) ===
  const durationRatio = actualSleepMinutes / targetMinutes;
  let durationScore: number;
  if (durationRatio >= 0.95) durationScore = 35;
  else if (durationRatio >= 0.85) durationScore = 30;
  else if (durationRatio >= 0.75) durationScore = 25;
  else if (durationRatio >= 0.65) durationScore = 20;
  else if (durationRatio >= 0.50) durationScore = 15;
  else durationScore = Math.round(durationRatio * 30);

  // === 2. CONTINUITY SCORE (0-35) ===
  // Age-adjusted: expected wakes don't count against the score.
  // Only wakes beyond the expected count AND wakes longer than normal penalize.
  let continuityScore = 35;

  const totalWakes = night.gaps.length;
  const excessWakeCount = Math.max(0, totalWakes - expect.expectedWakes);

  // Penalty for excess wake COUNT (beyond what's normal for age)
  // -5 per excess wake, capped at -20
  continuityScore -= Math.min(excessWakeCount * 5, 20);

  // Penalty for excessively LONG wakes (beyond normal feeding duration)
  // Only the portion exceeding normalWakeDuration is penalized
  for (const gap of night.gaps) {
    const excessMinutes = Math.max(0, gap.duration_minutes - expect.normalWakeDuration);
    if (excessMinutes > 0) {
      // -1 per 5 excess minutes, capped at -5 per wake
      continuityScore -= Math.min(Math.floor(excessMinutes / 5), 5);
    }
  }

  continuityScore = Math.max(0, continuityScore);

  // === 3. LONGEST STRETCH SCORE (0-15) ===
  // Age-adjusted stretch expectations
  const longestHours = night.longest_stretch_minutes / 60;
  // Expected longest stretch grows with age
  const expectedStretch = adjAge < 1 ? 2.5 : adjAge < 3 ? 3 : adjAge < 6 ? 4 : adjAge < 9 ? 6 : 8;
  const stretchRatio = longestHours / expectedStretch;
  let stretchScore: number;
  if (stretchRatio >= 1.0) stretchScore = 15;
  else if (stretchRatio >= 0.8) stretchScore = 12;
  else if (stretchRatio >= 0.6) stretchScore = 9;
  else if (stretchRatio >= 0.4) stretchScore = 6;
  else stretchScore = 3;

  // === 4. TIMING SCORE (0-15) ===
  // Convert UTC timestamp to local hour using client's timezone offset
  const bedtimeUtcMs = startTime * 1000;
  const bedtimeLocalMs = bedtimeUtcMs - tzOffset * 60 * 1000;
  const bedtimeDate = new Date(bedtimeLocalMs);
  const bedtimeHour = bedtimeDate.getUTCHours() + bedtimeDate.getUTCMinutes() / 60;
  const [idealStart, idealEnd] = expect.idealBedtimeRange;

  let timingScore: number;
  if (bedtimeHour >= idealStart && bedtimeHour <= idealEnd) {
    timingScore = 15;
  } else {
    // How far outside the range
    const distance = bedtimeHour < idealStart
      ? idealStart - bedtimeHour
      : bedtimeHour - idealEnd;
    timingScore = Math.max(0, 15 - Math.round(distance * 5));
  }

  const totalScore = durationScore + continuityScore + stretchScore + timingScore;

  return {
    total_score: clamp(totalScore, 0, 100),
    duration_score: durationScore,
    continuity_score: continuityScore,
    onset_score: stretchScore,
    timing_score: timingScore,
    details: {
      total_sleep_minutes: Math.round(actualSleepMinutes),
      target_sleep_minutes: Math.round(targetMinutes),
      wake_count: totalWakes,
      longest_stretch_minutes: Math.round(night.longest_stretch_minutes),
      time_to_fall_asleep_minutes: 0,
      parent_visits: 0,
      bedtime: new Date(startTime * 1000).toISOString(),
      wake_time: new Date(endTime * 1000).toISOString(),
      ...(annotation?.custom_start_time && { custom_bedtime: new Date(annotation.custom_start_time * 1000).toISOString() }),
      ...(annotation?.custom_end_time && { custom_wake_time: new Date(annotation.custom_end_time * 1000).toISOString() }),
    },
  };
}
