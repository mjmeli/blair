import { useMemo } from 'react';
import { Card } from '../common/Card';
import { formatDuration } from '../../utils/date';

function formatTime(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface SleepSegment {
  uid: string;
  begin_ts: number;
  end_ts: number;
  duration: number;
  type: string;
}

interface Gap {
  start: number;
  end: number;
  duration_minutes: number;
}

interface Props {
  sleepScore: {
    night_start: number;
    night_end: number;
    segments: SleepSegment[];
    gaps: Gap[];
  } | null;
  loading?: boolean;
}

export function SleepTimeline({ sleepScore, loading }: Props) {
  const { sleepBars, awakeBars, hours } = useMemo(() => {
    if (!sleepScore || !sleepScore.segments?.length) {
      return { sleepBars: [], awakeBars: [], hours: [] };
    }

    const start = sleepScore.night_start;
    const end = sleepScore.night_end;
    const total = end - start;
    if (total <= 0) return { sleepBars: [], awakeBars: [], hours: [] };

    const sleepBars = sleepScore.segments.map(seg => ({
      left: ((seg.begin_ts - start) / total) * 100,
      width: ((seg.end_ts - seg.begin_ts) / total) * 100,
      label: `Asleep — ${formatDuration(seg.duration / 60)} (${formatTime(seg.begin_ts)}–${formatTime(seg.end_ts)})`,
    }));

    const awakeBars = (sleepScore.gaps || []).map(gap => ({
      left: ((gap.start - start) / total) * 100,
      width: ((gap.end - gap.start) / total) * 100,
      label: `Awake — ${formatDuration(gap.duration_minutes)} (${formatTime(gap.start)}–${formatTime(gap.end)})`,
    }));

    // Hour markers
    const markers: { label: string; left: number }[] = [];
    let t = Math.ceil(start / 3600) * 3600;
    while (t < end) {
      const d = new Date(t * 1000);
      const h = d.getHours();
      const label = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
      markers.push({ label, left: ((t - start) / total) * 100 });
      t += 3600;
    }

    return { sleepBars, awakeBars, hours: markers };
  }, [sleepScore]);

  if (loading) {
    return (
      <Card title="Sleep Timeline">
        <div className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700" />
      </Card>
    );
  }

  if (!sleepScore || sleepBars.length === 0) {
    return (
      <Card title="Sleep Timeline">
        <p className="py-6 text-center text-sm text-slate-400">No sleep data</p>
      </Card>
    );
  }

  return (
    <Card title="Sleep Timeline" className="col-span-full">
      <div className="relative h-10 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-700">
        {/* Awake gaps */}
        {awakeBars.map((bar, i) => (
          <div
            key={`awake-${i}`}
            className="absolute top-0 h-full bg-amber-400 dark:bg-amber-500"
            style={{ left: `${bar.left}%`, width: `${Math.max(bar.width, 0.3)}%` }}
            title={bar.label}
          />
        ))}
        {/* Sleep segments */}
        {sleepBars.map((bar, i) => (
          <div
            key={`sleep-${i}`}
            className="absolute top-0 h-full bg-indigo-500 dark:bg-indigo-600"
            style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
            title={bar.label}
          />
        ))}
      </div>
      <div className="relative mt-1 h-4">
        {hours.map((m, i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 text-[10px] text-slate-400"
            style={{ left: `${m.left}%` }}
          >
            {m.label}
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-4">
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
      </div>
    </Card>
  );
}
