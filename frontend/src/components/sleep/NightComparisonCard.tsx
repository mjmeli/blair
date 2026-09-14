import { useState } from 'react';
import { GitCompare, Loader2, Trophy, ArrowLeftRight, Lightbulb } from 'lucide-react';
import { DateTime } from 'luxon';
import { Card } from '../common/Card';
import * as api from '../../services/api';
import type { NightComparison } from '../../services/api';
import type { Baby } from '../../types';

interface Props {
  baby: Baby | null;
  prematureWeeks: number;
  bedtimeHour: number;
  wakeHour: number;
}

export function NightComparisonCard({ baby, prematureWeeks, bedtimeHour, wakeHour }: Props) {
  const [dateA, setDateA] = useState(DateTime.now().minus({ days: 1 }).toFormat('yyyy-MM-dd'));
  const [dateB, setDateB] = useState(DateTime.now().minus({ days: 2 }).toFormat('yyyy-MM-dd'));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ comparison: NightComparison; night_a: any; night_b: any } | null>(null);

  const maxDate = DateTime.now().minus({ days: 1 }).toFormat('yyyy-MM-dd');

  const runCompare = async () => {
    if (!baby) return;
    if (dateA === dateB) {
      setError('Pick two different nights to compare');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.compareNights(baby.uid, dateA, dateB, baby.birthdate, prematureWeeks, bedtimeHour, wakeHour);
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Failed to compare nights');
    } finally {
      setLoading(false);
    }
  };

  const dateLabel = (d: string) => DateTime.fromISO(d).toFormat('EEE, MMM d');
  const scoreA = result?.night_a?.score?.total_score ?? null;
  const scoreB = result?.night_b?.score?.total_score ?? null;

  return (
    <Card
      title="Compare Nights"
      className="col-span-full"
      action={<GitCompare size={14} className="text-cyan-600 dark:text-cyan-400" />}
    >
      <div className="space-y-4">
        {/* Date picker row */}
        <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">Night A</label>
            <input
              type="date"
              value={dateA}
              max={maxDate}
              onChange={e => setDateA(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div className="hidden pb-1.5 text-center sm:block">
            <ArrowLeftRight size={16} className="text-slate-500" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">Night B</label>
            <input
              type="date"
              value={dateB}
              max={maxDate}
              onChange={e => setDateB(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <button
            onClick={runCompare}
            disabled={loading || !baby}
            className="col-span-2 h-[32px] rounded-lg bg-cyan-100 dark:bg-cyan-600/30 px-3 text-xs font-medium text-cyan-900 dark:text-cyan-200 transition hover:bg-cyan-200 dark:hover:bg-cyan-600/50 disabled:opacity-50 sm:col-span-1"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : 'Compare'}
          </button>
        </div>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        {loading && !result && (
          <div className="flex items-center gap-2 py-4">
            <Loader2 size={14} className="animate-spin text-cyan-600 dark:text-cyan-400" />
            <p className="text-xs text-slate-600 dark:text-slate-400">Analyzing both nights with video context…</p>
          </div>
        )}

        {result && (
          <>
            {/* Score header */}
            <div className="grid grid-cols-2 gap-3">
              <div className={`rounded-lg p-3 text-center ${result.comparison.winner === 'a' ? 'border border-emerald-200 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30' : 'border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/50'}`}>
                <p className="text-[10px] uppercase tracking-wide text-slate-500">{dateLabel(dateA)}</p>
                <div className="mt-1 flex items-center justify-center gap-1">
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{scoreA}</p>
                  {result.comparison.winner === 'a' && <Trophy size={14} className="text-amber-600 dark:text-amber-400" />}
                </div>
              </div>
              <div className={`rounded-lg p-3 text-center ${result.comparison.winner === 'b' ? 'border border-emerald-200 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30' : 'border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/50'}`}>
                <p className="text-[10px] uppercase tracking-wide text-slate-500">{dateLabel(dateB)}</p>
                <div className="mt-1 flex items-center justify-center gap-1">
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{scoreB}</p>
                  {result.comparison.winner === 'b' && <Trophy size={14} className="text-amber-600 dark:text-amber-400" />}
                </div>
              </div>
            </div>

            {/* Summary */}
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{result.comparison.summary}</p>

            {/* Key differences table */}
            {result.comparison.key_differences?.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-cyan-600 dark:text-cyan-400">Key differences</p>
                <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                  {result.comparison.key_differences.map((d, i) => (
                    <div key={i} className={`grid grid-cols-[1fr_1fr_1fr] gap-2 p-2 text-[11px] ${i % 2 ? 'bg-slate-50 dark:bg-slate-900/30' : 'bg-slate-100 dark:bg-slate-900/50'}`}>
                      <div>
                        <p className="text-slate-500">{d.metric}</p>
                        <p className="mt-0.5 text-slate-700 dark:text-slate-300">A: {d.night_a}</p>
                        <p className="text-slate-700 dark:text-slate-300">B: {d.night_b}</p>
                      </div>
                      <div className="col-span-2 text-slate-600 dark:text-slate-400">{d.impact}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Root cause */}
            {result.comparison.what_drove_difference && (
              <div className="rounded-lg bg-cyan-50 dark:bg-cyan-950/30 p-3">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-600 dark:text-cyan-400">What drove the difference</p>
                <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">{result.comparison.what_drove_difference}</p>
              </div>
            )}

            {/* Recommendation */}
            {result.comparison.recommendation && (
              <div className="flex items-start gap-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 p-3">
                <Lightbulb size={14} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                <p className="text-xs leading-relaxed text-indigo-800 dark:text-indigo-300">{result.comparison.recommendation}</p>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
