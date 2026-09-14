import { useState, useEffect } from 'react';
import { Calendar, Loader2, Sparkles, RefreshCw, ArrowRight, Check, AlertCircle } from 'lucide-react';
import { Card } from '../common/Card';
import * as api from '../../services/api';
import type { ScheduleRecommendation } from '../../services/api';
import type { Baby } from '../../types';

interface Props {
  baby: Baby | null;
  prematureWeeks: number;
  bedtimeHour: number;
  wakeHour: number;
  onApply?: (bedtime: number, wake: number) => void;
}

function hourLabel(h: number): string {
  const intH = Math.floor(h);
  if (intH === 0) return '12 AM';
  if (intH === 12) return '12 PM';
  if (intH < 12) return `${intH} AM`;
  return `${intH - 12} PM`;
}

function hourRangeLabel(start: number, end: number): string {
  if (start === end) return hourLabel(start);
  return `${hourLabel(start)}–${hourLabel(end)}`;
}

export function ScheduleOptimizerCard({ baby, prematureWeeks, bedtimeHour, wakeHour, onApply }: Props) {
  const [data, setData] = useState<ScheduleRecommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [nightsAnalyzed, setNightsAnalyzed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fetchRecommendation = async (force = false) => {
    if (!baby) return;
    if (force) setRegenerating(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await api.getScheduleRecommendation(
        baby.uid,
        baby.birthdate,
        prematureWeeks,
        bedtimeHour,
        wakeHour,
        force,
      );
      setData(result.recommendation);
      setNightsAnalyzed(result.nights_analyzed);
      setLoadedOnce(true);
    } catch (err: any) {
      console.error(err);
      setData(null);
      setError(err?.message || 'Failed to generate schedule recommendation');
      setLoadedOnce(true);
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  };

  useEffect(() => {
    // auto-load on mount once
    if (!loadedOnce) fetchRecommendation(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baby]);

  const confidenceBadge = data?.confidence && (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
      data.confidence === 'high'
        ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300'
        : data.confidence === 'medium'
          ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300'
          : 'bg-slate-100 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400'
    }`}>
      {data.confidence} confidence
    </span>
  );

  return (
    <Card
      title="Schedule Optimizer"
      className="col-span-full"
      action={
        <div className="flex items-center gap-2">
          {data && (
            <button
              onClick={() => fetchRecommendation(true)}
              disabled={regenerating}
              className="flex items-center gap-1 text-[11px] text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300 disabled:opacity-50"
              title="Re-run optimizer"
            >
              <RefreshCw size={11} className={regenerating ? 'animate-spin' : ''} />
              {regenerating ? 'Recomputing…' : 'Re-analyze'}
            </button>
          )}
          <Calendar size={14} className="text-emerald-600 dark:text-emerald-400" />
        </div>
      }
    >
      {loading && !data ? (
        <div className="flex items-center gap-2 py-6">
          <Loader2 size={14} className="animate-spin text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm text-slate-600 dark:text-slate-400">Analyzing {nightsAnalyzed || '21'} nights of data…</p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-950/30 p-3 space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
            <AlertCircle size={12} /> Analysis failed
          </p>
          <p className="text-[11px] text-red-800 dark:text-red-300/80">{error}</p>
          <button
            onClick={() => fetchRecommendation(true)}
            disabled={regenerating}
            className="flex items-center gap-1.5 rounded-lg bg-red-100 dark:bg-red-600/20 px-2.5 py-1 text-[11px] font-medium text-red-900 dark:text-red-200 transition hover:bg-red-200 dark:hover:bg-red-600/30 disabled:opacity-50"
          >
            {regenerating ? <><Loader2 size={11} className="animate-spin" /> Retrying…</> : <><RefreshCw size={11} /> Retry</>}
          </button>
        </div>
      ) : !data ? (
        <p className="py-4 text-center text-sm text-slate-600 dark:text-slate-400">No recommendation available yet.</p>
      ) : (
        <div className="space-y-4">
          {/* Top recommendation */}
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/30 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={12} className="text-emerald-600 dark:text-emerald-400" />
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Recommended window</p>
              {confidenceBadge}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-slate-500">Bedtime</p>
                <p className="text-lg font-semibold text-emerald-800 dark:text-emerald-300">
                  {hourRangeLabel(data.recommended_bedtime.start_hour, data.recommended_bedtime.end_hour)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">Wake</p>
                <p className="text-lg font-semibold text-emerald-800 dark:text-emerald-300">
                  {hourRangeLabel(data.recommended_wake.start_hour, data.recommended_wake.end_hour)}
                </p>
              </div>
            </div>
            {onApply && (
              <button
                onClick={() => onApply(data.recommended_bedtime.start_hour, data.recommended_wake.start_hour)}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-600/30 px-3 py-1.5 text-xs font-medium text-emerald-900 dark:text-emerald-200 transition hover:bg-emerald-200 dark:hover:bg-emerald-600/50"
              >
                <Check size={12} /> Apply to settings
              </button>
            )}
          </div>

          {/* Current vs recommended */}
          {data.current_vs_recommended && (
            <div className="flex items-start gap-2 rounded bg-slate-100 dark:bg-slate-900/50 p-2">
              <ArrowRight size={12} className="mt-0.5 shrink-0 text-slate-500" />
              <p className="text-xs text-slate-700 dark:text-slate-300">{data.current_vs_recommended}</p>
            </div>
          )}

          {/* Reasoning */}
          {data.reasoning && (
            <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">{data.reasoning}</p>
          )}

          {/* Patterns */}
          {data.observed_patterns && data.observed_patterns.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Patterns found</p>
              <ul className="space-y-1">
                {data.observed_patterns.map((p, i) => (
                  <li key={i} className="text-xs text-slate-600 dark:text-slate-400">• {p}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Expected impact */}
          {data.expected_impact && (
            <div className="rounded bg-violet-50 dark:bg-violet-950/30 p-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">Expected impact</p>
              <p className="mt-0.5 text-xs text-violet-900 dark:text-violet-200">{data.expected_impact}</p>
            </div>
          )}

          {/* Cautions */}
          {data.cautions && data.cautions.length > 0 && (
            <div className="rounded border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 p-2">
              <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                <AlertCircle size={10} /> Keep in mind
              </p>
              <ul className="space-y-0.5">
                {data.cautions.map((c, i) => (
                  <li key={i} className="text-[11px] text-amber-800 dark:text-amber-200/80">• {c}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[10px] text-slate-400 dark:text-slate-600">Based on {data.nights_analyzed} nights of data.</p>
        </div>
      )}
    </Card>
  );
}
