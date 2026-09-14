import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import type { SleepScoreBreakdown } from '../types/app.js';
import type { NightSummary } from './sleep-scorer.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

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

interface CompareInput {
  date: string;
  score: SleepScoreBreakdown;
  night: NightSummary;
  thumbnailDataUrls: Array<{ mimeType: string; data: string; event_type: string; time: number }>;
}

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

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function nightBlock(label: string, night: CompareInput, hasImages: boolean): string {
  const cn = night.score;
  const cd = cn.details;
  const gaps = night.night.gaps.map((g, i) => `  Wake #${i + 1}: ${formatTime(g.start)}, ${Math.round(g.duration_minutes)} min`).join('\n');
  const imgList = hasImages
    ? night.thumbnailDataUrls.map((t, i) => `  Image (${label}) ${i + 1}: ${t.event_type} at ${formatTime(t.time)}`).join('\n')
    : '';
  return `${label} (${night.date}):
- Score: ${cn.total_score}/100 (duration ${cn.duration_score}/35, continuity ${cn.continuity_score}/35, stretch ${cn.onset_score}/15, timing ${cn.timing_score}/15)
- Total sleep: ${formatDuration(cd.total_sleep_minutes)} (target ${formatDuration(cd.target_sleep_minutes)})
- Bedtime: ${formatTime(cd.bedtime)}, wake: ${formatTime(cd.wake_time)}
- Longest stretch: ${formatDuration(cd.longest_stretch_minutes)}
- Wake count: ${cd.wake_count}
- Segments: ${night.night.sleep_segments.length}
- Wake timeline:
${gaps || '  No wakes recorded'}
${imgList ? `- Video images for ${label}:\n${imgList}` : ''}`;
}

export async function compareNights(
  nightA: CompareInput,
  nightB: CompareInput,
  adjustedAgeMonths: number,
  tzOffset: number,
): Promise<NightComparisonResult> {
  if (!config.gemini.apiKey) throw new Error('Gemini API key not configured');
  _tzOffset = tzOffset;

  const hasImagesA = nightA.thumbnailDataUrls.length > 0;
  const hasImagesB = nightB.thumbnailDataUrls.length > 0;
  const hasAnyImages = hasImagesA || hasImagesB;

  const prompt = `You are a pediatric sleep analyst comparing two specific nights for a ${Math.round(adjustedAgeMonths * 10) / 10}-month-old (adjusted age) baby. Identify what drove the difference in sleep quality and provide an actionable takeaway.

${nightBlock('NIGHT A', nightA, hasImagesA)}

${nightBlock('NIGHT B', nightB, hasImagesB)}

${hasAnyImages ? `VIDEO CONTEXT:
I'm providing thumbnail images from both nights. Study them for differences in:
- Sleep position / restlessness
- Room environment (lighting, setup)
- Visible signs of discomfort or wellness
- Any safety differences

The images are labeled in the prompt above (A or B and time). Use this visual evidence when explaining the difference.
` : ''}

Respond with ONLY valid JSON (no markdown):
{
  "summary": "2-3 sentence warm plain-english explanation of the main difference between the two nights",
  "score_difference": ${nightA.score.total_score - nightB.score.total_score},
  "winner": "${nightA.score.total_score > nightB.score.total_score ? 'a' : nightA.score.total_score < nightB.score.total_score ? 'b' : 'tie'}",
  "key_differences": [
    { "metric": "What metric (e.g. 'Bedtime')", "night_a": "A's value", "night_b": "B's value", "impact": "How this difference affected sleep" }
  ],
  "what_drove_difference": "Paragraph explaining the likely root cause of the difference, referencing specific data points and video if available",
  "recommendation": "One concrete actionable takeaway the parent can try on future nights"
}`;

  const model = genAI.getGenerativeModel({
    model: config.gemini.model,
    generationConfig: { maxOutputTokens: 4096, responseMimeType: 'application/json' },
  });

  const parts: any[] = [prompt];
  for (const t of nightA.thumbnailDataUrls) parts.push({ inlineData: { mimeType: t.mimeType, data: t.data } });
  for (const t of nightB.thumbnailDataUrls) parts.push({ inlineData: { mimeType: t.mimeType, data: t.data } });

  const result = await model.generateContent(parts);
  let text = result.response.text();
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) text = text.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(text);
  } catch {
    return {
      summary: 'Unable to generate comparison.',
      score_difference: nightA.score.total_score - nightB.score.total_score,
      winner: 'tie',
      key_differences: [],
      what_drove_difference: '',
      recommendation: '',
    };
  }
}
