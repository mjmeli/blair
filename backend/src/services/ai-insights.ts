import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import type { SleepScoreBreakdown } from '../types/app.js';
import type { NightSummary } from './sleep-scorer.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

// In-memory cache: key = "babyUid:nightStart" -> insights
const cache = new Map<string, { insights: NightInsights; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour for completed nights
const CACHE_TTL_IN_PROGRESS = 1000 * 60 * 5; // 5 minutes for in-progress nights

export interface NightInsights {
  summary: string;
  keyFactors: {
    positive: string[];
    negative: string[];
  };
  comparison: string;
  patterns: string[];
  tip: string;
  video_observations?: string[]; // New: insights derived from video analysis
}

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

  const eventList = eventContext.length > 0
    ? eventContext.map((e, i) => `  Image ${i + 1}: ${e.key} at ${formatTime(e.time)} - "${e.title}"`).join('\n')
    : '';

  const nightLabel = isInProgress ? 'TONIGHT (IN PROGRESS)' : `LAST NIGHT (${currentNight.date})`;
  const inProgressNote = isInProgress
    ? `\nIMPORTANT: This night is STILL IN PROGRESS — the baby is currently sleeping. Write ENTIRELY in present/ongoing tense. Use language like "so far", "is currently sleeping", "has logged", "the night is going well". Do NOT use past tense (e.g. avoid "had", "woke up", "the night was"). Do NOT summarize as if the night is over. Do NOT include a "tip" that implies the night has ended.\n`
    : '';

  return `You are a pediatric sleep analyst for a baby tracking app. Analyze this baby's sleep data and provide insights.
${inProgressNote}
BABY PROFILE:
- Adjusted age: ${Math.round(adjustedAgeMonths * 10) / 10} months${prematureWeeks > 0 ? ` (born ${prematureWeeks} weeks premature)` : ''}

${nightLabel}:
- Sleep Score so far: ${cn.total_score}/100
  - Duration: ${cn.duration_score}/35 (${formatDuration(cd.total_sleep_minutes)} so far, ${formatDuration(cd.target_sleep_minutes)} target)
  - Continuity: ${cn.continuity_score}/35 (${cd.wake_count} wakes so far)
  - Longest Stretch: ${cn.onset_score}/15 (${formatDuration(cd.longest_stretch_minutes)})
  - Timing: ${cn.timing_score}/15 (bedtime ${formatTime(cd.bedtime)})
- Bedtime: ${formatTime(cd.bedtime)}${!isInProgress ? `\n- Wake time: ${formatTime(cd.wake_time)}` : ''}
- ${currentNight.night.sleep_segments.length} sleep segments so far
- Wake details:
${gapDescriptions || '  No wakes recorded'}

RECENT NIGHTS (for comparison):
${recentSummary || '  No recent data available'}

${hasVideo ? `VIDEO CONTEXT:
I'm providing thumbnail images from key events during this night. Study them to observe:
- Baby's sleep position changes
- Room lighting/environment
- Signs of crying, discomfort, or restlessness
- Any safety concerns (position, coverings, objects near baby)

${eventList}
` : ''}

Respond with ONLY valid JSON (no markdown, no code fences) in this exact format:
{
  "summary": "${isInProgress ? '2-3 sentence warm in-progress update for a parent using present tense. Reference specific times and durations so far.' : '2-3 sentence warm summary for a parent. Reference specific times and durations.'}",
  "keyFactors": {
    "positive": ["1-3 things that ${isInProgress ? 'are going well so far' : 'went well'} with specific numbers"],
    "negative": ["1-3 things that ${isInProgress ? 'are hurting the score so far' : 'hurt the score'} with specific times/durations"]
  },
  "comparison": "1-2 sentences comparing to recent nights. Call out best/worst and explain what is different.",
  "patterns": ["1-3 patterns across recent nights (bedtime consistency, wake patterns, trends)"],
  "tip": "${isInProgress ? 'One observation or note about how the night is progressing.' : 'One specific, actionable suggestion for this adjusted age.'}",
  "video_observations": ${hasVideo ? '["1-3 specific observations from the video thumbnails about position, environment, or visible behaviors that correlate with the sleep data"]' : '[]'}
}`;
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

  if (!config.gemini.apiKey) {
    return {
      summary: 'AI insights require a Gemini API key.',
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

  const validThumbnails = thumbnails.filter(t => t !== null) as { mimeType: string; data: string }[];
  const validEvents = eventsWithThumbnails.filter((_, i) => thumbnails[i] !== null);

  const hasVideo = validThumbnails.length > 0;
  const prompt = buildPrompt(currentNight, recentNights, adjustedAgeMonths, prematureWeeks, hasVideo, validEvents, isInProgress);

  console.log(`[insights] Calling Gemini with ${validThumbnails.length} images`);

  const model = genAI.getGenerativeModel({
    model: config.gemini.model,
    generationConfig: {
      maxOutputTokens: 4096, // Prevent truncation of the JSON response
      responseMimeType: 'application/json',
    },
  });

  const parts: any[] = [prompt];
  for (const thumb of validThumbnails) {
    parts.push({ inlineData: { mimeType: thumb.mimeType, data: thumb.data } });
  }

  const result = await model.generateContent(parts);
  let text = result.response.text();

  // Strip markdown code fences if present (shouldn't be with responseMimeType=json, but defensive)
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // If the response has leading/trailing non-JSON chars, extract the JSON object
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace > 0 || lastBrace < text.length - 1) {
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    }
  }

  let insights: NightInsights;
  try {
    insights = JSON.parse(text);
  } catch (err) {
    console.error('[insights] Failed to parse Gemini response (first 500 chars):', text.slice(0, 500));
    console.error('[insights] Response length:', text.length);
    // Provide a meaningful fallback instead of leaking JSON to the UI
    insights = {
      summary: 'Unable to generate full insights for this night. Please try refreshing.',
      keyFactors: { positive: [], negative: [] },
      comparison: '',
      patterns: [],
      tip: '',
    };
  }

  cache.set(cacheKey, { insights, timestamp: Date.now() });
  return insights;
}
