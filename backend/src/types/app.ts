export interface SleepScoreBreakdown {
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

export interface SleepAnnotation {
  session_id: string;
  baby_uid: string;
  custom_start_time?: number;
  custom_end_time?: number;
  notes?: string;
  updated_at: number;
}

export interface ApiError {
  error: string;
  message: string;
  status: number;
}
