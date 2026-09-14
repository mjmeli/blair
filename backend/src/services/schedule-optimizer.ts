import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

export interface ScheduleRecommendation {
  recommended_bedtime: { start_hour: number; end_hour: number }; // 24h format
  recommended_wake: { start_hour: number; end_hour: number };
  confidence: 'low' | 'medium' | 'high';
  nights_analyzed: number;
  reasoning: string; // paragraph explaining why
  observed_patterns: string[]; // what correlations were found
  expected_impact: string; // what improvement the parent might see
  cautions: string[]; // caveats based on baby age
  current_vs_recommended: string; // how current settings compare
}

interface NightPoint {
  date: string;
  score: number;
  total_sleep_minutes: number;
  wake_count: number;
  longest_stretch_minutes: number;
  bedtime: string; // ISO
  wake_time: string; // ISO
}

function hourOf(iso: string, tzOffset: number): number {
  const d = new Date(new Date(iso).getTime() - tzOffset * 60 * 1000);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

export async function recommendSchedule(
  nights: NightPoint[],
  adjustedAgeMonths: number,
  currentBedtimeHour: number,
  currentWakeHour: number,
  tzOffset: number,
): Promise<ScheduleRecommendation> {
  if (!config.gemini.apiKey) throw new Error('Gemini API key not configured');

  if (nights.length < 5) {
    return {
      recommended_bedtime: { start_hour: currentBedtimeHour, end_hour: currentBedtimeHour + 1 },
      recommended_wake: { start_hour: currentWakeHour, end_hour: currentWakeHour + 1 },
      confidence: 'low',
      nights_analyzed: nights.length,
      reasoning: 'Not enough data to make a confident recommendation. Keep tracking for more nights.',
      observed_patterns: [],
      expected_impact: '',
      cautions: ['Need at least 5 nights of data for meaningful recommendations'],
      current_vs_recommended: '',
    };
  }

  // Build correlation data for Gemini
  const analysis = nights.map(n => ({
    date: n.date,
    score: n.score,
    bedtime_hour: Math.round(hourOf(n.bedtime, tzOffset) * 10) / 10,
    wake_hour: Math.round(hourOf(n.wake_time, tzOffset) * 10) / 10,
    sleep_hours: Math.round((n.total_sleep_minutes / 60) * 10) / 10,
    wakes: n.wake_count,
    longest_stretch_hours: Math.round((n.longest_stretch_minutes / 60) * 10) / 10,
  }));

  // Pre-compute basic correlations to give Gemini a head start
  const sorted = [...analysis].sort((a, b) => b.score - a.score);
  const top3 = sorted.slice(0, 3);
  const bottom3 = sorted.slice(-3);
  const avgBedtimeTop = top3.reduce((s, n) => s + n.bedtime_hour, 0) / top3.length;
  const avgBedtimeBottom = bottom3.reduce((s, n) => s + n.bedtime_hour, 0) / bottom3.length;

  const nightsTable = analysis
    .map(a => `  ${a.date}: score=${a.score}, bedtime=${a.bedtime_hour}h, wake=${a.wake_hour}h, sleep=${a.sleep_hours}h, wakes=${a.wakes}, longest=${a.longest_stretch_hours}h`)
    .join('\n');

  const prompt = `You are a pediatric sleep specialist recommending an optimal sleep schedule based on historical data. The baby is ${Math.round(adjustedAgeMonths * 10) / 10} months old (adjusted age).

Current settings:
- Expected bedtime: ${currentBedtimeHour}:00
- Expected wake: ${currentWakeHour}:00

Past ${nights.length} nights (bedtime/wake in local 24h decimal — e.g. 19.5 = 7:30 PM):
${nightsTable}

Quick stats for context:
- Top 3 nights (by score) averaged a bedtime of ${avgBedtimeTop.toFixed(1)}h
- Bottom 3 nights averaged a bedtime of ${avgBedtimeBottom.toFixed(1)}h

Analyze the data to find the bedtime and wake windows that correlate with the best sleep scores. Consider:
- Which bedtime ranges correlate with higher scores, longer stretches, fewer wakes
- Which bedtime ranges correlate with worse outcomes
- Age-appropriate expectations for this baby's developmental stage
- Circadian rhythm principles (consistency matters more than exact time)

Respond with ONLY a valid JSON object (no markdown, no code fences, no comments). Use integer hours in 24-hour format for start_hour and end_hour. Keep strings concise so the response fits in the token budget. Schema:
{
  "recommended_bedtime": { "start_hour": 19, "end_hour": 20 },
  "recommended_wake": { "start_hour": 7, "end_hour": 8 },
  "confidence": "low" | "medium" | "high",
  "reasoning": "1-3 sentences explaining the recommendation based on the data",
  "observed_patterns": ["2-3 brief patterns with specific numbers"],
  "expected_impact": "1 short sentence",
  "cautions": ["0-2 brief caveats"],
  "current_vs_recommended": "1 short sentence comparing current ${currentBedtimeHour}:00 bedtime to the recommendation"
}`;

  const model = genAI.getGenerativeModel({
    model: config.gemini.model,
    generationConfig: { maxOutputTokens: 3072, responseMimeType: 'application/json' },
  });

  const result = await model.generateContent(prompt);
  let text = result.response.text();
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  // Strip line-level // comments Gemini sometimes adds
  text = text.split('\n').map(line => {
    const idx = line.search(/(^|[^:])\/\/[^"]*$/);
    if (idx === -1) return line;
    return line.slice(0, idx + 1);
  }).join('\n');
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) text = text.slice(firstBrace, lastBrace + 1);

  try {
    const parsed = JSON.parse(text);
    // Validate minimum required fields
    if (!parsed.recommended_bedtime?.start_hour && parsed.recommended_bedtime?.start_hour !== 0) {
      throw new Error('Missing recommended_bedtime.start_hour in response');
    }
    return { ...parsed, nights_analyzed: nights.length };
  } catch (err: any) {
    console.error('[schedule-optimizer] Failed to parse Gemini response:', err.message);
    console.error('[schedule-optimizer] Raw text (first 800):', text.slice(0, 800));
    // Throw so route returns 500 — frontend can show an error state rather than fake numbers
    throw new Error(`Schedule optimizer parse failed: ${err.message}`);
  }
}
