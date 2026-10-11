import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card } from '../common/Card';
import { formatDuration } from '../../utils/date';
import { errorMessage } from '../../utils/errors';
import * as api from '../../services/api';
import type { Baby, ScoredNight, WakeDetail, WakeResponse } from '../../types';

function formatTime(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface Props {
  sleepScore: ScoredNight | null;
  loading?: boolean;
  /** With these, tapping a wake lets the parent correct whether they went in. */
  baby?: Baby | null;
  onSaved?: () => void;
}

interface Bar {
  id: string;
  kind: 'sleep' | 'awake';
  left: number;
  width: number;
  label: string;
  wake?: WakeDetail;
}

const WAKE_STYLE: Record<WakeResponse, { bar: string; dot: string; label: string }> = {
  self_settled: { bar: 'bg-teal-500', dot: 'bg-teal-500', label: 'Self-settled' },
  parent_visit: { bar: 'bg-amber-500', dot: 'bg-amber-500', label: 'Parent went in' },
  taken_out: { bar: 'bg-rose-600', dot: 'bg-rose-600', label: 'Taken out' },
  unknown: { bar: 'bg-slate-400 dark:bg-slate-500', dot: 'bg-slate-400 dark:bg-slate-500', label: 'Awake (no visit data)' },
};

export function SleepTimeline({ sleepScore, loading, baby, onSaved }: Props) {
  // Tap/click a bar to show its label below (hover titles are invisible on touch)
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { bars, hours, checkIns } = useMemo(() => {
    const empty = { bars: [] as Bar[], hours: [] as { label: string; left: number }[], checkIns: [] as { left: number; label: string }[] };
    if (!sleepScore || !sleepScore.segments?.length) return empty;

    const start = sleepScore.night_start;
    const end = sleepScore.night_end;
    const total = end - start;
    if (total <= 0) return empty;
    const pos = (t: number) => ((t - start) / total) * 100;

    // Older responses have gaps but no wake labels; fall back to unlabeled wakes
    const wakes: WakeDetail[] = sleepScore.details.wakes
      ?? (sleepScore.gaps || []).map(g => ({ ...g, response: 'unknown' as const, source: 'nanit' as const, visit_times: [] }));

    const bars: Bar[] = [
      ...sleepScore.segments.map(seg => ({
        id: `s${seg.begin_ts}`,
        kind: 'sleep' as const,
        left: pos(seg.begin_ts),
        width: ((seg.end_ts - seg.begin_ts) / total) * 100,
        label: `Asleep ${formatDuration((seg.end_ts - seg.begin_ts) / 60)} · ${formatTime(seg.begin_ts)}–${formatTime(seg.end_ts)}`,
      })),
      ...wakes.map(w => ({
        id: `w${w.start}`,
        kind: 'awake' as const,
        left: pos(w.start),
        width: ((w.end - w.start) / total) * 100,
        label: `Awake ${formatDuration(w.duration_minutes)} · ${formatTime(w.start)}–${formatTime(w.end)} · ${WAKE_STYLE[w.response].label}${w.source === 'parent' ? ' (you set this)' : ''}`,
        wake: w,
      })),
    ];

    const checkIns = (sleepScore.details.check_ins ?? []).map(c => ({
      left: pos(c.time),
      label: `Parent check-in at ${formatTime(c.time)} while asleep${c.wake_within_minutes !== undefined ? ` · woke ${c.wake_within_minutes} min later` : ''}`,
    }));

    // Hour markers; on narrow screens only every other one is shown
    const markers: { label: string; left: number }[] = [];
    let t = Math.ceil(start / 3600) * 3600;
    while (t < end) {
      const d = new Date(t * 1000);
      const h = d.getHours();
      const label = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
      markers.push({ label, left: pos(t) });
      t += 3600;
    }

    return { bars, hours: markers, checkIns };
  }, [sleepScore]);

  if (loading) {
    return (
      <Card title="Sleep Timeline">
        <div className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700" />
      </Card>
    );
  }

  if (!sleepScore || bars.length === 0) {
    return (
      <Card title="Sleep Timeline">
        <p className="py-6 text-center text-sm text-slate-400">No sleep data</p>
      </Card>
    );
  }

  const selectedBar = bars.find(b => b.id === selected) ?? null;
  const selectedCheckIn = selected?.startsWith('c') ? checkIns[Number(selected.slice(1))] : null;
  const wakes = sleepScore.details.wakes ?? [];
  const used = new Set(wakes.map(w => w.response));
  const canEdit = !!baby && !!onSaved && !!sleepScore.details.wakes;

  const relabel = async (wake: WakeDetail, response: Exclude<WakeResponse, 'unknown'> | null) => {
    if (!baby || !onSaved) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.setWakeOverride(baby.uid, sleepScore.night_id, wake.start, response);
      onSaved();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const chip = (active: boolean) =>
    `rounded-md px-2 py-1 text-[11px] font-medium transition disabled:opacity-40 ${
      active
        ? 'bg-indigo-600 text-white'
        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
    }`;

  return (
    <Card title="Sleep Timeline" className="col-span-full">
      {/* Check-in markers sit above the bar */}
      <div className="relative h-3">
        {checkIns.map((c, i) => (
          <button
            key={i}
            type="button"
            aria-label={c.label}
            title={c.label}
            onClick={() => setSelected(prev => (prev === `c${i}` ? null : `c${i}`))}
            className="absolute top-0 flex h-3 w-4 -translate-x-1/2 items-end justify-center"
            style={{ left: `${c.left}%` }}
          >
            <span className="block h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-amber-500" />
          </button>
        ))}
      </div>
      <div className="relative h-10 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-700">
        {bars.map(bar => (
          <button
            key={bar.id}
            type="button"
            aria-label={bar.label}
            title={bar.label}
            onClick={() => setSelected(prev => (prev === bar.id ? null : bar.id))}
            className={`absolute top-0 h-full ${
              bar.kind === 'sleep' ? 'bg-indigo-500 dark:bg-indigo-600' : WAKE_STYLE[bar.wake!.response].bar
            } ${selected === bar.id ? 'ring-2 ring-inset ring-white/70' : ''}`}
            style={{ left: `${bar.left}%`, width: `${Math.max(bar.width, 0.6)}%` }}
          />
        ))}
      </div>
      <div className="relative mt-1 h-4">
        {hours.map((m, i) => (
          <span
            key={i}
            className={`absolute -translate-x-1/2 text-[10px] text-slate-400 ${i % 2 === 1 ? 'hidden sm:inline' : ''}`}
            style={{ left: `${m.left}%` }}
          >
            {m.label}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-indigo-500 dark:bg-indigo-600" />
          <span className="text-xs text-slate-500 dark:text-slate-400">Asleep</span>
        </div>
        {(['self_settled', 'parent_visit', 'taken_out', 'unknown'] as const).filter(r => used.has(r)).map(r => (
          <div key={r} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${WAKE_STYLE[r].dot}`} />
            <span className="text-xs text-slate-500 dark:text-slate-400">{WAKE_STYLE[r].label}</span>
          </div>
        ))}
        {checkIns.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="block h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-amber-500" />
            <span className="text-xs text-slate-500 dark:text-slate-400">Check-in while asleep</span>
          </div>
        )}
      </div>
      <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900/50">
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {selectedBar ? selectedBar.label : selectedCheckIn ? selectedCheckIn.label : <span className="text-slate-400">Tap a segment for times{canEdit && wakes.length > 0 ? ', or a wake to say whether you went in' : ''}</span>}
        </p>
        {canEdit && selectedBar?.wake && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] text-slate-500 dark:text-slate-400">Did you go in?</span>
            <button disabled={saving} className={chip(selectedBar.wake.response === 'self_settled')} onClick={() => relabel(selectedBar.wake!, 'self_settled')}>
              No, self-settled
            </button>
            <button disabled={saving} className={chip(selectedBar.wake.response === 'parent_visit')} onClick={() => relabel(selectedBar.wake!, 'parent_visit')}>
              Yes, we went in
            </button>
            <button disabled={saving} className={chip(selectedBar.wake.response === 'taken_out')} onClick={() => relabel(selectedBar.wake!, 'taken_out')}>
              We took baby out
            </button>
            {selectedBar.wake.source === 'parent' && (
              <button disabled={saving} className="text-[11px] text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => relabel(selectedBar.wake!, null)}>
                Use camera's guess
              </button>
            )}
            {saving && <Loader2 size={12} className="animate-spin text-slate-400" />}
          </div>
        )}
        {saveError && <p className="mt-1 text-[11px] text-rose-600">{saveError}</p>}
      </div>
    </Card>
  );
}
