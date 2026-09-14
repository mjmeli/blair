import { useState, useEffect } from 'react';
import { Sparkles, TrendingUp, Home, Heart, Lightbulb, Loader2, Video } from 'lucide-react';
import { Card } from '../common/Card';
import * as api from '../../services/api';
import type { VideoPatterns } from '../../services/api';
import type { Baby } from '../../types';

interface Props {
  baby: Baby | null;
  prematureWeeks: number;
  bedtimeHour: number;
  wakeHour: number;
}

export function VideoPatternsCard({ baby, prematureWeeks, bedtimeHour, wakeHour }: Props) {
  const [data, setData] = useState<VideoPatterns | null>(null);
  const [nightsAnalyzed, setNightsAnalyzed] = useState(0);
  const [eventsAnalyzed, setEventsAnalyzed] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(5);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const fetchPatterns = async () => {
    if (!baby) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.getVideoPatterns(
        baby.uid,
        baby.birthdate,
        prematureWeeks,
        days,
        bedtimeHour,
        wakeHour,
      );
      setData(result.patterns);
      setNightsAnalyzed(result.nights_analyzed || 0);
      setEventsAnalyzed(result.events_analyzed || 0);
      if (result.message) setMessage(result.message);
      setLoadedOnce(true);
    } catch (err: any) {
      setMessage(err.message || 'Failed to load patterns');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (loadedOnce) {
      fetchPatterns();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return (
    <Card
      title="Long-term Video Patterns"
      className="col-span-full"
      action={
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[3, 5, 7].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                disabled={loading}
                className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                  days === d
                    ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-800 dark:text-violet-300'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <Sparkles size={14} className="text-violet-600 dark:text-violet-400" />
        </div>
      }
    >
      {!loadedOnce ? (
        <div className="py-6 text-center space-y-3">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Analyze video clips across the last {days} nights to find patterns, correlations, and trends.
          </p>
          <button
            onClick={fetchPatterns}
            disabled={loading || !baby}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-100 dark:bg-violet-600/20 px-4 py-2 text-sm font-medium text-violet-800 dark:text-violet-300 transition hover:bg-violet-200 dark:hover:bg-violet-600/30 disabled:opacity-50"
          >
            {loading ? (
              <><Loader2 size={14} className="animate-spin" /> Analyzing {days} nights of video...</>
            ) : (
              <><Video size={14} /> Run Analysis</>
            )}
          </button>
        </div>
      ) : loading ? (
        <div className="flex h-24 items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400">
            <Loader2 size={16} className="animate-spin" />
            Analyzing {days} nights of video...
          </div>
        </div>
      ) : !data ? (
        <p className="py-4 text-center text-sm text-slate-600 dark:text-slate-400">{message || 'No patterns found'}</p>
      ) : (
        <div className="space-y-4">
          {/* Summary */}
          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 italic">{data.summary}</p>

          <p className="text-[10px] text-slate-500">
            Analyzed {nightsAnalyzed} nights · {eventsAnalyzed} video events
          </p>

          {/* Patterns */}
          {data.patterns?.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                <TrendingUp size={12} /> Patterns
              </h4>
              <div className="space-y-2">
                {data.patterns.map((p, i) => (
                  <div key={i} className="rounded-lg bg-slate-100 dark:bg-slate-900/50 p-3">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{p.title}</p>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{p.observation}</p>
                    {p.evidence?.length > 0 && (
                      <p className="mt-1.5 text-[10px] text-slate-500">
                        Evidence: {p.evidence.join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Correlations */}
          {data.correlations?.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                Correlations
              </h4>
              <div className="space-y-1.5">
                {data.correlations.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg bg-indigo-50 dark:bg-indigo-500/5 p-2 text-xs">
                    <span className="shrink-0 rounded bg-indigo-100 dark:bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800 dark:text-indigo-300">
                      {c.nights_affected}/{nightsAnalyzed}
                    </span>
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{c.factor}:</span>{' '}
                      <span className="text-slate-600 dark:text-slate-400">{c.impact}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trends in two columns */}
          <div className="grid gap-3 sm:grid-cols-2">
            {data.environmental_trends?.length > 0 && (
              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                  <Home size={12} /> Environment
                </h4>
                <ul className="space-y-1">
                  {data.environmental_trends.map((t, i) => (
                    <li key={i} className="text-xs text-slate-600 dark:text-slate-400">• {t}</li>
                  ))}
                </ul>
              </div>
            )}
            {data.behavioral_trends?.length > 0 && (
              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-pink-600 dark:text-pink-400">
                  <Heart size={12} /> Behavior
                </h4>
                <ul className="space-y-1">
                  {data.behavioral_trends.map((t, i) => (
                    <li key={i} className="text-xs text-slate-600 dark:text-slate-400">• {t}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Recommendations */}
          {data.recommendations?.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                <Lightbulb size={12} /> Recommendations
              </h4>
              <div className="space-y-1.5">
                {data.recommendations.map((r, i) => (
                  <p key={i} className="rounded-lg bg-amber-50 dark:bg-amber-500/5 p-2 text-xs text-amber-900 dark:text-amber-200">
                    {r}
                  </p>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={fetchPatterns}
            disabled={loading}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 py-1.5 text-xs text-slate-600 dark:text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Re-analyze
          </button>
        </div>
      )}
    </Card>
  );
}
