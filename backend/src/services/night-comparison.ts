import { z } from 'zod';
import { generateStructured, isAiConfigured, missingAiApiKey, type ImageInput } from './ai.js';
import type { SleepScoreBreakdown } from '../types/app.js';
import type { NightSummary } from './sleep-scorer.js';

export interface NightComparisonResult {
  summary: string; // 2-3 sentences explaining the main difference
  score_difference: number; // A - B
  winner: 'a' | 'b' | 'tie';
  key_differences: Array<{
    metric: string;
    night_a: string;
    night_b: string;
    impact: string;
  }>;
  what_drove_difference: string; // paragraph on root cause
  recommendation: string; // 1 sentence actionable takeaway
}

const ComparisonSchema = z.object({
  summary: z.string().describe('2-3 warm, plain-English sentences explaining the main difference between the two nights'),
  key_differences: z.array(z.object({
    metric: z.string().describe('The metric, e.g. "Bedtime"'),
    night_a: z.string().describe("Night A's value"),
    night_b: z.string().describe("Night B's value"),
    impact: z.string().describe('How this difference affected sleep'),
  })).describe('The 2-5 differences that mattered most'),
  what_drove_difference: z.string().describe('A paragraph explaining the likely root cause, referencing specific data points and video evidence if available'),
  recommendation: z.string().describe('One concrete, actionable takeaway the parent can try on future nights'),
});

interface CompareInput {
  date: string;
  score: SleepScoreBreakdown;
  night: NightSummary;
  thumbnailDataUrls: Array<{ mimeType: string; data: string; event_type: string; time: number }>;
}

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

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function nightBlock(label: string, night: CompareInput, tzOffset: number): string {
  const fmt = (t: string | number) => formatTime(t, tzOffset);
  const cn = night.score;
  const cd = cn.details;
  const gaps = night.night.gaps.map((g, i) => `  Wake #${i + 1}: ${fmt(g.start)}, ${Math.round(g.duration_minutes)} min`).join('\n');
  return `${label} (${night.date}):
- Score: ${cn.total_score}/100 (duration ${cn.duration_score}/35, continuity ${cn.continuity_score}/35, stretch ${cn.onset_score}/15, timing ${cn.timing_score}/15)
- Total sleep: ${formatDuration(cd.total_sleep_minutes)} (target ${formatDuration(cd.target_sleep_minutes)})
- Bedtime: ${fmt(cd.bedtime)}, wake: ${fmt(cd.wake_time)}
- Longest stretch: ${formatDuration(cd.longest_stretch_minutes)}
- Wake count: ${cd.wake_count}
- Segments: ${night.night.sleep_segments.length}
- Wake timeline:
${gaps || '  No wakes recorded'}
- Camera images attached for ${label}: ${night.thumbnailDataUrls.length}`;
}

export async function compareNights(
  nightA: CompareInput,
  nightB: CompareInput,
  adjustedAgeMonths: number,
  tzOffset: number,
  profileBlock: string = '',
): Promise<NightComparisonResult> {
  if (!isAiConfigured()) throw new Error(`${missingAiApiKey()} is not configured`);
  const images: ImageInput[] = [
    ...nightA.thumbnailDataUrls.map((t, i) => ({ mimeType: t.mimeType, data: t.data, label: `Night A image ${i + 1}: ${t.event_type} at ${formatTime(t.time, tzOffset)}` })),
    ...nightB.thumbnailDataUrls.map((t, i) => ({ mimeType: t.mimeType, data: t.data, label: `Night B image ${i + 1}: ${t.event_type} at ${formatTime(t.time, tzOffset)}` })),
  ];

  const scoreDiff = nightA.score.total_score - nightB.score.total_score;
  const winner: NightComparisonResult['winner'] = scoreDiff > 0 ? 'a' : scoreDiff < 0 ? 'b' : 'tie';

  const prompt = `Compare these two specific nights for a ${Math.round(adjustedAgeMonths * 10) / 10}-month-old (adjusted age) baby. Identify what drove the difference in sleep quality and give one actionable takeaway.

${nightBlock('NIGHT A', nightA, tzOffset)}

${nightBlock('NIGHT B', nightB, tzOffset)}

${profileBlock}

Night A scored ${scoreDiff > 0 ? `${scoreDiff} points higher` : scoreDiff < 0 ? `${-scoreDiff} points lower` : 'the same'} as Night B.
${images.length > 0 ? `
VIDEO CONTEXT:
The camera thumbnails above are labeled by night (A or B) and time. Look for differences in sleep position/restlessness, room environment (lighting, setup), visible signs of discomfort or wellness, and any safety differences (judged against the parent-provided context). Use this visual evidence when explaining the difference.` : ''}`;

  const result = await generateStructured({
    label: 'compare',
    schema: ComparisonSchema,
    system: 'You are a pediatric sleep analyst helping a parent understand why two nights of their baby\'s sleep differed. Be specific, warm, and concrete; reference the actual numbers and times provided.',
    prompt,
    images,
  });

  return { ...result, score_difference: scoreDiff, winner };
}
