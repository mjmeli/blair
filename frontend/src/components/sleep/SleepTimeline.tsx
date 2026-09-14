import { useMemo, useState } from 'react';
import { Card } from '../common/Card';
import { formatDuration } from '../../utils/date';
import type { SleepGap, SleepSegment } from '../../types';

function formatTime(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface Props {
  sleepScore: {
    night_start: number;
    night_end: number;
    segments: SleepSegment[];
    gaps: SleepGap[];
  } | null;
  loading?: boolean;
}

interface Bar {
  kind: 'sleep' | 'awake';
  left: number;
  width: number;
  label: string;
}

export function SleepTimeline({ sleepScore, loading }: Props) {
  // Tap/click a bar to show its label below (hover titles are invisible on touch)
  const [selected, setSelected] = useState<string | null>(null);

  const { bars, hours } = useMemo(() => {
    if (!sleepScore || !sleepScore.segments?.length) {
      return { bars: [] as Bar[], hours: [] as { label: string; left: number }[] };
    }

    const start = sleepScore.night_start;
    const end = sleepScore.night_end;
    const total = end - start;
    if (total <= 0) return { bars: [] as Bar[], hours: [] as { label: string; left: number }[] };

    const bars: Bar[] = [
      ...sleepScore.segments.map(seg => ({
        kind: 'sleep' as const,
        left: ((seg.begin_ts - start) / total) * 100,
        width: ((seg.end_ts - seg.begin_ts) / total) * 100,
        label: `Asleep ${formatDuration((seg.end_ts - seg.begin_ts) / 60)} · ${formatTime(seg.begin_ts)}–${formatTime(seg.end_ts)}`,
      })),
      ...(sleepScore.gaps || []).map(gap => ({
        kind: 'awake' as const,
        left: ((gap.start - start) / total) * 100,
        width: ((gap.end - gap.start) / total) * 100,
        label: `Awake ${formatDuration(gap.duration_minutes)} · ${formatTime(gap.start)}–${formatTime(gap.end)}`,
      })),
    ];

    // Hour markers; on narrow screens only every other one is shown
    const markers: { label: string; left: number }[] = [];
    let t = Math.ceil(start / 3600) * 3600;
    while (t < end) {
      const d = new Date(t * 1000);
      const h = d.getHours();
      const label = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
      markers.push({ label, left: ((t - start) / total) * 100 });
      t += 3600;
    }

    return { bars, hours: markers };
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

  const selectedBar = bars.find(b => b.label === selected) ?? null;

  return (
    <Card title="Sleep Timeline" className="col-span-full">
      <div className="relative h-10 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-700">
        {bars.map(bar => (
          <button
            key={bar.label}
            type="button"
            aria-label={bar.label}
            title={bar.label}
            onClick={() => setSelected(prev => (prev === bar.label ? null : bar.label))}
            className={
              bar.kind === 'sleep'
                ? `absolute top-0 h-full bg-indigo-500 dark:bg-indigo-600 ${selected === bar.label ? 'ring-2 ring-inset ring-white/70' : ''}`
                : `absolute top-0 h-full bg-amber-400 dark:bg-amber-500 ${selected === bar.label ? 'ring-2 ring-inset ring-white/70' : ''}`
            }
            style={{ left: `${bar.left}%`, width: `${Math.max(bar.width, 0.3)}%` }}
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
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400 dark:bg-amber-500" />
          <span className="text-xs text-slate-500 dark:text-slate-400">Awake</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-100 dark:bg-slate-700" />
          <span className="text-xs text-slate-500 dark:text-slate-400">Unknown</span>
        </div>
        <span className="ml-auto text-xs text-slate-600 dark:text-slate-300">
          {selectedBar ? selectedBar.label : <span className="text-slate-400">Tap a segment for times</span>}
        </span>
      </div>
    </Card>
  );
}
