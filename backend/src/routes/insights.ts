import { Router } from 'express';
import * as nanit from '../services/nanit-client.js';
import { buildNightSummaries, scoreNight, getAdjustedAgeMonths } from '../services/sleep-scorer.js';
import { generateNightInsights } from '../services/ai-insights.js';
import { requireToken } from '../middleware/auth.js';
import { handleRouteError } from '../middleware/errorHandler.js';
import * as store from '../services/firestore.js';

const router = Router();

async function getSleepFromCalendar(token: string, babyUid: string, start: number, end: number) {
  const result = await nanit.getCalendarEvents(token, babyUid, start, end);
  const sleepEntries = result.calendar.filter(e => e.type === 'auto_sleep');
  return buildNightSummaries(sleepEntries);
}

function localDate(year: number, month: number, day: number, hour: number, tzOffset: number): Date {
  const utc = Date.UTC(year, month, day, hour, 0, 0);
  return new Date(utc + tzOffset * 60 * 1000);
}

router.get('/:babyUid/sleep/insights', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const start = parseInt(String(req.query.start));
    const end = parseInt(String(req.query.end));
    const birthdate = String(req.query.birthdate || '');
    const prematureWeeks = parseInt(String(req.query.premature_weeks)) || 0;
    const bedtimeHour = parseInt(String(req.query.bedtime_hour)) || 19;
    const wakeHour = parseInt(String(req.query.wake_hour)) || 8;
    const tzOffset = parseInt(String(req.query.tz_offset)) || 0;
    const force = req.query.force === 'true';

    if (!start || !end || !birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'start, end, and birthdate required' });
      return;
    }

    // Night is in-progress if the window end is still in the future
    const nowSec = Math.floor(Date.now() / 1000);
    const isInProgress = end > nowSec;

    const adjAge = getAdjustedAgeMonths(birthdate, prematureWeeks);

    // Get current night
    const currentNights = await getSleepFromCalendar(token, babyUid, start, end);
    if (currentNights.length === 0) {
      res.json({ insights: { summary: 'No sleep data found for this night.', keyFactors: { positive: [], negative: [] }, comparison: '', patterns: [], tip: '' } });
      return;
    }

    const mainNight = currentNights.reduce((best, n) =>
      n.total_duration_minutes > best.total_duration_minutes ? n : best
    , currentNights[0]);
    const currentScore = scoreNight(mainNight, birthdate, prematureWeeks, undefined, tzOffset);
    const currentDate = new Date(start * 1000).toISOString().split('T')[0];

    // Get last 7 nights for comparison — use client tz_offset for correct windows
    const recentNights: { date: string; score: any; night: any }[] = [];

    for (let d = 1; d <= 7; d++) {
      const pastMs = start * 1000 - d * 86400000;
      const pastDate = new Date(pastMs + tzOffset * 60 * 1000);
      const y = pastDate.getUTCFullYear();
      const m = pastDate.getUTCMonth();
      const day = pastDate.getUTCDate();
      const ns = Math.floor(localDate(y, m, day, bedtimeHour, tzOffset).getTime() / 1000);
      const ne = Math.floor(localDate(y, m, day + 1, wakeHour + 4, tzOffset).getTime() / 1000);
      const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      try {
        const nights = await getSleepFromCalendar(token, babyUid, ns, ne);
        if (nights.length > 0) {
          const best = nights.reduce((b, n) => n.total_duration_minutes > b.total_duration_minutes ? n : b, nights[0]);
          const score = scoreNight(best, birthdate, prematureWeeks, undefined, tzOffset);
          recentNights.push({ date: dateStr, score, night: best });
        }
      } catch {
        // Skip failed nights
      }
    }

    // Check Firestore cache — skip for in-progress nights and forced regenerations
    // Cache key bumped to v3 because of structured video_analysis schema change
    const nightKey = `${start}:v3`;
    if (!force && !isInProgress) {
      const cached = await store.getCachedInsight(babyUid, nightKey).catch(() => null);
      if (cached) {
        res.json({ insights: cached });
        return;
      }
    }

    // Fetch events for this night and pick up to 6 with thumbnails spread across the night
    let eventContext: any[] = [];
    try {
      const eventsData = await nanit.getEvents(token, babyUid, 30);
      const rawEvents = (eventsData.events || []) as any[];
      const nightEvents = rawEvents
        .filter(e => e.time >= start && e.time <= end && e.media_urls?.thumbnail)
        .sort((a, b) => a.time - b.time);

      // Pick evenly-distributed events (up to 6) across the night
      if (nightEvents.length <= 6) {
        eventContext = nightEvents;
      } else {
        const step = nightEvents.length / 6;
        eventContext = Array.from({ length: 6 }, (_, i) => nightEvents[Math.floor(i * step)]);
      }

      eventContext = eventContext.map(e => ({
        uid: e.uid,
        key: e.key,
        title: e.title,
        time: e.time,
        thumbnail_url: e.media_urls?.thumbnail,
      }));
    } catch (err: any) {
      console.log(`[insights] Could not fetch events for video context: ${err.message}`);
    }

    const insights = await generateNightInsights(
      { date: currentDate, score: currentScore, night: mainNight },
      recentNights,
      adjAge,
      prematureWeeks,
      tzOffset,
      eventContext,
      isInProgress,
    );

    // Cache to Firestore only for completed nights
    if (!isInProgress) {
      await store.cacheInsight(babyUid, nightKey, insights).catch(() => {});
    }

    res.json({ insights });
  } catch (err: any) {
    handleRouteError(res, err, 'insights_failed');
  }
});

export default router;
