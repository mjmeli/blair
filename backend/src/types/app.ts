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
    /** true when a manual annotation changed the night window */
    adjusted: boolean;
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
