import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

export interface NightWithEvents {
  date: string;
  score: number;
  total_sleep_minutes: number;
  wake_count: number;
  longest_stretch_minutes: number;
  events: { key: string; title: string; time: number; thumbnail_url?: string }[];
}

export interface VideoPatternsResult {
  patterns: Array<{ title: string; observation: string; evidence: string[] }>;
  correlations: Array<{ factor: string; impact: string; nights_affected: number }>;
  environmental_trends: string[];
  behavioral_trends: string[];
  recommendations: string[];
  summary: string;
}

async function downloadImage(url: string, maxBytes: number = 3 * 1024 * 1024): Promise<{ mimeType: string; data: string } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    if (buf.byteLength > maxBytes) return null;
    return {
      mimeType: r.headers.get('content-type') || 'image/png',
      data: Buffer.from(buf).toString('base64'),
    };
  } catch {
    return null;
  }
}

/**
 * Analyze multiple nights of video events to find long-term patterns.
 * Picks 1-2 representative thumbnails per night to stay under Gemini's context limits.
 */
export async function analyzeLongTermPatterns(
  nights: NightWithEvents[],
  adjustedAgeMonths: number,
  tzOffset: number,
): Promise<VideoPatternsResult> {
  if (!config.gemini.apiKey) {
    throw new Error('Gemini API key not configured');
  }

  // For each night, pick 1-2 representative events (prefer PUT_TO_SLEEP or WOKE_UP)
  const selectedEvents: Array<{ night: NightWithEvents; event: any }> = [];
  const sortOrder = ['PUT_TO_SLEEP', 'FELL_ASLEEP', 'WOKE_UP', 'MOTION', 'SOUND'];

  for (const night of nights) {
    if (night.events.length === 0) continue;
    const withThumbs = night.events.filter(e => e.thumbnail_url);
    if (withThumbs.length === 0) continue;
    withThumbs.sort((a, b) => sortOrder.indexOf(a.key) - sortOrder.indexOf(b.key));
    // Pick first and one from middle of night if available
    selectedEvents.push({ night, event: withThumbs[0] });
    if (withThumbs.length > 2) {
      selectedEvents.push({ night, event: withThumbs[Math.floor(withThumbs.length / 2)] });
    }
  }

  // Cap at 12 images total to keep request size reasonable
  const cappedEvents = selectedEvents.slice(0, 12);

  console.log(`[patterns] Downloading ${cappedEvents.length} thumbnails from ${nights.length} nights`);

  const imageData = await Promise.all(
    cappedEvents.map(async ({ event }) => await downloadImage(event.event?.thumbnail_url || event.thumbnail_url))
  );

  const validPairs = cappedEvents
    .map((ce, i) => ({ ...ce, image: imageData[i] }))
    .filter(x => x.image !== null);

  console.log(`[patterns] Got ${validPairs.length} valid images`);

  function formatTime(unix: number): string {
    const localMs = unix * 1000 - tzOffset * 60 * 1000;
    const d = new Date(localMs);
    const h = d.getUTCHours();
    const m = d.getUTCMinutes().toString().padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m} ${ampm}`;
  }

  const nightsSummary = nights.map(n => {
    const imagesForNight = validPairs.filter(p => p.night.date === n.date).length;
    return `  ${n.date}: Score ${n.score}, ${Math.floor(n.total_sleep_minutes / 60)}h${n.total_sleep_minutes % 60}m sleep, ${n.wake_count} wakes, longest ${Math.floor(n.longest_stretch_minutes / 60)}h stretch (${imagesForNight} images attached)`;
  }).join('\n');

  const imageLabels = validPairs.map((p, i) =>
    `  Image ${i + 1}: ${p.night.date} - ${p.event.key} at ${formatTime(p.event.time)} - "${p.event.title}"`
  ).join('\n');

  const prompt = `You are a pediatric sleep specialist analyzing multiple nights of baby monitor data to identify long-term patterns.

BABY AGE: ${Math.round(adjustedAgeMonths * 10) / 10} months (adjusted)

NIGHTS (${nights.length} total, sorted oldest to newest):
${nightsSummary}

VIDEO EVIDENCE:
I'm providing ${validPairs.length} thumbnail images from these nights. Study them carefully and look for:
- Sleep position changes across nights
- Room environment differences (lighting, clutter, safety)
- Baby's development/growth
- Visible signs of discomfort or wellness
- Anything that correlates with good vs. bad sleep nights

Image labels (match to night dates):
${imageLabels}

Respond with ONLY valid JSON (no markdown):
{
  "summary": "2-3 sentence overview of what you observe across these nights",
  "patterns": [
    {
      "title": "Short pattern name",
      "observation": "What you noticed",
      "evidence": ["Specific dates or images supporting this"]
    }
  ],
  "correlations": [
    {
      "factor": "What factor (e.g. 'late bedtime', 'bright room')",
      "impact": "How it affects sleep",
      "nights_affected": number
    }
  ],
  "environmental_trends": ["Observations about room, lighting, setup across nights"],
  "behavioral_trends": ["Observations about baby's behavior, position, movement patterns"],
  "recommendations": ["2-3 specific actionable recommendations based on what you observed"]
}`;

  const model = genAI.getGenerativeModel({
    model: config.gemini.model,
    generationConfig: {
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    },
  });

  const parts: any[] = [prompt];
  for (const p of validPairs) {
    if (p.image) parts.push({ inlineData: { mimeType: p.image.mimeType, data: p.image.data } });
  }

  console.log(`[patterns] Calling Gemini with ${parts.length - 1} images`);
  const result = await model.generateContent(parts);
  let text = result.response.text();
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('[patterns] Failed to parse Gemini response:', text.slice(0, 300));
    return {
      summary: 'Unable to generate pattern analysis. Please try again.',
      patterns: [],
      correlations: [],
      environmental_trends: [],
      behavioral_trends: [],
      recommendations: [],
    };
  }
}
