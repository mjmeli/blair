import { Router } from 'express';
import * as nanit from '../services/nanit-client.js';
import { getAdjustedAgeMonths } from '../services/sleep-scorer.js';
import { generateNightInsights } from '../services/ai-insights.js';
import { loadScoredNights, scoreWindow } from '../services/night-history.js';
import { localDateStr, localHour } from '../services/night-windows.js';
import { requireToken } from '../middleware/auth.js';
import { handleRouteError } from '../middleware/errorHandler.js';
import * as store from '../services/store.js';
import { consumeAiBudget } from '../services/ai-budget.js';
import { getBabyProfile, profilePromptBlock } from '../services/baby-context.js';

const router = Router();

/**
 * Is the baby still in the middle of this night?
 * The window end (wake hour + buffer) being in the future is necessary but not
 * sufficient: a finished night viewed at 9am would otherwise read as "so far".
 * We also require that the last detected sleep ended recently — generously
 * before the configured wake hour (a mid-night feed can run long), tightly after it.
 */
function nightIsInProgress(windowEnd: number, lastSleepEnd: number, wakeHour: number, tzOffset: number): boolean {
  const nowSec = Date.now() / 1000;
  if (windowEnd <= nowSec) return false;
  const minutesSinceLastSleep = (nowSec - lastSleepEnd) / 60;
  const beforeWakeHour = localHour(nowSec, tzOffset) < wakeHour;
  return beforeWakeHour ? minutesSinceLastSleep < 120 : minutesSinceLastSleep < 30;
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

    const currentDate = localDateStr(start, tzOffset);
    const rangeBase = { token, babyUid, birthdate, prematureWeeks, bedtimeHour, wakeHour, tzOffset };

    const current = await scoreWindow(rangeBase, { date: currentDate, start, end });
    if (!current) {
      res.json({ insights: { summary: 'No sleep data found for this night.', keyFactors: { positive: [], negative: [] }, comparison: '', patterns: [], tip: '' } });
      return;
    }

    const isInProgress = nightIsInProgress(end, current.night.night_end, wakeHour, tzOffset);
    const profile = await getBabyProfile(babyUid);
    const adjAge = getAdjustedAgeMonths(birthdate, prematureWeeks, new Date(current.night.night_start * 1000));

    // Check Firestore cache — skip for in-progress nights and forced regenerations.
    // The key includes the annotation timestamp so a manual adjustment invalidates it.
    const nightKey = `${start}:v5:${current.annotation?.updated_at ?? 0}:p${profile.updated_at}`;
    if (!force && !isInProgress) {
      const cached = await store.getCachedInsight(babyUid, nightKey).catch(() => null);
      if (cached) {
        res.json({ insights: cached });
        return;
      }
    }

    // Last 7 nights before this one, for comparison
    const recent = await loadScoredNights({ ...rangeBase, days: 7, beforeDate: currentDate });
    const recentNights = recent.map(n => ({ date: n.date, score: n.score, night: n.night }));

    // Fetch events for this night and pick up to 6 with thumbnails spread across the night
    let eventContext: any[] = [];
    try {
      const eventsData = await nanit.getEvents(token, babyUid, 30);
      const rawEvents = (eventsData.events || []) as any[];
      const nightEvents = rawEvents
        .filter(e => e.time >= start && e.time <= end && e.media_urls?.thumbnail)
        .sort((a, b) => a.time - b.time);

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

    await consumeAiBudget(babyUid, 'insights');
    const insights = await generateNightInsights(
      { date: currentDate, score: current.score, night: current.night },
      recentNights,
      adjAge,
      prematureWeeks,
      tzOffset,
      eventContext,
      isInProgress,
      profilePromptBlock(profile),
      force,
    );

    if (!isInProgress) {
      await store.cacheInsight(babyUid, nightKey, insights).catch(() => {});
    }

    res.json({ insights, in_progress: isInProgress });
  } catch (err: any) {
    handleRouteError(res, err, 'insights_failed');
  }
});

export default router;
