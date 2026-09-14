import { z } from 'zod';
import { generateStructured, isClaudeConfigured, type ImageInput } from './claude.js';
import type { SleepScoreBreakdown } from '../types/app.js';
import type { NightSummary } from './sleep-scorer.js';

// In-memory cache: key = "babyUid:nightStart" -> insights
const cache = new Map<string, { insights: NightInsights; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour for completed nights
const CACHE_TTL_IN_PROGRESS = 1000 * 60 * 5; // 5 minutes for in-progress nights

export interface VideoAnalysis {
  stillness_score: number; // 1-5, where 5 = very still (restful), 1 = very restless
  stillness_description: string;
  positions_observed: string[]; // e.g. ["on back", "side-right"]
  dominant_position: string; // e.g. "on back"
  position_changes: number; // count of position changes visible across thumbnails
  environment_observations: string[]; // lighting, room setup, sleep sack, etc.
  safety_alerts: string[]; // any concerning observations
  observations: string[]; // general free-form observations
}

export interface NightInsights {
  summary: string;
  keyFactors: {
    positive: string[];
    negative: string[];
  };
  comparison: string;
  patterns: string[];
  tip: string;
  video_analysis?: VideoAnalysis; // structured video insights
  video_observations?: string[]; // DEPRECATED - kept for backward compat, superseded by video_analysis.observations
}

// ---- Structured output schemas ------------------------------------------------

const VideoAnalysisSchema = z.object({
  stillness_score: z.number().int().min(1).max(5).describe('1-5, where 5 = very still and peaceful, 1 = very restless/active'),
  stillness_description: z.string().describe('One sentence describing how restful or restless the baby appeared'),
  positions_observed: z.array(z.string()).describe('Distinct sleep positions seen across the images, e.g. "on back", "side-left"'),
  dominant_position: z.string().describe('The position seen most frequently'),
  position_changes: z.number().int().min(0).describe('Count of visible transitions between positions across consecutive images'),
  environment_observations: z.array(z.string()).describe('2-3 specific observations about the sleep environment'),
  safety_alerts: z.array(z.string()).describe('Any safety concerns; empty if none'),
  observations: z.array(z.string()).describe('2-3 specific observations from the images that correlate with the sleep data'),
});

const BaseInsightsSchema = z.object({
  summary: z.string().describe('2-3 warm sentences for a parent, referencing specific times and durations'),
  keyFactors: z.object({
    positive: z.array(z.string()).describe('1-3 things that went well, with specific numbers'),
    negative: z.array(z.string()).describe('1-3 things that hurt the score, with specific times/durations'),
  }),
  comparison: z.string().describe('1-2 sentences comparing to recent nights; call out best/worst and what differs'),
  patterns: z.array(z.string()).describe('1-3 patterns across recent nights (bedtime consistency, wake patterns, trends)'),
  tip: z.string().describe('One specific, actionable suggestion appropriate for this adjusted age'),
});

const InsightsWithVideoSchema = BaseInsightsSchema.extend({
  video_analysis: VideoAnalysisSchema,
});

// ---- Input types ------------------------------------------------------------

interface NightData {
  date: string;
  score: SleepScoreBreakdown;
  night: NightSummary;
}

export interface EventWithMedia {
  uid: string;
  key: string;
  title: string;
  time: number;
  thumbnail_url?: string;
}

// tzOffset = minutes from UTC as returned by getTimezoneOffset() (e.g. 420 for PDT)
let _tzOffset = 0;

function formatTime(isoOrUnix: string | number): string {
  const utcMs = typeof isoOrUnix === 'number' ? isoOrUnix * 1000 : new Date(isoOrUnix).getTime();
  const localMs = utcMs - _tzOffset * 60 * 1000;
  const d = new Date(localMs);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m} ${ampm}`;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const SYSTEM_PROMPT = `You are a pediatric sleep analyst inside a baby-monitor analytics app. Parents read your output directly on a dashboard card, so write warmly, concretely, and briefly. Always reference the specific times, durations, and counts you are given rather than generalities. Never invent data that is not in the input.`;

function buildPrompt(
  currentNight: NightData,
  recentNights: NightData[],
  adjustedAgeMonths: number,
  prematureWeeks: number,
  hasVideo: boolean,
  eventContext: EventWithMedia[],
  isInProgress: boolean = false,
): string {
  const cn = currentNight.score;
  const cd = cn.details;

  const gapDescriptions = currentNight.night.gaps.map((g, i) => {
    const dur = Math.round(g.duration_minutes);
    return `  Wake #${i + 1}: ${formatTime(g.start)}, lasted ${dur} minutes`;
  }).join('\n');

  const recentSummary = recentNights.map(n => {
    const d = n.score.details;
    return `  ${n.date}: Score ${n.score.total_score}, ${formatDuration(d.total_sleep_minutes)} sleep, ${d.wake_count} wakes, bedtime ${formatTime(d.bedtime)}, longest stretch ${formatDuration(d.longest_stretch_minutes)}`;
  }).join('\n');

  const nightLabel = isInProgress ? 'TONIGHT (IN PROGRESS)' : `LAST NIGHT (${currentNight.date})`;
  const inProgressNote = isInProgress
    ? `\nIMPORTANT: This night is STILL IN PROGRESS — the baby is currently sleeping. Write ENTIRELY in present/ongoing tense ("so far", "is currently sleeping", "has logged"). Do NOT use past tense or summarize as if the night is over. The "tip" field should be an observation about how the night is progressing, not advice that implies the night has ended.\n`
    : '';

  return `Analyze this baby's sleep data and provide insights.
${inProgressNote}
BABY PROFILE:
- Adjusted age: ${Math.round(adjustedAgeMonths * 10) / 10} months${prematureWeeks > 0 ? ` (born ${prematureWeeks} weeks premature)` : ''}

${nightLabel}:
- Sleep Score${isInProgress ? ' so far' : ''}: ${cn.total_score}/100
  - Duration: ${cn.duration_score}/35 (${formatDuration(cd.total_sleep_minutes)}${isInProgress ? ' so far' : ''}, ${formatDuration(cd.target_sleep_minutes)} target)
  - Continuity: ${cn.continuity_score}/35 (${cd.wake_count} wakes${isInProgress ? ' so far' : ''})
  - Longest Stretch: ${cn.onset_score}/15 (${formatDuration(cd.longest_stretch_minutes)})
  - Timing: ${cn.timing_score}/15 (bedtime ${formatTime(cd.bedtime)})
- Bedtime: ${formatTime(cd.bedtime)}${!isInProgress ? `\n- Wake time: ${formatTime(cd.wake_time)}` : ''}
- ${currentNight.night.sleep_segments.length} sleep segments${isInProgress ? ' so far' : ''}
- Wake details:
${gapDescriptions || '  No wakes recorded'}

RECENT NIGHTS (for comparison):
${recentSummary || '  No recent data available'}
${hasVideo ? `
VIDEO CONTEXT:
The ${eventContext.length} images above are camera thumbnails from key events during this night, in chronological order, each labeled with its event type and time. Study them carefully and fill in the video_analysis fields:
1. STILLNESS — How still/restful does the baby appear across these images?
2. POSITION — Identify sleep positions visible and count visible position changes between consecutive images.
3. ENVIRONMENT — Lighting, sleep sack/swaddle use, objects near baby, room setup.
4. SAFETY — Flag ANY concerns: loose blankets, toys in crib, unsafe positions, face covered, etc.
` : ''}`;
}

/**
 * Download a thumbnail URL and return as base64 with mime type.
 * Returns null if download fails (so we can skip that image).
 */
async function downloadThumbnail(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    // Skip if too large (>5MB per image)
    if (buffer.byteLength > 5 * 1024 * 1024) return null;
    const mimeType = response.headers.get('content-type') || 'image/png';
    return {
      mimeType,
      data: Buffer.from(buffer).toString('base64'),
    };
  } catch {
    return null;
  }
}

export async function generateNightInsights(
  currentNight: NightData,
  recentNights: NightData[],
  adjustedAgeMonths: number,
  prematureWeeks: number,
  tzOffset: number = 0,
  eventContext: EventWithMedia[] = [],
  isInProgress: boolean = false,
): Promise<NightInsights> {
  _tzOffset = tzOffset;

  // Check in-memory cache (shorter TTL for in-progress nights)
  const cacheKey = `${currentNight.date}:${currentNight.night.night_start}:v${eventContext.length}${isInProgress ? ':live' : ''}`;
  const ttl = isInProgress ? CACHE_TTL_IN_PROGRESS : CACHE_TTL;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.insights;
  }

  if (!isClaudeConfigured()) {
    return {
      summary: 'AI insights require an Anthropic API key on the server.',
      keyFactors: { positive: [], negative: [] },
      comparison: '',
      patterns: [],
      tip: '',
    };
  }

  // Download thumbnails for events (up to 6 to keep request size manageable)
  const eventsWithThumbnails = eventContext.filter(e => e.thumbnail_url).slice(0, 6);
  console.log(`[insights] Downloading ${eventsWithThumbnails.length} event thumbnails for video context`);

  const thumbnails = await Promise.all(
    eventsWithThumbnails.map(e => downloadThumbnail(e.thumbnail_url!))
  );

  const images: ImageInput[] = [];
  const validEvents: EventWithMedia[] = [];
  thumbnails.forEach((t, i) => {
    if (!t) return;
    const e = eventsWithThumbnails[i];
    validEvents.push(e);
    images.push({ ...t, label: `Image ${validEvents.length}: ${e.key} at ${formatTime(e.time)} - "${e.title}"` });
  });

  const hasVideo = images.length > 0;
  const prompt = buildPrompt(currentNight, recentNights, adjustedAgeMonths, prematureWeeks, hasVideo, validEvents, isInProgress);

  let insights: NightInsights;
  try {
    insights = hasVideo
      ? await generateStructured({ label: 'insights', schema: InsightsWithVideoSchema, system: SYSTEM_PROMPT, prompt, images })
      : await generateStructured({ label: 'insights', schema: BaseInsightsSchema, system: SYSTEM_PROMPT, prompt });
  } catch (err: any) {
    console.error('[insights] Claude request failed:', err.message);
    throw err;
  }

  cache.set(cacheKey, { insights, timestamp: Date.now() });
  return insights;
}
