import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import { Card } from '../common/Card';
import * as api from '../../services/api';
import type { TrendPoint } from '../../services/api';
import type { Baby } from '../../types';

interface Props {
  baby: Baby | null;
  bedtimeHour: number;
  wakeHour: number;
  prematureWeeks: number;
}

export function SleepTrendChart({ baby, bedtimeHour, wakeHour, prematureWeeks }: Props) {
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  useEffect(() => {
    if (!baby) return;
    setLoading(true);
    api.getSleepTrend(baby.uid, baby.birthdate, days, bedtimeHour, wakeHour, prematureWeeks)
      .then(setTrend)
      .catch(() => setTrend([]))
      .finally(() => setLoading(false));
  }, [baby, days, bedtimeHour, wakeHour]);

  if (loading) {
    return (
      <Card title="Sleep Trends">
        <div className="flex h-48 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      </Card>
    );
  }

  const chartData = trend.map(t => ({
    date: t.date.slice(5), // "04-10" -> "04-10"
    score: t.score,
    sleepHours: t.total_sleep_minutes ? Math.round(t.total_sleep_minutes / 6) / 10 : null, // round to 0.1h
    wakeUps: t.wake_count ?? null,
  }));

  return (
    <Card
      title="Sleep Trends"
      className="col-span-full"
      action={
        <div className="flex gap-1">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                days === d
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      }
    >
      {chartData.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No trend data available</p>
      ) : (
        <div className="space-y-6">
          {/* Score trend */}
          <div>
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Sleep Score</p>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#818cf8"
                  strokeWidth={2}
                  dot={{ fill: '#818cf8', r: 3 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Sleep hours + wake-ups */}
          <div>
            <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Sleep Hours & Wake-ups</p>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis yAxisId="hours" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis yAxisId="wakes" orientation="right" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="hours" dataKey="sleepHours" name="Hours" fill="#818cf8" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="wakes" dataKey="wakeUps" name="Wake-ups" fill="#fbbf24" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Card>
  );
}
