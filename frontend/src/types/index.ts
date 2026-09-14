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

export interface SleepState {
  type: 'asleep' | 'awake' | 'parent_visit';
  start_time: number;
  end_time?: number;
  video_url?: string;
}

export interface SleepSession {
  id: string;
  baby_uid: string;
  start_time: number;
  end_time?: number;
  duration_seconds?: number;
  states: SleepState[];
  time_to_fall_asleep_seconds?: number;
  wake_count?: number;
  parent_visit_count?: number;
  sleep_score?: number;
}

export interface SleepScoreBreakdown {
  session_id: string;
  total_score: number;
  duration_score: number;
  continuity_score: number;
  onset_score: number;
  timing_score: number;
  details: {
    total_sleep_minutes: number;
    target_sleep_minutes: number;
    wake_count: number;
    longest_stretch_minutes: number;
    time_to_fall_asleep_minutes: number;
    parent_visits: number;
    bedtime: string;
    wake_time: string;
    custom_bedtime?: string;
    custom_wake_time?: string;
  };
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
