import { Card } from '../common/Card';
import { ScoreRing } from '../common/ScoreRing';
import { StatValue } from '../common/StatValue';
import { formatTime, formatDuration } from '../../utils/date';
import { Moon, Clock, Eye, Timer } from 'lucide-react';
import type { SleepScoreBreakdown } from '../../types';

interface Props {
  score: SleepScoreBreakdown | null;
  loading?: boolean;
}

export function SleepScoreCard({ score, loading }: Props) {
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

  return (
    <Card title="Sleep Score" className="col-span-full lg:col-span-2">
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
      <div className="mt-4 grid grid-cols-4 gap-2 border-t border-slate-100 pt-4 dark:border-slate-700">
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
    </Card>
  );
}
