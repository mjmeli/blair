import { useState, useEffect } from 'react';
import { Video, Loader2, AlertTriangle, Activity, Sparkles, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Volume2 } from 'lucide-react';
import { Card } from '../common/Card';
import { ErrorState } from '../common/ErrorState';
import { errorMessage } from '../../utils/errors';
import * as api from '../../services/api';
import type { AudioAnalysis } from '../../services/api';
import type { Baby } from '../../types';

interface Props {
  baby: Baby | null;
  prematureWeeks: number;
  // Optional: when provided, only show events within this window and hide the card if none match.
  nightStart?: number;
  nightEnd?: number;
  // Optional: label shown when no events match (e.g. "Apr 12")
  nightLabel?: string;
}

interface NanitEvent {
  uid: string;
  key: string;
  title: string;
  time: number;
  begin_ts: number;
  end_ts: number;
  clip: boolean;
  url?: string;
  media_urls?: {
    clip?: string;
    thumbnail?: string;
    animated_thumbnail?: string;
  };
  raw_videos?: {
    media_segments?: { video_url: string }[];
    total_duration?: number;
  };
}

interface AnalysisResult {
  summary: string;
  crying: { detected: boolean; confidence: number; description: string };
  movement: { level: string; description: string };
  coughing?: { detected: boolean; description: string };
  position?: { description: string; safe: boolean };
  environment?: { lighting: string; noise_level: string };
  alerts: string[];
}

const EVENTS_PER_PAGE = 10;

export function VideoEventsCard({ baby, prematureWeeks, nightStart, nightEnd, nightLabel }: Props) {
  const [allEvents, setAllEvents] = useState<NanitEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analyzingAudio, setAnalyzingAudio] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisResult>>({});
  const [audioAnalyses, setAudioAnalyses] = useState<Record<string, AudioAnalysis>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(0);
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ffmpeg_available: boolean; ai_available: boolean; audio_available: boolean } | null>(null);

  useEffect(() => {
    if (!baby) return;
    setLoading(true);
    setError(null);
    // Fetch more events (100) so older nights still have events available — Nanit returns newest first
    api.getVideoEvents(baby.uid, 100)
      .then(data => setAllEvents((data.events || []).filter((e: NanitEvent) => e.clip)))
      .catch(err => { setAllEvents([]); setError(errorMessage(err)); })
      .finally(() => setLoading(false));
  }, [baby, attempt]);

  // What the server can actually do, so the analysis buttons don't fail silently
  useEffect(() => {
    if (!baby) return;
    api.getVideoStatus(baby.uid).then(setStatus).catch(() => setStatus(null));
  }, [baby]);

  const videoDisabledReason = status && !status.ai_available ? 'AI analysis is not configured on the server' : null;
  const audioDisabledReason = status && !status.audio_available
    ? 'Audio analysis is not configured on the server'
    : status && !status.ffmpeg_available
      ? 'Audio analysis needs ffmpeg on the server'
      : null;

  // Filter events to the current night window (when provided)
  const events = nightStart && nightEnd
    ? allEvents.filter(e => e.time >= nightStart && e.time <= nightEnd)
    : allEvents;
  const pageCount = Math.ceil(events.length / EVENTS_PER_PAGE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visibleEvents = events.slice(currentPage * EVENTS_PER_PAGE, (currentPage + 1) * EVENTS_PER_PAGE);

  useEffect(() => {
    setPage(0);
  }, [baby?.uid, nightStart, nightEnd, attempt]);

  const getClipUrl = (e: NanitEvent) => e.media_urls?.clip || e.url || e.raw_videos?.media_segments?.[0]?.video_url || null;

  const analyzeClip = async (event: NanitEvent) => {
    if (!baby) return;
    setAnalyzing(event.uid);
    try {
      const result = await api.analyzeVideoClip(
        baby.uid,
        getClipUrl(event),
        event.media_urls?.thumbnail || null,
        event.key,
        event.title,
        baby.birthdate,
        prematureWeeks,
      );
      setAnalyses(prev => ({ ...prev, [event.uid]: result.analysis }));
      setAnalysisErrors(prev => { const next = { ...prev }; delete next[event.uid]; return next; });
      setExpanded(event.uid);
    } catch (err) {
      setAnalysisErrors(prev => ({ ...prev, [event.uid]: errorMessage(err, 'Video analysis failed.') }));
    } finally {
      setAnalyzing(null);
    }
  };

  // For audio analysis, prefer the raw S3 video (has audio) over the processed events.nanit.com clip (often video-only)
  const getAudioUrl = (e: NanitEvent) =>
    e.raw_videos?.media_segments?.[0]?.video_url || e.media_urls?.clip || e.url || null;

  const analyzeAudio = async (event: NanitEvent) => {
    if (!baby) return;
    const audioUrl = getAudioUrl(event);
    if (!audioUrl) return;
    setAnalyzingAudio(event.uid);
    try {
      const result = await api.analyzeAudio(baby.uid, audioUrl, event.key, baby.birthdate, prematureWeeks);
      setAudioAnalyses(prev => ({ ...prev, [event.uid]: result.analysis }));
      setAnalysisErrors(prev => { const next = { ...prev }; delete next[event.uid]; return next; });
    } catch (err) {
      setAnalysisErrors(prev => ({ ...prev, [event.uid]: errorMessage(err, 'Audio analysis failed.') }));
    } finally {
      setAnalyzingAudio(null);
    }
  };

  const formatTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const eventBadge = (key: string) => {
    const colors: Record<string, string> = {
      PUT_TO_SLEEP: 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400',
      FELL_ASLEEP: 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400',
      WOKE_UP: 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400',
      MOTION: 'bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400',
      SOUND: 'bg-pink-100 dark:bg-pink-500/20 text-pink-600 dark:text-pink-400',
      CRYING: 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400',
    };
    return colors[key] || 'bg-slate-100 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400';
  };

  const windowMode = !!(nightStart && nightEnd);

  if (loading) {
    return (
      <Card title="Video Events">
        <div className="flex h-20 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Video Events" className="col-span-full" action={<Video size={16} className="text-violet-600 dark:text-violet-400" />}>
        <ErrorState message={error} onRetry={() => setAttempt(a => a + 1)} compact />
      </Card>
    );
  }

  const titleSuffix = windowMode && nightLabel ? ` — ${nightLabel}` : '';

  return (
    <Card
      title={`Video Events (${events.length})${titleSuffix}`}
      className="col-span-full"
      action={<Video size={16} className="text-violet-600 dark:text-violet-400" />}
    >
      {events.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-600 dark:text-slate-400">
          {windowMode
            ? `No clips for this night. Nanit only keeps the ${allEvents.length} most recent clips, so older nights may have none.`
            : 'No video events found.'}
        </p>
      ) : (
        <div className="space-y-2">
          {visibleEvents.map(event => {
            const clipUrl = getClipUrl(event);
            const isExpanded = expanded === event.uid;
            const analysis = analyses[event.uid];

            return (
              <div key={event.uid} className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/50">
                {/* Event header - always visible */}
                <div
                  className="flex cursor-pointer items-center gap-2 p-2.5 sm:gap-3 sm:p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
                  onClick={() => setExpanded(isExpanded ? null : event.uid)}
                >
                  {/* Thumbnail */}
                  {event.media_urls?.thumbnail ? (
                    <img src={event.media_urls.thumbnail} alt="" className="h-10 w-14 shrink-0 rounded object-cover sm:h-12 sm:w-16" />
                  ) : (
                    <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded bg-slate-200 dark:bg-slate-800 sm:h-12 sm:w-16">
                      <Video size={14} className="text-slate-400 dark:text-slate-600" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${eventBadge(event.key)}`}>
                        {event.key.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[11px] text-slate-500">{formatTime(event.time)}</span>
                      {analysis?.crying?.detected && (
                        <span className="rounded bg-red-100 dark:bg-red-500/20 px-1 py-0.5 text-[9px] text-red-600 dark:text-red-400">CRY</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-slate-600 dark:text-slate-400 sm:text-xs">{event.title}</p>
                  </div>

                  {isExpanded ? <ChevronUp size={16} className="shrink-0 text-slate-500" /> : <ChevronDown size={16} className="shrink-0 text-slate-500" />}
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-slate-200 dark:border-slate-700">
                    {/* Video player */}
                    {clipUrl && (
                      <div className="bg-black">
                        {playing === event.uid ? (
                          <video
                            src={clipUrl}
                            controls
                            autoPlay
                            playsInline
                            className="w-full max-h-[300px]"
                            onError={() => setPlaying(null)}
                          />
                        ) : (
                          <div
                            className="relative cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); setPlaying(event.uid); }}
                          >
                            {event.media_urls?.thumbnail ? (
                              <img src={event.media_urls.thumbnail} alt="" className="w-full max-h-[200px] object-contain" />
                            ) : (
                              <div className="flex h-32 items-center justify-center bg-slate-100 dark:bg-slate-900">
                                <Video size={32} className="text-slate-400 dark:text-slate-600" />
                              </div>
                            )}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <div className="rounded-full bg-white/20 p-3 backdrop-blur">
                                <div className="ml-0.5 h-0 w-0 border-l-[16px] border-t-[10px] border-b-[10px] border-l-white border-t-transparent border-b-transparent" />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* AI Analysis buttons + results */}
                    <div className="p-3 space-y-2">
                      {/* Action buttons row */}
                      <div className="grid grid-cols-2 gap-2">
                        {!analysis ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); analyzeClip(event); }}
                            disabled={analyzing === event.uid || !!videoDisabledReason}
                            title={videoDisabledReason ?? undefined}
                            className="flex items-center justify-center gap-1.5 rounded-lg bg-violet-100 dark:bg-violet-600/20 px-2 py-1.5 text-[11px] font-medium text-violet-800 dark:text-violet-300 transition hover:bg-violet-200 dark:hover:bg-violet-600/30 disabled:opacity-50"
                          >
                            {analyzing === event.uid ? (
                              <><Loader2 size={12} className="animate-spin" /> Analyzing…</>
                            ) : (
                              <><Sparkles size={12} /> Video analysis</>
                            )}
                          </button>
                        ) : (
                          <span className="flex items-center justify-center gap-1 rounded-lg bg-violet-50 dark:bg-violet-900/30 px-2 py-1.5 text-[11px] text-violet-500 dark:text-violet-400/70">
                            <Sparkles size={12} /> Video analyzed
                          </span>
                        )}

                        {!audioAnalyses[event.uid] ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); analyzeAudio(event); }}
                            disabled={analyzingAudio === event.uid || !!audioDisabledReason}
                            title={audioDisabledReason ?? undefined}
                            className="flex items-center justify-center gap-1.5 rounded-lg bg-pink-100 dark:bg-pink-600/20 px-2 py-1.5 text-[11px] font-medium text-pink-800 dark:text-pink-300 transition hover:bg-pink-200 dark:hover:bg-pink-600/30 disabled:opacity-50"
                          >
                            {analyzingAudio === event.uid ? (
                              <><Loader2 size={12} className="animate-spin" /> Listening…</>
                            ) : (
                              <><Volume2 size={12} /> Audio analysis</>
                            )}
                          </button>
                        ) : (
                          <span className="flex items-center justify-center gap-1 rounded-lg bg-pink-50 dark:bg-pink-900/30 px-2 py-1.5 text-[11px] text-pink-500 dark:text-pink-400/70">
                            <Volume2 size={12} /> Audio analyzed
                          </span>
                        )}
                      </div>
                      {analysisErrors[event.uid] && (
                        <ErrorState title="Analysis failed" message={analysisErrors[event.uid]} compact />
                      )}
                      {(videoDisabledReason || audioDisabledReason) && (
                        <p className="text-[10px] text-slate-500">{videoDisabledReason ?? audioDisabledReason}</p>
                      )}

                      {/* Video analysis results */}
                      {analysis && (
                        <>
                          <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">{analysis.summary}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {analysis.crying?.detected && (
                              <span className="rounded bg-red-50 dark:bg-red-500/10 px-2 py-0.5 text-[10px] text-red-600 dark:text-red-400">
                                Crying {Math.round(analysis.crying.confidence * 100)}%
                              </span>
                            )}
                            <span className="rounded bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 text-[10px] text-indigo-600 dark:text-indigo-400">
                              <Activity size={9} className="mr-0.5 inline" />{analysis.movement?.level}
                            </span>
                            {analysis.position && (
                              <span className={`rounded px-2 py-0.5 text-[10px] ${
                                analysis.position.safe ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                              }`}>
                                {analysis.position.description}
                              </span>
                            )}
                            {analysis.environment && (
                              <span className="rounded bg-slate-100 dark:bg-slate-500/10 px-2 py-0.5 text-[10px] text-slate-600 dark:text-slate-400">
                                {analysis.environment.lighting}
                              </span>
                            )}
                          </div>
                          {analysis.alerts?.length > 0 && (
                            <div className="rounded bg-amber-50 dark:bg-amber-500/10 p-2">
                              {analysis.alerts.map((a, i) => (
                                <p key={i} className="flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                                  <AlertTriangle size={10} className="mt-0.5 shrink-0" /> {a}
                                </p>
                              ))}
                            </div>
                          )}
                        </>
                      )}

                      {/* Audio analysis results */}
                      {audioAnalyses[event.uid] && audioAnalyses[event.uid].no_audio_track && (
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/50 p-2.5">
                          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                            <Volume2 size={10} /> No audio in this clip
                          </p>
                          <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">{audioAnalyses[event.uid].description}</p>
                        </div>
                      )}
                      {audioAnalyses[event.uid] && !audioAnalyses[event.uid].no_audio_track && (
                        <div className="rounded-lg border border-pink-200 dark:border-pink-500/20 bg-pink-50 dark:bg-pink-950/20 p-2.5 space-y-1.5">
                          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-pink-600 dark:text-pink-400">
                            <Volume2 size={10} /> Audio Analysis
                          </p>
                          <p className="text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">{audioAnalyses[event.uid].description}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {audioAnalyses[event.uid].classification !== 'none' && (
                              <span className="rounded bg-pink-50 dark:bg-pink-500/10 px-2 py-0.5 text-[10px] capitalize text-pink-800 dark:text-pink-300">
                                {audioAnalyses[event.uid].classification}
                              </span>
                            )}
                            {audioAnalyses[event.uid].cry_type && audioAnalyses[event.uid].cry_type !== 'unknown' && (
                              <span className="rounded bg-red-50 dark:bg-red-500/10 px-2 py-0.5 text-[10px] text-red-800 dark:text-red-300">
                                {audioAnalyses[event.uid].cry_type!.replace(/_/g, ' ')}
                                {audioAnalyses[event.uid].confidence > 0 && (
                                  <span className="ml-1 opacity-70">{Math.round(audioAnalyses[event.uid].confidence * 100)}%</span>
                                )}
                              </span>
                            )}
                            {audioAnalyses[event.uid].intensity !== 'none' && (
                              <span className="rounded bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 text-[10px] capitalize text-amber-800 dark:text-amber-300">
                                {audioAnalyses[event.uid].intensity} intensity
                              </span>
                            )}
                            {audioAnalyses[event.uid].patterns?.slice(0, 3).map((p, i) => (
                              <span key={i} className="rounded bg-slate-100 dark:bg-slate-500/10 px-2 py-0.5 text-[10px] text-slate-600 dark:text-slate-400">
                                {p}
                              </span>
                            ))}
                          </div>
                          {audioAnalyses[event.uid].recommendation && (
                            <p className="text-[10px] italic text-pink-800 dark:text-pink-200/80">{audioAnalyses[event.uid].recommendation}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-3 pt-2 text-xs text-slate-600 dark:text-slate-400">
              <span>
                Showing {currentPage * EVENTS_PER_PAGE + 1}–{Math.min((currentPage + 1) * EVENTS_PER_PAGE, events.length)} of {events.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage === 0}
                  aria-label="Previous page of video events"
                  className="flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft size={14} /> Previous
                </button>
                <span aria-live="polite">{currentPage + 1} / {pageCount}</span>
                <button
                  type="button"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= pageCount - 1}
                  aria-label="Next page of video events"
                  className="flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
