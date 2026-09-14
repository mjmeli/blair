import { z } from 'zod';
import { generateStructured, isClaudeConfigured, type ImageInput } from './claude.js';

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

const PatternsSchema = z.object({
  summary: z.string().describe('2-3 sentence overview of what you observe across these nights'),
  patterns: z.array(z.object({
    title: z.string().describe('Short pattern name'),
    observation: z.string().describe('What you noticed'),
    evidence: z.array(z.string()).describe('Specific dates or image numbers supporting this'),
  })),
  correlations: z.array(z.object({
    factor: z.string().describe('The factor, e.g. "late bedtime", "bright room"'),
    impact: z.string().describe('How it affects sleep'),
    nights_affected: z.number().int().min(0),
  })),
  environmental_trends: z.array(z.string()).describe('Observations about room, lighting, setup across nights'),
  behavioral_trends: z.array(z.string()).describe("Observations about the baby's behavior, position, movement patterns"),
  recommendations: z.array(z.string()).describe('2-3 specific actionable recommendations based on what you observed'),
});

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
 * Picks 1-2 representative thumbnails per night, capped at 12 images total.
 */
export async function analyzeLongTermPatterns(
  nights: NightWithEvents[],
  adjustedAgeMonths: number,
  tzOffset: number,
): Promise<VideoPatternsResult> {
  if (!isClaudeConfigured()) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  // For each night, pick 1-2 representative events (prefer PUT_TO_SLEEP or WOKE_UP)
  const selectedEvents: Array<{ night: NightWithEvents; event: NightWithEvents['events'][number] }> = [];
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
    cappedEvents.map(({ event }) => downloadImage(event.thumbnail_url!))
  );

  const validPairs = cappedEvents
    .map((ce, i) => ({ ...ce, image: imageData[i] }))
    .filter((x): x is typeof x & { image: { mimeType: string; data: string } } => x.image !== null);

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

  const images: ImageInput[] = validPairs.map((p, i) => ({
    mimeType: p.image.mimeType,
    data: p.image.data,
    label: `Image ${i + 1}: ${p.night.date} - ${p.event.key} at ${formatTime(p.event.time)} - "${p.event.title}"`,
  }));

  const nightsSummary = nights.map(n => {
    const imagesForNight = validPairs.filter(p => p.night.date === n.date).length;
    return `  ${n.date}: Score ${n.score}, ${Math.floor(n.total_sleep_minutes / 60)}h${n.total_sleep_minutes % 60}m sleep, ${n.wake_count} wakes, longest ${Math.floor(n.longest_stretch_minutes / 60)}h stretch (${imagesForNight} images attached)`;
  }).join('\n');

  const prompt = `Analyze multiple nights of baby monitor data to identify long-term patterns.

BABY AGE: ${Math.round(adjustedAgeMonths * 10) / 10} months (adjusted)

NIGHTS (${nights.length} total, sorted oldest to newest):
${nightsSummary}

VIDEO EVIDENCE:
The ${images.length} camera thumbnails above are each labeled with their night date, event type, and time. Study them for:
- Sleep position changes across nights
- Room environment differences (lighting, clutter, safety)
- Baby's development/growth
- Visible signs of discomfort or wellness
- Anything that correlates with good vs. bad sleep nights

When citing evidence, reference night dates or image numbers.`;

  return generateStructured({
    label: 'patterns',
    schema: PatternsSchema,
    system: 'You are a pediatric sleep specialist analyzing several nights of baby-monitor data and images to find durable patterns a parent can act on. Be specific and cite the dates and images that support each claim.',
    prompt,
    images,
  });
}
