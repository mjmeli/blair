import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ChevronDown, ChevronUp, Sun } from 'lucide-react';
import { Card } from '../common/Card';
import { ErrorState } from '../common/ErrorState';
import { errorMessage } from '../../utils/errors';
import { formatDuration, formatTime } from '../../utils/date';
import * as api from '../../services/api';
import type { Baby, DaysResponse } from '../../types';

interface Props {
  baby: Baby | null;
  prematureWeeks: number;
  bedtimeHour: number;
  wakeHour: number;
}

const RANGES = [7, 14] as const;
const AXIS = [
  { h: 0, label: '12a' }, { h: 6, label: '6a' }, { h: 12, label: '12p' }, { h: 18, label: '6p' }, { h: 24, label: '12a' },
];

interface RowMark {
  id: string;
  kind: 'night' | 'nap' | 'visit';
  left: number;
  width: number;
  label: string;
}

const MARK_CLASS: Record<RowMark['kind'], string> = {
  night: 'bg-indigo-500 dark:bg-indigo-500',
  nap: 'bg-sky-400 dark:bg-sky-400',
  visit: 'bg-amber-500',
};

const CHART_OPEN_KEY = 'blair_day_activity_chart_open';

function readChartOpen(): boolean {
  try {
    return localStorage.getItem(CHART_OPEN_KEY) === 'true';
  } catch {
    return false;
  }
}

const hoursRange = ([lo, hi]: [number, number]) => (lo === hi ? `${lo}` : `${lo}–${hi}`);

/**
 * Every crib sleep across whole days (Nanit's auto_sleep data, the same thing
 * its Activity Tracker draws), split into nights and naps, with nap stats.
 */
export function DayActivityCard({ baby, prematureWeeks, bedtimeHour, wakeHour }: Props) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const [data, setData] = useState<DaysResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RowMark | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Remembered per browser so the card stays the way the parent left it
  const [chartOpen, setChartOpen] = useState(readChartOpen);
  const toggleChart = () => {
    setChartOpen(open => {
      try { localStorage.setItem(CHART_OPEN_KEY, String(!open)); } catch { /* storage unavailable */ }
      return !open;
    });
    setSelected(null);
  };

  useEffect(() => {
    if (!baby) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getSleepDays(baby.uid, baby.birthdate, prematureWeeks, days, bedtimeHour, wakeHour)
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [baby, prematureWeeks, days, bedtimeHour, wakeHour, reloadKey]);

  // One row per day, newest first; every segment clipped to that day's midnight-to-midnight
  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.days].reverse().map(day => {
      const d0 = DateTime.fromISO(day.date).startOf('day').toSeconds();
      const d1 = DateTime.fromISO(day.date).plus({ days: 1 }).startOf('day').toSeconds();
      const span = d1 - d0;
      const marks: RowMark[] = [];
      for (const block of data.blocks) {
        if (block.end <= d0 || block.start >= d1) continue;
        const what = block.kind === 'night' ? 'Night sleep' : 'Nap';
        const blockLabel = `${what} ${formatTime(block.start)}–${formatTime(block.end)} · ${formatDuration(block.minutes)} asleep${block.removed_asleep ? ' · carried out still asleep' : ''}`;
        for (const seg of block.segments) {
          const s = Math.max(seg.start, d0);
          const e = Math.min(seg.end, d1);
          if (e <= s) continue;
          marks.push({ id: `${block.kind}${seg.start}`, kind: block.kind, left: ((s - d0) / span) * 100, width: ((e - s) / span) * 100, label: blockLabel });
        }
      }
      for (const v of data.visits) {
        if (v < d0 || v >= d1) continue;
        marks.push({ id: `v${v}`, kind: 'visit', left: ((v - d0) / span) * 100, width: 0, label: `Parent at the crib ${formatTime(v)}` });
      }
      return { day, marks, label: DateTime.fromISO(day.date).toFormat('EEE d') };
    });
  }, [data]);

  const action = (
    <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-900">
      {RANGES.map(r => (
        <button
          key={r}
          onClick={() => setDays(r)}
          className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${days === r ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500'}`}
        >
          {r}d
        </button>
      ))}
    </div>
  );

  if (loading && !data) {
    return (
      <Card title="Day & Night Activity" className="col-span-full" action={action}>
        <div className="h-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700" />
      </Card>
    );
  }
  if (error) {
    return (
      <Card title="Day & Night Activity" className="col-span-full" action={action}>
        <ErrorState title="Couldn't load daytime sleep" message={error} onRetry={() => setReloadKey(k => k + 1)} compact />
      </Card>
    );
  }
  if (!data) return null;

  const s = data.summary;
  const x = data.expectations;
  const tiles = [
    {
      label: 'Crib naps / day',
      value: s.avg_naps ?? '—',
      sub: x ? `Typical: ${hoursRange(x.naps)}` : undefined,
    },
    {
      label: 'Daytime sleep',
      value: s.avg_nap_minutes_per_day !== null ? formatDuration(s.avg_nap_minutes_per_day) : '—',
      sub: x ? `Typical: ${hoursRange(x.daytime_hours)}h` : undefined,
    },
    {
      label: 'Wake window',
      value: s.avg_wake_window_minutes !== null ? formatDuration(s.avg_wake_window_minutes) : '—',
      sub: x ? `Typical: ${hoursRange(x.wake_window_hours)}h` : undefined,
    },
    {
      label: 'Before bed',
      value: s.avg_last_wake_window_minutes !== null ? formatDuration(s.avg_last_wake_window_minutes) : '—',
      sub: 'Last nap → bedtime',
    },
    {
      label: '24h sleep',
      value: s.avg_24h_minutes !== null ? formatDuration(s.avg_24h_minutes) : '—',
      sub: 'Night + crib naps',
    },
  ];

  return (
    <Card title="Day & Night Activity" className="col-span-full" action={action}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map(t => (
          <div key={t.label} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900/50">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{t.label}</p>
            <p className="text-lg font-semibold text-slate-800 dark:text-white">{t.value}</p>
            {t.sub && <p className="text-[10px] text-slate-400">{t.sub}</p>}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
        Averages use the {s.days_with_crib_naps} of {s.days_analyzed} full days with at least one crib nap
        {x ? ` · typical ranges for ${x.adjusted_age_months} mo adjusted` : ''}. Naps outside the crib (car, carrier, daycare) are invisible to the camera, so wake windows that probably hide one are left out.
      </p>

      <button
        onClick={toggleChart}
        aria-expanded={chartOpen}
        className="mt-3 flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        {chartOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {chartOpen ? 'Hide' : 'Show'} activity chart
      </button>

      {chartOpen && (<>
      {/* Activity chart: a row per day, midnight to midnight */}
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0" />
          <div className="relative h-4 flex-1">
            {AXIS.map(a => (
              <span
                key={a.h}
                className={`absolute text-[10px] text-slate-400 ${a.h === 0 ? '' : a.h === 24 ? '-translate-x-full' : '-translate-x-1/2'}`}
                style={{ left: `${(a.h / 24) * 100}%` }}
              >
                {a.label}
              </span>
            ))}
          </div>
          <span className="hidden w-24 shrink-0 sm:block" />
        </div>
        <div className="space-y-1">
          {rows.map(({ day, marks, label }) => (
            <div key={day.date} className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
              <div className="relative h-5 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-700/60">
                {[6, 12, 18].map(h => (
                  <span key={h} className="absolute top-0 h-full w-px bg-slate-200 dark:bg-slate-600" style={{ left: `${(h / 24) * 100}%` }} />
                ))}
                {marks.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    title={m.label}
                    aria-label={m.label}
                    onClick={() => setSelected(prev => (prev?.id === m.id ? null : m))}
                    className={`absolute ${m.kind === 'visit' ? 'top-0 h-1.5 -translate-x-1/2 rounded-b-sm' : 'top-0.5 h-4 rounded-sm'} ${MARK_CLASS[m.kind]} ${selected?.id === m.id ? 'ring-2 ring-slate-800 dark:ring-white' : ''}`}
                    style={m.kind === 'visit' ? { left: `${m.left}%`, width: 6 } : { left: `${m.left}%`, width: `max(${m.width}%, 2px)` }}
                  />
                ))}
              </div>
              <span className="hidden w-24 shrink-0 text-right text-[11px] text-slate-600 dark:text-slate-300 sm:block">
                {day.nap_count > 0 ? `${day.nap_count} nap${day.nap_count === 1 ? '' : 's'} · ${formatDuration(day.nap_minutes)}` : <span className="text-slate-400">no crib naps</span>}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Legend className="bg-indigo-500" label="Night sleep" />
          <Legend className="bg-sky-400" label="Nap" />
          <Legend className="bg-amber-500" label="Parent at crib" small />
          <span className="ml-auto text-xs text-slate-600 dark:text-slate-300">
            {selected ? selected.label : <span className="text-slate-400">Tap a bar for times</span>}
          </span>
        </div>
      </div>

      {/* Per-day detail, also the accessible table view of the chart */}
      <details className="mt-3">
        <summary className="flex cursor-pointer items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400">
          <Sun size={12} /> Day-by-day naps and wake windows
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-[11px] text-slate-600 dark:text-slate-300">
            <thead className="text-slate-400">
              <tr>
                <th className="py-1 pr-3 font-medium">Day</th>
                <th className="py-1 pr-3 font-medium">Up</th>
                <th className="py-1 pr-3 font-medium">Naps</th>
                <th className="py-1 pr-3 font-medium">Wake windows</th>
                <th className="py-1 pr-3 font-medium">Bed</th>
                <th className="py-1 font-medium">24h</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ day, label }) => (
                <tr key={day.date} className="border-t border-slate-100 align-top dark:border-slate-700">
                  <td className="py-1 pr-3 whitespace-nowrap">{label}{!day.complete && <span className="ml-1 text-slate-400">(so far)</span>}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">{day.morning_wake ? formatTime(day.morning_wake) : '—'}</td>
                  <td className="py-1 pr-3">
                    {day.naps.length === 0 ? '—' : day.naps.map(n => (
                      <div key={n.start} className="whitespace-nowrap">
                        {formatTime(n.start)} · {formatDuration(n.minutes)}{n.removed_asleep && <span className="text-slate-400"> (carried out asleep)</span>}
                      </div>
                    ))}
                  </td>
                  <td className="py-1 pr-3">
                    {day.wake_windows.length === 0 ? '—' : day.wake_windows.map(w => (
                      <span key={w.start} className={`mr-1.5 whitespace-nowrap ${w.uncertain ? 'text-slate-400 line-through decoration-slate-300' : ''}`} title={w.uncertain ? 'Probably includes a nap outside the crib' : undefined}>
                        {formatDuration(w.minutes)}
                      </span>
                    ))}
                  </td>
                  <td className="py-1 pr-3 whitespace-nowrap">{day.bedtime ? formatTime(day.bedtime) : '—'}</td>
                  <td className="py-1 whitespace-nowrap">{day.total_24h_minutes !== null ? formatDuration(day.total_24h_minutes) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-slate-400">Struck-through wake windows probably include a nap outside the crib and aren't averaged.</p>
        </div>
      </details>
      </>)}
    </Card>
  );
}

function Legend({ className, label, small }: { className: string; label: string; small?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block ${small ? 'h-1.5 w-2.5' : 'h-2.5 w-2.5'} rounded-sm ${className}`} />
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
    </div>
  );
}
