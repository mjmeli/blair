import { createHash } from 'crypto';
import { z } from 'zod';
import { generateStructured, isAiConfigured, missingAiApiKey, type ImageInput } from './ai.js';
import type { SleepScoreBreakdown } from '../types/app.js';
import type { NightSummary } from './sleep-scorer.js';
import type { WakeDetail } from './night-activity.js';

// In-memory cache keyed by a hash of the exact prompt (data + profile + image labels),
// so any change to the inputs is a miss. `force` bypasses it entirely.
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
    negative: z.array(z.string()).describe('1-3 things that hurt the score, with specific times/durations. A self-settled wake is not a parenting issue; describe it as lost sleep at most.'),
  }),
  comparison: z.string().describe('1-2 sentences comparing to recent nights; call out best/worst and what differs'),
  patterns: z.array(z.string()).describe('1-3 patterns across recent nights (bedtime consistency, wake patterns, trends)'),
  tip: z.string().describe('One specific, actionable suggestion appropriate for this adjusted age. Base it on what actually happened: if no parent visited a wake, do not suggest pausing or waiting before responding to it.'),
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
function formatTime(isoOrUnix: string | number, tzOffset: number): string {
  const utcMs = typeof isoOrUnix === 'number' ? isoOrUnix * 1000 : new Date(isoOrUnix).getTime();
  const localMs = utcMs - tzOffset * 60 * 1000;
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

const SYSTEM_PROMPT = `You are a pediatric sleep analyst inside a baby-monitor analytics app. Parents read your output directly on a dashboard card, so write warmly, concretely, and briefly. Always reference the specific times, durations, and counts you are given rather than generalities. Never invent data that is not in the input.

Each night wake is labeled with how it ended, from the camera's parent-detection (or the parent's own correction):
- SELF-SETTLED: no parent came to the crib. The baby resettled on their own. Treat this as a skill to praise, even when the wake was long. Never advise the parent to wait, pause, or delay before responding to a self-settled wake, and never imply they responded. If a self-settled wake was long, look for causes in the schedule (daytime naps, wake window before bed, bedtime, early-night overtiredness, developmental leaps) rather than in the parent's response.
- PARENT VISIT / TAKEN OUT: a parent went in. Only for these may you comment on how the parent responded.
- UNKNOWN: the camera has no visit data for this wake. Do not assume either way.
A "check-in" is a parent visit while the baby was asleep (e.g. a peek before the parents' own bedtime); it is not a response to a wake. Mention one only if a wake started within a few minutes after it.`;

const RESPONSE_LABEL: Record<WakeDetail['response'], string> = {
  self_settled: 'SELF-SETTLED (no parent visit)',
  parent_visit: 'PARENT VISIT',
  taken_out: 'TAKEN OUT by parent',
  unknown: 'UNKNOWN (no camera visit data)',
};

/** One line per wake with how it ended; shared with the night comparison prompt. */
export function describeWakes(wakes: WakeDetail[], fmt: (t: number) => string): string {
  return wakes.map((w, i) => {
    const by = w.source === 'parent' ? ', confirmed by parent' : '';
    const visits = w.response !== 'self_settled' && w.visit_times.length ? `; parent at crib ${w.visit_times.map(fmt).join(', ')}` : '';
    return `  Wake #${i + 1}: ${fmt(w.start)}, lasted ${Math.round(w.duration_minutes)} minutes, ${RESPONSE_LABEL[w.response]}${by}${visits}`;
  }).join('\n');
}

function buildPrompt(
  currentNight: NightData,
  recentNights: NightData[],
  adjustedAgeMonths: number,
  prematureWeeks: number,
  hasVideo: boolean,
  eventContext: EventWithMedia[],
  isInProgress: boolean,
  tzOffset: number,
  profileBlock: string,
  dayBlock: string,
): string {
  const fmt = (t: string | number) => formatTime(t, tzOffset);
  const cn = currentNight.score;
  const cd = cn.details;
  const cx = cn.expectations;

  const wakes = cd.wakes ?? [];
  const gapDescriptions = describeWakes(wakes, fmt);
  const checkIns = (cd.check_ins ?? []).map(c =>
    `  ${fmt(c.time)}${c.wake_within_minutes !== undefined ? ` (a wake started ${c.wake_within_minutes} min later)` : ''}`,
  ).join('\n');

  const recentSummary = recentNights.map(n => {
    const d = n.score.details;
    const x = n.score.expectations;
    const settled = d.wake_count > 0 && x.self_settled_wakes !== undefined
      ? ` (${x.self_settled_wakes} self-settled, ${x.parent_visit_wakes} with a parent visit${x.unknown_wakes ? `, ${x.unknown_wakes} unknown` : ''})`
      : '';
    return `  ${n.date}: Score ${n.score.total_score}, ${formatDuration(d.total_sleep_minutes)} sleep, ${d.wake_count} wakes${settled}, bedtime ${fmt(d.bedtime)}, longest stretch ${formatDuration(d.longest_stretch_minutes)}`;
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
  - Continuity: ${cn.continuity_score}/35 (${cd.wake_count} wakes${isInProgress ? ' so far' : ''}; ${cx.self_settled_wakes ?? 0} self-settled, which never count as extra wakes)
  - Longest Stretch: ${cn.onset_score}/15 (${formatDuration(cd.longest_stretch_minutes)}; self-settled stirs of ${cx.brief_wake_minutes ?? 5} min or less don't break a stretch)
  - Timing: ${cn.timing_score}/15 (bedtime ${fmt(cd.bedtime)})
- Bedtime: ${fmt(cd.bedtime)}${!isInProgress ? `\n- Wake time: ${fmt(cd.wake_time)}` : ''}
- ${currentNight.night.sleep_segments.length} sleep segments${isInProgress ? ' so far' : ''}
- Wake details:
${gapDescriptions || '  No wakes recorded'}
- Parent check-ins while asleep:
${checkIns || '  None'}

${dayBlock}

RECENT NIGHTS (for comparison):
${recentSummary || '  No recent data available'}

${profileBlock}
${hasVideo ? `
VIDEO CONTEXT:
The ${eventContext.length} images above are camera thumbnails from key events during this night, in chronological order, each labeled with its event type and time. Study them carefully and fill in the video_analysis fields:
1. STILLNESS — How still/restful does the baby appear across these images?
2. POSITION — Identify sleep positions visible and count visible position changes between consecutive images.
3. ENVIRONMENT — Lighting, sleep sack/swaddle use, objects near baby, room setup.
4. SAFETY — Flag genuine concerns: loose blankets, toys in crib, face covered, etc. Judge sleep position against the parent-provided rolling context above, not generic rules.
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
  profileBlock: string = '',
  force: boolean = false,
  dayBlock: string = '',
): Promise<NightInsights> {

  if (!isAiConfigured()) {
    return {
      summary: `AI insights require ${missingAiApiKey()} on the server.`,
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
    images.push({ ...t, label: `Image ${validEvents.length}: ${e.key} at ${formatTime(e.time, tzOffset)} - "${e.title}"` });
  });

  const hasVideo = images.length > 0;
  const prompt = buildPrompt(currentNight, recentNights, adjustedAgeMonths, prematureWeeks, hasVideo, validEvents, isInProgress, tzOffset, profileBlock, dayBlock);

  // In-memory cache (shorter TTL for in-progress nights); skipped on force
  const cacheKey = createHash('sha1').update(prompt + images.map(i => i.label).join('|')).digest('hex');
  if (!force) {
    const ttl = isInProgress ? CACHE_TTL_IN_PROGRESS : CACHE_TTL;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.insights;
    }
  }

  let insights: NightInsights;
  try {
    insights = hasVideo
      ? await generateStructured({ label: 'insights', schema: InsightsWithVideoSchema, system: SYSTEM_PROMPT, prompt, images })
      : await generateStructured({ label: 'insights', schema: BaseInsightsSchema, system: SYSTEM_PROMPT, prompt });
  } catch (err: any) {
    console.error('[insights] AI provider request failed:', err.message);
    throw err;
  }

  cache.set(cacheKey, { insights, timestamp: Date.now() });
  return insights;
}
