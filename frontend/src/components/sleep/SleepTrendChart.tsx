import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import { Card } from '../common/Card';
import { ErrorState } from '../common/ErrorState';
import { errorMessage } from '../../utils/errors';
import * as api from '../../services/api';
import type { TrendPoint } from '../../services/api';
import type { Baby } from '../../types';

interface Props {
  baby: Baby | null;
  bedtimeHour: number;
  wakeHour: number;
  prematureWeeks: number;
}

/** Tracks the `dark` class that Nav toggles on <html>. */
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(root.classList.contains('dark')));
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

const CHART_COLORS = {
  light: {
    grid: '#e2e8f0',        // slate-200
    tick: '#64748b',        // slate-500
    tooltipBg: '#ffffff',
    tooltipBorder: '#e2e8f0',
    tooltipText: '#0f172a', // slate-900
    score: '#6366f1',       // indigo-500
    hours: '#6366f1',
    wakes: '#f59e0b',       // amber-500
  },
  dark: {
    grid: '#334155',        // slate-700
    tick: '#94a3b8',        // slate-400
    tooltipBg: '#1e293b',   // slate-800
    tooltipBorder: '#334155',
    tooltipText: '#f1f5f9', // slate-100
    score: '#818cf8',       // indigo-400
    hours: '#818cf8',
    wakes: '#fbbf24',       // amber-400
  },
} as const;

export function SleepTrendChart({ baby, bedtimeHour, wakeHour, prematureWeeks }: Props) {
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [days, setDays] = useState(7);
  const isDark = useIsDark();
  const colors = isDark ? CHART_COLORS.dark : CHART_COLORS.light;

  useEffect(() => {
    if (!baby) return;
    setLoading(true);
    setError(null);
    api.getSleepTrend(baby.uid, baby.birthdate, days, bedtimeHour, wakeHour, prematureWeeks)
      .then(setTrend)
      .catch(err => { setTrend([]); setError(errorMessage(err)); })
      .finally(() => setLoading(false));
  }, [baby, days, bedtimeHour, wakeHour, prematureWeeks, attempt]);

  if (error && !loading) {
    return (
      <Card title="Sleep Trends">
        <ErrorState message={error} onRetry={() => setAttempt(a => a + 1)} />
      </Card>
    );
  }

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
                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: colors.tick }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: colors.tick }} />
                <Tooltip
                  contentStyle={{ backgroundColor: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 8, fontSize: 12, color: colors.tooltipText }}
                  labelStyle={{ color: colors.tick }}
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke={colors.score}
                  strokeWidth={2}
                  dot={{ fill: colors.score, r: 3 }}
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
                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: colors.tick }} />
                <YAxis yAxisId="hours" tick={{ fontSize: 11, fill: colors.tick }} />
                <YAxis yAxisId="wakes" orientation="right" tick={{ fontSize: 11, fill: colors.tick }} />
                <Tooltip
                  contentStyle={{ backgroundColor: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 8, fontSize: 12, color: colors.tooltipText }}
                  labelStyle={{ color: colors.tick }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="hours" dataKey="sleepHours" name="Hours" fill={colors.hours} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="wakes" dataKey="wakeUps" name="Wake-ups" fill={colors.wakes} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Card>
  );
}
