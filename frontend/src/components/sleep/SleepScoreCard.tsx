import { useState } from 'react';
import { Card } from '../common/Card';
import { ScoreRing } from '../common/ScoreRing';
import { StatValue } from '../common/StatValue';
import { formatTime, formatDuration } from '../../utils/date';
import { Moon, Clock, Eye, Timer, ChevronDown, ChevronUp } from 'lucide-react';
import type { SleepScoreBreakdown } from '../../types';

interface Props {
  score: SleepScoreBreakdown | null;
  loading?: boolean;
}

export function SleepScoreCard({ score, loading }: Props) {
  const [showWhy, setShowWhy] = useState(false);
  if (loading) {
    return (
      <Card title="Sleep Score">
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      </Card>
    );
  }

  if (!score) {
    return (
      <Card title="Sleep Score">
        <p className="py-8 text-center text-sm text-slate-400">No sleep data for this date</p>
      </Card>
    );
  }

  const d = score.details;
  const x = score.expectations;
  const fmtHour = (h: number) => {
    const whole = Math.floor(h);
    const mins = Math.round((h - whole) * 60);
    const ampm = whole >= 12 ? 'PM' : 'AM';
    const h12 = whole % 12 === 0 ? 12 : whole % 12;
    return mins ? `${h12}:${String(mins).padStart(2, '0')} ${ampm}` : `${h12} ${ampm}`;
  };
  const why = x ? [
    {
      label: 'Duration',
      value: score.duration_score, max: 35,
      note: `${formatDuration(d.total_sleep_minutes)} of an ideal ${x.ideal_sleep_hours}h for ${x.adjusted_age_months} mo adjusted (${Math.round((d.total_sleep_minutes / (x.ideal_sleep_hours * 60)) * 100)}%)`,
    },
    {
      label: 'Continuity',
      value: score.continuity_score, max: 35,
      note: `${d.wake_count} wake${d.wake_count === 1 ? '' : 's'}, ${x.expected_wakes} expected at this age (−${x.excess_wake_penalty})` +
        (x.long_wake_penalty > 0 ? `; wakes longer than ${x.normal_wake_minutes} min cost −${x.long_wake_penalty}` : `; none ran past ${x.normal_wake_minutes} min`),
    },
    {
      label: 'Stretch',
      value: score.onset_score, max: 15,
      note: `Longest ${formatDuration(d.longest_stretch_minutes)} vs ${x.expected_stretch_hours}h expected`,
    },
    {
      label: 'Timing',
      value: score.timing_score, max: 15,
      note: `Asleep at ${formatTime(d.bedtime)}; ideal window ${fmtHour(x.ideal_bedtime_range[0])}–${fmtHour(x.ideal_bedtime_range[1])}`,
    },
  ] : [];

  return (
    <Card
      title="Sleep Score"
      className="col-span-full lg:col-span-2"
      action={d.adjusted ? <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">Adjusted</span> : undefined}
    >
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
        <ScoreRing score={score.total_score} size={100} />
        <div className="grid w-full flex-1 grid-cols-2 gap-3 sm:gap-4">
          <StatValue
            icon={<Moon size={16} />}
            label="Bedtime"
            value={formatTime(d.bedtime)}
            sub={d.custom_bedtime ? `Adjusted: ${formatTime(d.custom_bedtime)}` : undefined}
          />
          <StatValue
            icon={<Clock size={16} />}
            label="Wake time"
            value={formatTime(d.wake_time)}
            sub={d.custom_wake_time ? `Adjusted: ${formatTime(d.custom_wake_time)}` : undefined}
          />
          <StatValue
            icon={<Timer size={16} />}
            label="Total sleep"
            value={formatDuration(d.total_sleep_minutes)}
            sub={`Target: ${formatDuration(d.target_sleep_minutes)}`}
          />
          <StatValue
            icon={<Eye size={16} />}
            label="Wake-ups"
            value={d.wake_count}
            sub={`Longest: ${formatDuration(d.longest_stretch_minutes)}`}
          />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 dark:border-slate-700 sm:grid-cols-4">
        {[
          { label: 'Duration', value: score.duration_score, max: 35 },
          { label: 'Continuity', value: score.continuity_score, max: 35 },
          { label: 'Stretch', value: score.onset_score, max: 15 },
          { label: 'Timing', value: score.timing_score, max: 15 },
        ].map(({ label, value, max }) => (
          <div key={label} className="text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {value}<span className="text-xs font-normal text-slate-400">/{max}</span>
            </p>
          </div>
        ))}
      </div>
      {why.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowWhy(v => !v)}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            {showWhy ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Why this score?
          </button>
          {showWhy && (
            <ul className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50">
              {why.map(w => (
                <li key={w.label} className="text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{w.label} {w.value}/{w.max}</span>
                  <span className="mx-1 text-slate-400">·</span>{w.note}
                </li>
              ))}
              <li className="pt-1 text-[10px] text-slate-400">
                Expectations come from an age table (adjusted for prematurity) and your bedtime setting. Expected wakes at this age are free; only extra or unusually long ones cost points.
              </li>
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
