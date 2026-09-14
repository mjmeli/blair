import { Router } from 'express';
import * as nanit from '../services/nanit-client.js';
import { buildNightSummaries, scoreNight } from '../services/sleep-scorer.js';
import { requireToken } from '../middleware/auth.js';
import { handleRouteError } from '../middleware/errorHandler.js';
import * as store from '../services/firestore.js';
import type { SleepAnnotation } from '../types/app.js';

const router = Router();

async function getSleepFromCalendar(token: string, babyUid: string, start: number, end: number) {
  const result = await nanit.getCalendarEvents(token, babyUid, start, end);
  const sleepEntries = result.calendar.filter(e => e.type === 'auto_sleep');
  return buildNightSummaries(sleepEntries);
}

/**
 * Create a Date in client's local time using their timezone offset.
 * tzOffset = minutes behind UTC (e.g. -420 for PDT = UTC-7)
 */
function localDate(year: number, month: number, day: number, hour: number, tzOffset: number): Date {
  // Create UTC date, then shift by timezone offset
  const utc = Date.UTC(year, month, day, hour, 0, 0);
  return new Date(utc + tzOffset * 60 * 1000);
}

function nightWindowFromDate(date: Date, bedtimeHour: number, wakeHour: number, tzOffset: number): { start: number; end: number; dateStr: string } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const nightStart = localDate(y, m, d, bedtimeHour, tzOffset);
  const nightEnd = localDate(y, m, d + 1, wakeHour + 4, tzOffset);
  const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return {
    start: Math.floor(nightStart.getTime() / 1000),
    end: Math.floor(nightEnd.getTime() / 1000),
    dateStr,
  };
}

router.get('/:babyUid/sleep', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const start = parseInt(String(req.query.start));
    const end = parseInt(String(req.query.end));
    if (!start || !end) {
      res.status(400).json({ error: 'bad_request', message: 'start and end query params required (unix timestamps)' });
      return;
    }
    const nights = await getSleepFromCalendar(token, babyUid, start, end);
    res.json({ nights });
  } catch (err: any) {
    handleRouteError(res, err, 'fetch_failed');
  }
});

router.get('/:babyUid/sleep/score', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const start = parseInt(String(req.query.start));
    const end = parseInt(String(req.query.end));
    const birthdate = String(req.query.birthdate || '');
    const prematureWeeks = parseInt(String(req.query.premature_weeks)) || 0;
    const tzOffset = parseInt(String(req.query.tz_offset)) || 0;
    if (!start || !end || !birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'start, end, and birthdate query params required' });
      return;
    }
    const nights = await getSleepFromCalendar(token, babyUid, start, end);
    if (nights.length === 0) {
      res.json({ scores: [] });
      return;
    }
    const scores = await Promise.all(nights.map(async (night, i) => {
      const nightId = `${babyUid}:${start}:${i}`;
      const annotation = await store.getAnnotation(babyUid, nightId).catch(() => null);
      return {
        night_id: nightId,
        ...scoreNight(night, birthdate, prematureWeeks, annotation ?? undefined, tzOffset),
        night_start: night.night_start,
        night_end: night.night_end,
        segment_count: night.sleep_segments.length,
        segments: night.sleep_segments,
        gaps: night.gaps,
      };
    }));
    res.json({ scores });
  } catch (err: any) {
    handleRouteError(res, err, 'score_failed');
  }
});

// Multi-night trend: uses client tz_offset to compute correct local-time night windows
router.get('/:babyUid/sleep/trend', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const birthdate = String(req.query.birthdate || '');
    const prematureWeeks = parseInt(String(req.query.premature_weeks)) || 0;
    const days = parseInt(String(req.query.days)) || 7;
    const bedtimeHour = parseInt(String(req.query.bedtime_hour)) || 19;
    const wakeHour = parseInt(String(req.query.wake_hour)) || 8;
    const tzOffset = parseInt(String(req.query.tz_offset)) || 0;

    if (!birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'birthdate query param required' });
      return;
    }

    // "now" in client's local time
    const nowMs = Date.now() + tzOffset * 60 * 1000;
    const trend: any[] = [];

    for (let d = days; d >= 1; d--) {
      const nightDateMs = nowMs - d * 86400000;
      const nightDate = new Date(nightDateMs);
      const nw = nightWindowFromDate(nightDate, bedtimeHour, wakeHour, tzOffset);

      try {
        const nights = await getSleepFromCalendar(token, babyUid, nw.start, nw.end);
        if (nights.length > 0) {
          const mainNight = nights.reduce((best, n) =>
            n.total_duration_minutes > best.total_duration_minutes ? n : best
          , nights[0]);
          const score = scoreNight(mainNight, birthdate, prematureWeeks, undefined, tzOffset);
          trend.push({
            date: nw.dateStr,
            score: score.total_score,
            total_sleep_minutes: score.details.total_sleep_minutes,
            wake_count: score.details.wake_count,
            longest_stretch_minutes: score.details.longest_stretch_minutes,
            bedtime: score.details.bedtime,
            wake_time: score.details.wake_time,
          });
        } else {
          trend.push({ date: nw.dateStr, score: null, total_sleep_minutes: null });
        }
      } catch {
        trend.push({ date: nw.dateStr, score: null, total_sleep_minutes: null });
      }
    }

    res.json({ trend });
  } catch (err: any) {
    handleRouteError(res, err, 'trend_failed');
  }
});

// Milestones endpoint — detects achievements across recent nights
router.get('/:babyUid/sleep/milestones', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const birthdate = String(req.query.birthdate || '');
    const prematureWeeks = parseInt(String(req.query.premature_weeks)) || 0;
    const days = parseInt(String(req.query.days)) || 14;
    const bedtimeHour = parseInt(String(req.query.bedtime_hour)) || 19;
    const wakeHour = parseInt(String(req.query.wake_hour)) || 8;
    const tzOffset = parseInt(String(req.query.tz_offset)) || 0;

    if (!birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'birthdate query param required' });
      return;
    }

    const { detectMilestones, toHistoryNights } = await import('../services/milestones.js');

    const nowMs = Date.now() + tzOffset * 60 * 1000;
    const history: any[] = [];

    for (let d = days; d >= 1; d--) {
      const nightDateMs = nowMs - d * 86400000;
      const nightDate = new Date(nightDateMs);
      const nw = nightWindowFromDate(nightDate, bedtimeHour, wakeHour, tzOffset);

      try {
        const nights = await getSleepFromCalendar(token, babyUid, nw.start, nw.end);
        if (nights.length > 0) {
          const mainNight = nights.reduce((best, n) =>
            n.total_duration_minutes > best.total_duration_minutes ? n : best
          , nights[0]);
          const score = scoreNight(mainNight, birthdate, prematureWeeks, undefined, tzOffset);
          history.push({
            date: nw.dateStr,
            score: score.total_score,
            total_sleep_minutes: score.details.total_sleep_minutes,
            wake_count: score.details.wake_count,
            longest_stretch_minutes: score.details.longest_stretch_minutes,
            bedtime: score.details.bedtime,
          });
        }
      } catch {
        // skip failed nights
      }
    }

    const milestones = detectMilestones(toHistoryNights(history), tzOffset);
    res.json({ milestones, nights_analyzed: history.length });
  } catch (err: any) {
    handleRouteError(res, err, 'milestones_failed');
  }
});

// Compare two specific nights with Gemini AI
router.get('/:babyUid/sleep/compare', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const dateA = String(req.query.date_a || '');
    const dateB = String(req.query.date_b || '');
    const birthdate = String(req.query.birthdate || '');
    const prematureWeeks = parseInt(String(req.query.premature_weeks)) || 0;
    const bedtimeHour = parseInt(String(req.query.bedtime_hour)) || 19;
    const wakeHour = parseInt(String(req.query.wake_hour)) || 8;
    const tzOffset = parseInt(String(req.query.tz_offset)) || 0;

    if (!dateA || !dateB || !birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'date_a, date_b, and birthdate required' });
      return;
    }
    if (dateA === dateB) {
      res.status(400).json({ error: 'bad_request', message: 'date_a and date_b must be different' });
      return;
    }

    const { compareNights } = await import('../services/night-comparison.js');
    const { getAdjustedAgeMonths } = await import('../services/sleep-scorer.js');

    // Build night windows from YYYY-MM-DD
    function windowFromDate(dateStr: string) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const nightStart = localDate(y, m - 1, d, bedtimeHour, tzOffset);
      const nightEnd = localDate(y, m - 1, d + 1, wakeHour + 4, tzOffset);
      return {
        start: Math.floor(nightStart.getTime() / 1000),
        end: Math.floor(nightEnd.getTime() / 1000),
      };
    }

    const wa = windowFromDate(dateA);
    const wb = windowFromDate(dateB);

    // Fetch both nights in parallel
    const [nightsA, nightsB, eventsData] = await Promise.all([
      getSleepFromCalendar(token, babyUid, wa.start, wa.end),
      getSleepFromCalendar(token, babyUid, wb.start, wb.end),
      nanit.getEvents(token, babyUid, 80).catch(() => ({ events: [] })),
    ]);

    if (nightsA.length === 0 || nightsB.length === 0) {
      res.status(404).json({ error: 'no_data', message: 'One or both nights have no sleep data' });
      return;
    }

    const pickMain = (list: any[]) => list.reduce((b, n) => n.total_duration_minutes > b.total_duration_minutes ? n : b, list[0]);
    const mainA = pickMain(nightsA);
    const mainB = pickMain(nightsB);
    const scoreA = scoreNight(mainA, birthdate, prematureWeeks, undefined, tzOffset);
    const scoreB = scoreNight(mainB, birthdate, prematureWeeks, undefined, tzOffset);

    // Pick a few thumbnails from each night (up to 3 each to fit 6 total)
    async function downloadThumb(url: string): Promise<{ mimeType: string; data: string } | null> {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return null;
        const buf = await r.arrayBuffer();
        if (buf.byteLength > 5 * 1024 * 1024) return null;
        return { mimeType: r.headers.get('content-type') || 'image/png', data: Buffer.from(buf).toString('base64') };
      } catch { return null; }
    }

    async function thumbsForWindow(start: number, end: number) {
      const rawEvents = (eventsData.events || []) as any[];
      const windowEvents = rawEvents
        .filter(e => e.time >= start && e.time <= end && e.media_urls?.thumbnail)
        .sort((a, b) => a.time - b.time);
      const picks = windowEvents.length <= 3 ? windowEvents : [0, Math.floor(windowEvents.length / 2), windowEvents.length - 1].map(i => windowEvents[i]);
      const downloads = await Promise.all(picks.map(e => downloadThumb(e.media_urls.thumbnail)));
      const valid: any[] = [];
      picks.forEach((e, i) => {
        if (downloads[i]) valid.push({ ...downloads[i], event_type: e.key, time: e.time });
      });
      return valid;
    }

    const [thumbsA, thumbsB] = await Promise.all([
      thumbsForWindow(wa.start, wa.end),
      thumbsForWindow(wb.start, wb.end),
    ]);

    const adjAge = getAdjustedAgeMonths(birthdate, prematureWeeks);
    const comparison = await compareNights(
      { date: dateA, score: scoreA, night: mainA, thumbnailDataUrls: thumbsA },
      { date: dateB, score: scoreB, night: mainB, thumbnailDataUrls: thumbsB },
      adjAge,
      tzOffset,
    );

    res.json({
      comparison,
      night_a: { date: dateA, score: scoreA },
      night_b: { date: dateB, score: scoreB },
      images_used: { a: thumbsA.length, b: thumbsB.length },
    });
  } catch (err: any) {
    console.error('[compare] Error:', err.message);
    handleRouteError(res, err, 'compare_failed');
  }
});

// Regression alerts — detects concerning patterns
router.get('/:babyUid/sleep/alerts', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const birthdate = String(req.query.birthdate || '');
    const prematureWeeks = parseInt(String(req.query.premature_weeks)) || 0;
    const days = parseInt(String(req.query.days)) || 10;
    const bedtimeHour = parseInt(String(req.query.bedtime_hour)) || 19;
    const wakeHour = parseInt(String(req.query.wake_hour)) || 8;
    const tzOffset = parseInt(String(req.query.tz_offset)) || 0;

    if (!birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'birthdate query param required' });
      return;
    }

    const { detectRegressions } = await import('../services/regression-detector.js');

    const nowMs = Date.now() + tzOffset * 60 * 1000;
    const history: any[] = [];

    for (let d = days; d >= 1; d--) {
      const nightDateMs = nowMs - d * 86400000;
      const nightDate = new Date(nightDateMs);
      const nw = nightWindowFromDate(nightDate, bedtimeHour, wakeHour, tzOffset);

      try {
        const nights = await getSleepFromCalendar(token, babyUid, nw.start, nw.end);
        if (nights.length > 0) {
          const mainNight = nights.reduce((best, n) => n.total_duration_minutes > best.total_duration_minutes ? n : best, nights[0]);
          const score = scoreNight(mainNight, birthdate, prematureWeeks, undefined, tzOffset);
          history.push({
            date: nw.dateStr,
            score: score.total_score,
            total_sleep_minutes: score.details.total_sleep_minutes,
            wake_count: score.details.wake_count,
            longest_stretch_minutes: score.details.longest_stretch_minutes,
            bedtime: score.details.bedtime,
          });
        }
      } catch { /* skip */ }
    }

    const alerts = detectRegressions(history, tzOffset);
    res.json({ alerts, nights_analyzed: history.length });
  } catch (err: any) {
    handleRouteError(res, err, 'alerts_failed');
  }
});

// Schedule Optimizer — Gemini recommends optimal bedtime/wake windows
router.get('/:babyUid/sleep/schedule-optimizer', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const birthdate = String(req.query.birthdate || '');
    const prematureWeeks = parseInt(String(req.query.premature_weeks)) || 0;
    const days = Math.min(parseInt(String(req.query.days)) || 21, 30);
    const bedtimeHour = parseInt(String(req.query.bedtime_hour)) || 19;
    const wakeHour = parseInt(String(req.query.wake_hour)) || 8;
    const tzOffset = parseInt(String(req.query.tz_offset)) || 0;
    const force = req.query.force === 'true';

    if (!birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'birthdate query param required' });
      return;
    }

    // Firestore cache — valid for 24h unless force
    const today = new Date(Date.now() - tzOffset * 60 * 1000).toISOString().split('T')[0];
    const cacheKey = `schedule:${today}:${days}:${bedtimeHour}:${wakeHour}`;
    if (!force) {
      const cached = await store.getCachedInsight(babyUid, cacheKey).catch(() => null);
      if (cached) {
        res.json({ recommendation: cached, cached: true });
        return;
      }
    }

    const { recommendSchedule } = await import('../services/schedule-optimizer.js');
    const { getAdjustedAgeMonths } = await import('../services/sleep-scorer.js');

    const nowMs = Date.now() + tzOffset * 60 * 1000;
    const history: any[] = [];

    for (let d = days; d >= 1; d--) {
      const nightDateMs = nowMs - d * 86400000;
      const nightDate = new Date(nightDateMs);
      const nw = nightWindowFromDate(nightDate, bedtimeHour, wakeHour, tzOffset);

      try {
        const nights = await getSleepFromCalendar(token, babyUid, nw.start, nw.end);
        if (nights.length > 0) {
          const mainNight = nights.reduce((best, n) => n.total_duration_minutes > best.total_duration_minutes ? n : best, nights[0]);
          const score = scoreNight(mainNight, birthdate, prematureWeeks, undefined, tzOffset);
          history.push({
            date: nw.dateStr,
            score: score.total_score,
            total_sleep_minutes: score.details.total_sleep_minutes,
            wake_count: score.details.wake_count,
            longest_stretch_minutes: score.details.longest_stretch_minutes,
            bedtime: score.details.bedtime,
            wake_time: score.details.wake_time,
          });
        }
      } catch { /* skip */ }
    }

    const adjAge = getAdjustedAgeMonths(birthdate, prematureWeeks);
    const recommendation = await recommendSchedule(history, adjAge, bedtimeHour, wakeHour, tzOffset);

    await store.cacheInsight(babyUid, cacheKey, recommendation as any).catch(() => {});

    res.json({ recommendation, nights_analyzed: history.length, cached: false });
  } catch (err: any) {
    console.error('[optimizer] Error:', err.message);
    handleRouteError(res, err, 'optimizer_failed');
  }
});

router.put('/:babyUid/sleep/:nightId', requireToken, async (req, res) => {
  try {
    const babyUid = String(req.params.babyUid);
    const nightId = String(req.params.nightId);
    const { custom_start_time, custom_end_time, notes } = req.body;
    const annotation: SleepAnnotation = {
      session_id: nightId,
      baby_uid: babyUid,
      custom_start_time,
      custom_end_time,
      notes,
      updated_at: Date.now(),
    };
    await store.saveAnnotation(annotation);
    res.json({ success: true, annotation });
  } catch (err: any) {
    handleRouteError(res, err, 'update_failed');
  }
});

export default router;
