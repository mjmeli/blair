export interface NanitTokens {
  access_token: string;
  token: string;
  refresh_token: string;
}

export interface MfaChallenge {
  mfa_required: true;
  mfa_token: string;
  phone_suffix: string;
  channel: string;
  message: string;
}

export interface Baby {
  uid: string;
  id: number;
  name: string;
  birthdate: string;
  due_date?: string;
  camera_uid?: string;
}

export interface SleepAnnotation {
  session_id: string;
  baby_uid: string;
  custom_start_time?: number;
  custom_end_time?: number;
  notes?: string;
  wake_overrides?: Record<string, WakeResponse>;
  updated_at: number;
}

export type WakeResponse = 'self_settled' | 'parent_visit' | 'taken_out' | 'unknown';

/** A night wake and whether a parent went in (from Nanit's camera, or the parent's correction). */
export interface WakeDetail {
  start: number;
  end: number;
  duration_minutes: number;
  response: WakeResponse;
  source: 'nanit' | 'parent';
  visit_times: number[];
}

/** A parent visit while the baby was asleep. */
export interface CheckIn {
  time: number;
  wake_within_minutes?: number;
}

export interface SleepScoreBreakdown {
  total_score: number;
  duration_score: number;
  continuity_score: number;
  onset_score: number; // longest-stretch score (historical name)
  timing_score: number;
  details: {
    total_sleep_minutes: number;
    target_sleep_minutes: number;
    wake_count: number;
    longest_stretch_minutes: number;
    bedtime: string;
    wake_time: string;
    custom_bedtime?: string;
    custom_wake_time?: string;
    adjusted: boolean;
    wakes?: WakeDetail[];
    check_ins?: CheckIn[];
  };
  expectations: {
    adjusted_age_months: number;
    ideal_sleep_hours: number;
    expected_wakes: number;
    normal_wake_minutes: number;
    expected_stretch_hours: number;
    ideal_bedtime_range: [number, number];
    excess_wake_penalty: number;
    long_wake_penalty: number;
    brief_wake_minutes?: number;
    self_settled_wakes?: number;
    parent_visit_wakes?: number;
    unknown_wakes?: number;
  };
}

export interface SleepSegment {
  uid: string;
  begin_ts: number;
  end_ts: number;
  duration: number;
  type: string;
}

export interface SleepGap {
  start: number;
  end: number;
  duration_minutes: number;
}

/** One entry of GET /sleep/score: a scored night plus what the timeline needs. */
export interface ScoredNight extends SleepScoreBreakdown {
  night_id: string;
  is_main: boolean;
  night_start: number;
  night_end: number;
  raw_night_start: number;
  raw_night_end: number;
  segment_count: number;
  segments: SleepSegment[];
  gaps: SleepGap[];
  annotation: SleepAnnotation | null;
}

export interface CalendarEvent {
  id: string;
  time: number;
  type: 'diaper_change' | 'bottle_feed';
  change_type?: 'pee' | 'mixed' | 'poo';
  feed_amount?: number;
}

export interface NanitMessage {
  id: number;
  baby_uid: string;
  type: 'SOUND' | 'MOTION' | 'TEMPERATURE';
  time: number;
  data?: Record<string, unknown>;
}

// Whole days (GET /sleep/days): nights + naps, like Nanit's Activity Tracker
export interface SleepBlock {
  kind: 'night' | 'nap';
  start: number;
  end: number;
  minutes: number;
  segments: { start: number; end: number }[];
  removed_asleep?: boolean;
}

export interface WakeWindow {
  start: number;
  end: number;
  minutes: number;
  uncertain?: 'taken_out_asleep' | 'too_long';
}

export interface DayStats {
  date: string;
  complete: boolean;
  morning_wake: number | null;
  bedtime: number | null;
  naps: SleepBlock[];
  nap_count: number;
  nap_minutes: number;
  longest_nap_minutes: number;
  wake_windows: WakeWindow[];
  total_24h_minutes: number | null;
}

export interface DaysResponse {
  range: { start: number; end: number };
  blocks: SleepBlock[];
  days: DayStats[];
  visits: number[];
  summary: {
    days_analyzed: number;
    days_with_crib_naps: number;
    avg_naps: number | null;
    avg_nap_minutes_per_day: number | null;
    avg_nap_length_minutes: number | null;
    avg_wake_window_minutes: number | null;
    avg_last_wake_window_minutes: number | null;
    avg_24h_minutes: number | null;
  };
  expectations: {
    adjusted_age_months: number;
    naps: [number, number];
    daytime_hours: [number, number];
    wake_window_hours: [number, number];
  } | null;
}
