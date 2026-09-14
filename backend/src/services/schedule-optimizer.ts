import { z } from 'zod';
import { generateStructured, isClaudeConfigured } from './claude.js';

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

const HourWindow = z.object({
  start_hour: z.number().int().min(0).max(23).describe('Window start, integer hour in 24h local time'),
  end_hour: z.number().int().min(0).max(24).describe('Window end, integer hour in 24h local time'),
});

const ScheduleSchema = z.object({
  recommended_bedtime: HourWindow,
  recommended_wake: HourWindow,
  confidence: z.enum(['low', 'medium', 'high']),
  reasoning: z.string().describe('1-3 sentences explaining the recommendation based on the data'),
  observed_patterns: z.array(z.string()).describe('2-3 brief patterns with specific numbers'),
  expected_impact: z.string().describe('One short sentence on the improvement the parent might see'),
  cautions: z.array(z.string()).describe('0-2 brief caveats, e.g. age-related'),
  current_vs_recommended: z.string().describe('One short sentence comparing the current bedtime setting to the recommendation'),
});

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
  if (!isClaudeConfigured()) throw new Error('ANTHROPIC_API_KEY is not configured');

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

  const analysis = nights.map(n => ({
    date: n.date,
    score: n.score,
    bedtime_hour: Math.round(hourOf(n.bedtime, tzOffset) * 10) / 10,
    wake_hour: Math.round(hourOf(n.wake_time, tzOffset) * 10) / 10,
    sleep_hours: Math.round((n.total_sleep_minutes / 60) * 10) / 10,
    wakes: n.wake_count,
    longest_stretch_hours: Math.round((n.longest_stretch_minutes / 60) * 10) / 10,
  }));

  // Pre-compute basic correlations to give the model a head start
  const sorted = [...analysis].sort((a, b) => b.score - a.score);
  const top3 = sorted.slice(0, 3);
  const bottom3 = sorted.slice(-3);
  const avgBedtimeTop = top3.reduce((s, n) => s + n.bedtime_hour, 0) / top3.length;
  const avgBedtimeBottom = bottom3.reduce((s, n) => s + n.bedtime_hour, 0) / bottom3.length;

  const nightsTable = analysis
    .map(a => `  ${a.date}: score=${a.score}, bedtime=${a.bedtime_hour}h, wake=${a.wake_hour}h, sleep=${a.sleep_hours}h, wakes=${a.wakes}, longest=${a.longest_stretch_hours}h`)
    .join('\n');

  const prompt = `Recommend an optimal sleep schedule for a baby who is ${Math.round(adjustedAgeMonths * 10) / 10} months old (adjusted age), based on this history.

Current settings:
- Expected bedtime: ${currentBedtimeHour}:00
- Expected wake: ${currentWakeHour}:00

Past ${nights.length} nights (bedtime/wake in local 24h decimal — e.g. 19.5 = 7:30 PM):
${nightsTable}

Quick stats for context:
- Top 3 nights (by score) averaged a bedtime of ${avgBedtimeTop.toFixed(1)}h
- Bottom 3 nights averaged a bedtime of ${avgBedtimeBottom.toFixed(1)}h

Find the bedtime and wake windows that correlate with the best sleep scores. Consider:
- Which bedtime ranges correlate with higher scores, longer stretches, fewer wakes
- Which bedtime ranges correlate with worse outcomes
- Age-appropriate expectations for this developmental stage
- Circadian rhythm principles (consistency matters more than exact time)

Use integer hours in 24-hour format for the recommended windows, and keep strings concise.`;

  const result = await generateStructured({
    label: 'schedule',
    schema: ScheduleSchema,
    system: 'You are a pediatric sleep specialist recommending sleep schedules from tracked data. Ground every claim in the numbers provided.',
    prompt,
  });

  return { ...result, nights_analyzed: nights.length };
}
