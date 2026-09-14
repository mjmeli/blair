import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { Loader2, PencilLine, RotateCcw, Save } from 'lucide-react';
import { Card } from '../common/Card';
import { ErrorState } from '../common/ErrorState';
import { errorMessage } from '../../utils/errors';
import * as api from '../../services/api';
import type { Baby, ScoredNight } from '../../types';

interface Props {
  baby: Baby | null;
  night: ScoredNight | null;
  loading?: boolean;
  /** Called after a save or reset so the parent can refetch the score. */
  onSaved: () => void;
}

const INPUT_FMT = "yyyy-MM-dd'T'HH:mm";

function toInput(unix: number): string {
  return DateTime.fromSeconds(unix).toFormat(INPUT_FMT);
}

function fromInput(value: string): number | null {
  const dt = DateTime.fromFormat(value, INPUT_FMT);
  return dt.isValid ? Math.floor(dt.toSeconds()) : null;
}

/**
 * Lets the parent correct when the night actually started and ended when
 * Nanit got it wrong. The score, timeline, trend, alerts, and AI insights all
 * use the corrected window.
 */
export function NightAdjustCard({ baby, night, loading, onSaved }: Props) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the inputs whenever a different night (or a fresh score) arrives
  useEffect(() => {
    if (!night) return;
    setStart(toInput(night.night_start));
    setEnd(toInput(night.night_end));
    setError(null);
  }, [night]);

  if (loading || !night) return null;

  const detectedStart = toInput(night.raw_night_start);
  const detectedEnd = toInput(night.raw_night_end);
  const isAdjusted = night.details.adjusted;
  const dirty = start !== toInput(night.night_start) || end !== toInput(night.night_end);

  const save = async () => {
    if (!baby) return;
    const s = fromInput(start);
    const e = fromInput(end);
    if (s === null || e === null) { setError('Enter a valid start and end time.'); return; }
    if (e <= s) { setError('Wake time must be after bedtime.'); return; }
    setSaving(true);
    setError(null);
    try {
      // Only store a boundary if it differs from what Nanit detected
      await api.updateSleepAnnotation(
        baby.uid,
        night.night_id,
        s !== night.raw_night_start ? s : null,
        e !== night.raw_night_end ? e : null,
      );
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!baby) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateSleepAnnotation(baby.uid, night.night_id, null, null);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';

  return (
    <Card
      title="Adjust Night"
      className="col-span-full"
      action={
        isAdjusted ? (
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">Adjusted</span>
        ) : (
          <PencilLine size={14} className="text-slate-400" />
        )
      }
    >
      <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">
        Nanit missed the start or end of the night? Set the real times and the score, timeline, trend, and insights will use them.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">Fell asleep</label>
          <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} className={inputClass} />
          <p className="mt-1 text-[10px] text-slate-400">Nanit detected {DateTime.fromFormat(detectedStart, INPUT_FMT).toFormat('h:mm a')}</p>
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">Woke for the day</label>
          <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} className={inputClass} />
          <p className="mt-1 text-[10px] text-slate-400">Nanit detected {DateTime.fromFormat(detectedEnd, INPUT_FMT).toFormat('h:mm a')}</p>
        </div>
        <div className="flex gap-2 sm:pb-5">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
          </button>
          {isAdjusted && (
            <button
              onClick={reset}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-300 disabled:opacity-40 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
              title="Go back to what Nanit detected"
            >
              <RotateCcw size={12} /> Reset
            </button>
          )}
        </div>
      </div>
      {error && <div className="mt-3"><ErrorState title="Couldn't save" message={error} compact /></div>}
    </Card>
  );
}
