import { useState, useEffect, useCallback } from 'react';
import { Moon, Activity, RefreshCw, TrendingUp, Sparkles, CheckCircle, AlertTriangle, Lightbulb } from 'lucide-react';
import { Card } from '../common/Card';
import * as api from '../../services/api';
import type { NightInsights } from '../../services/api';
import type { Baby } from '../../types';

interface Props {
  baby: Baby | null;
  nightStart: number;
  nightEnd: number;
  prematureWeeks: number;
  bedtimeHour: number;
  wakeHour: number;
}

interface LiveNightData {
  score: any | null;
  events: { motion: number; sound: number };
  elapsedMinutes: number;
  isAsleep: boolean;
  lastEventTime: number | null;
}

export function NightInProgressCard({ baby, nightStart, nightEnd, prematureWeeks, bedtimeHour, wakeHour }: Props) {
  const [data, setData] = useState<LiveNightData | null>(null);
  const [insights, setInsights] = useState<NightInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsRegenerating, setInsightsRegenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    if (!baby) return;

    try {
      const [scores, msgs] = await Promise.all([
        api.getSleepScore(baby.uid, nightStart, nightEnd, baby.birthdate, prematureWeeks).catch(() => []),
        api.getEvents(baby.uid, undefined, 50).catch(() => []),
      ]);

      // Filter messages to tonight's window
      const tonightMsgs = msgs.filter(m => m.time >= nightStart && m.time <= nightEnd);
      const motion = tonightMsgs.filter(m => m.type === 'MOTION').length;
      const sound = tonightMsgs.filter(m => m.type === 'SOUND').length;
      const lastEvent = tonightMsgs.length > 0 ? Math.max(...tonightMsgs.map(m => m.time)) : null;

      const mainScore = scores.length > 0
        ? scores.reduce((best: any, s: any) =>
            s.details.total_sleep_minutes > (best?.details?.total_sleep_minutes ?? 0) ? s : best
          , scores[0])
        : null;

      const now = Math.floor(Date.now() / 1000);
      const elapsedMinutes = Math.round((now - nightStart) / 60);

      // Infer if baby is likely asleep based on recent event activity
      const recentWindow = now - 600; // last 10 minutes
      const recentEvents = tonightMsgs.filter(m => m.time >= recentWindow);
      const isAsleep = recentEvents.length <= 1; // 0-1 events in 10 min = likely asleep

      setData({
        score: mainScore,
        events: { motion, sound },
        elapsedMinutes,
        isAsleep,
        lastEventTime: lastEvent,
      });
      setLastRefresh(new Date());
    } catch {
      // Ignore errors for live updates
    } finally {
      setLoading(false);
    }
  }, [baby, nightStart, nightEnd, prematureWeeks]);

  const fetchInsights = useCallback(async (force = false) => {
    if (!baby) return;
    if (force) {
      setInsightsRegenerating(true);
    } else {
      setInsightsLoading(true);
    }
    try {
      const result = await api.getInsights(baby.uid, nightStart, nightEnd, baby.birthdate, prematureWeeks, bedtimeHour, wakeHour, force);
      setInsights(result);
    } catch {
      // silently ignore
    } finally {
      setInsightsLoading(false);
      setInsightsRegenerating(false);
    }
  }, [baby, nightStart, nightEnd, prematureWeeks, bedtimeHour, wakeHour]);

  // Fetch insights once score is available
  useEffect(() => {
    if (!baby || !data?.score) return;
    fetchInsights(false);
  }, [baby, data?.score?.total_score]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial fetch + auto-refresh every 5 minutes
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <Card title="Night in Progress" className="col-span-full">
        <div className="flex h-24 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      </Card>
    );
  }

  const formatDuration = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const formatTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const sleepMinutes = data?.score?.details?.total_sleep_minutes ?? 0;

  return (
    <Card
      title="Night in Progress"
      className="col-span-full border-indigo-500/30"
      action={
        <button onClick={fetchData} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
          <RefreshCw size={12} />
          {lastRefresh.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </button>
      }
    >
      <div className="space-y-4">
        {/* Status banner */}
        <div className={`flex items-center gap-3 rounded-lg p-3 ${
          data?.isAsleep ? 'bg-indigo-950/50' : 'bg-amber-950/50'
        }`}>
          <div className={`rounded-full p-2 ${
            data?.isAsleep ? 'bg-indigo-500/20' : 'bg-amber-500/20'
          }`}>
            {data?.isAsleep ? (
              <Moon size={18} className="text-indigo-400" />
            ) : (
              <Activity size={18} className="text-amber-400" />
            )}
          </div>
          <div>
            <p className={`text-sm font-medium ${
              data?.isAsleep ? 'text-indigo-300' : 'text-amber-300'
            }`}>
              {data?.isAsleep ? 'Baby appears to be sleeping' : 'Baby appears to be awake'}
            </p>
            <p className="text-xs text-slate-400">
              {data?.lastEventTime
                ? `Last activity: ${formatTime(data.lastEventTime)}`
                : 'No activity detected yet tonight'}
            </p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center">
            <p className="text-xs text-slate-500">Elapsed</p>
            <p className="text-sm font-semibold text-slate-200">{formatDuration(data?.elapsedMinutes ?? 0)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">Sleep so far</p>
            <p className="text-sm font-semibold text-slate-200">{formatDuration(sleepMinutes)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">Motion</p>
            <p className="text-sm font-semibold text-slate-200">{data?.events.motion ?? 0}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">Sound</p>
            <p className="text-sm font-semibold text-slate-200">{data?.events.sound ?? 0}</p>
          </div>
        </div>

        {/* Running score */}
        {data?.score && (
          <div className="flex items-center gap-3 rounded-lg bg-slate-900/50 p-3">
            <TrendingUp size={16} className="text-indigo-400" />
            <div>
              <p className="text-sm text-slate-300">
                Running score: <span className="font-semibold text-white">{data.score.total_score}/100</span>
                {data.score.details.wake_count > 0 && (
                  <span className="ml-2 text-xs text-slate-400">({data.score.details.wake_count} wakes so far)</span>
                )}
              </p>
              {data.score.details.longest_stretch_minutes > 0 && (
                <p className="text-xs text-slate-500">
                  Longest stretch: {formatDuration(data.score.details.longest_stretch_minutes)}
                </p>
              )}
            </div>
          </div>
        )}

        {/* AI insights for tonight */}
        {(insightsLoading || insightsRegenerating || insights) && (
          <div className="rounded-lg border border-indigo-500/20 bg-indigo-950/20 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-400">
                <Sparkles size={11} />
                AI Insights
              </p>
              {insights && (
                <button
                  onClick={() => fetchInsights(true)}
                  disabled={insightsRegenerating}
                  className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
                  title="Re-run AI analysis"
                >
                  <RefreshCw size={10} className={insightsRegenerating ? 'animate-spin' : ''} />
                  {insightsRegenerating ? 'Regenerating…' : 'Regenerate'}
                </button>
              )}
            </div>

            {(insightsLoading || insightsRegenerating) ? (
              <div className="flex items-center gap-2 py-1">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                <p className="text-xs text-slate-400">
                  {insightsRegenerating ? 'Regenerating insights…' : "Analyzing tonight's sleep…"}
                </p>
              </div>
            ) : insights && (
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-slate-300">{insights.summary}</p>

                {(insights.keyFactors.positive.length > 0 || insights.keyFactors.negative.length > 0) && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {insights.keyFactors.positive.length > 0 && (
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">Going well</p>
                        <ul className="space-y-0.5">
                          {insights.keyFactors.positive.map((item, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[10px] text-emerald-300/80">
                              <CheckCircle size={10} className="mt-0.5 shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {insights.keyFactors.negative.length > 0 && (
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-400">Watch out for</p>
                        <ul className="space-y-0.5">
                          {insights.keyFactors.negative.map((item, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[10px] text-amber-300/80">
                              <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {insights.tip && (
                  <div className="flex items-start gap-1.5 rounded bg-indigo-950/40 p-2">
                    <Lightbulb size={11} className="mt-0.5 shrink-0 text-indigo-400" />
                    <p className="text-[10px] leading-relaxed text-indigo-300">{insights.tip}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-slate-600">Auto-refreshes every 5 minutes. Click the refresh button for latest data.</p>
      </div>
    </Card>
  );
}
