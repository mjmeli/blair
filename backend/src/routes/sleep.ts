import { Router } from 'express';
import * as nanit from '../services/nanit-client.js';
import { applyAnnotation, getAdjustedAgeMonths, pickMainNight, scoreNight } from '../services/sleep-scorer.js';
import { getNightsForWindow, loadScoredNights, scoreWindow, toHistoryPoint } from '../services/night-history.js';
import { localDateStr, localNow, nightId, nightWindowFromDateStr } from '../services/night-windows.js';
import { requireToken } from '../middleware/auth.js';
import { handleRouteError } from '../middleware/errorHandler.js';
import * as store from '../services/firestore.js';
import { consumeAiBudget } from '../services/ai-budget.js';
import { getBabyProfile, profilePromptBlock } from '../services/baby-context.js';
import type { SleepAnnotation } from '../types/app.js';

const router = Router();

/** Query params shared by every multi-night route. */
function rangeParams(req: any, defaultDays: number, maxDays = 60) {
  return {
    token: req.nanitToken as string,
    babyUid: String(req.params.babyUid),
    birthdate: String(req.query.birthdate || ''),
    prematureWeeks: parseInt(String(req.query.premature_weeks)) || 0,
    days: Math.min(parseInt(String(req.query.days)) || defaultDays, maxDays),
    bedtimeHour: parseInt(String(req.query.bedtime_hour)) || 19,
    wakeHour: parseInt(String(req.query.wake_hour)) || 8,
    tzOffset: parseInt(String(req.query.tz_offset)) || 0,
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
    const nights = await getNightsForWindow(token, babyUid, start, end);
    res.json({ nights });
  } catch (err: any) {
    handleRouteError(res, err, 'fetch_failed');
  }
});

/**
 * Score every night found in a window. The longest one is the "main" night and
 * gets the stable id `${babyUid}:${YYYY-MM-DD}` used for annotations; any
 * other (nap-like) nights in the window get an `:altN` suffix.
 */
router.get('/:babyUid/sleep/score', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const start = parseInt(String(req.query.start));
    const end = parseInt(String(req.query.end));
    const birthdate = String(req.query.birthdate || '');
    const prematureWeeks = parseInt(String(req.query.premature_weeks)) || 0;
    const tzOffset = parseInt(String(req.query.tz_offset)) || 0;
    const bedtimeHour = req.query.bedtime_hour ? parseInt(String(req.query.bedtime_hour)) : undefined;
    if (!start || !end || !birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'start, end, and birthdate query params required' });
      return;
    }
    const nights = await getNightsForWindow(token, babyUid, start, end);
    if (nights.length === 0) {
      res.json({ scores: [] });
      return;
    }
    const date = localDateStr(start, tzOffset);
    const main = pickMainNight(nights);
    let altIndex = 0;
    const scores = await Promise.all(nights.map(async raw => {
      const id = raw === main ? nightId(babyUid, date) : `${nightId(babyUid, date)}:alt${++altIndex}`;
      const annotation = await store.getAnnotation(babyUid, id).catch(() => null);
      const adjusted = applyAnnotation(raw, annotation);
      return {
        night_id: id,
        is_main: raw === main,
        ...scoreNight(raw, { birthdate, prematureWeeks, annotation, tzOffset, bedtimeHour }),
        night_start: adjusted.night_start,
        night_end: adjusted.night_end,
        raw_night_start: raw.night_start,
        raw_night_end: raw.night_end,
        segment_count: adjusted.sleep_segments.length,
        segments: adjusted.sleep_segments,
        gaps: adjusted.gaps,
        annotation,
      };
    }));
    res.json({ scores });
  } catch (err: any) {
    handleRouteError(res, err, 'score_failed');
  }
});

// Multi-night trend
router.get('/:babyUid/sleep/trend', requireToken, async (req, res) => {
  try {
    const p = rangeParams(req, 7);
    if (!p.birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'birthdate query param required' });
      return;
    }
    const nights = await loadScoredNights(p);
    const byDate = new Map(nights.map(n => [n.date, toHistoryPoint(n)]));
    // Keep a row for every requested date so the chart shows gaps
    const { pastNightDates } = await import('../services/night-windows.js');
    const trend = pastNightDates(p.days, p.tzOffset).map(date =>
      byDate.get(date) ?? { date, score: null, total_sleep_minutes: null },
    );
    res.json({ trend });
  } catch (err: any) {
    handleRouteError(res, err, 'trend_failed');
  }
});

// Milestones — detects achievements across recent nights
router.get('/:babyUid/sleep/milestones', requireToken, async (req, res) => {
  try {
    const p = rangeParams(req, 14);
    if (!p.birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'birthdate query param required' });
      return;
    }
    const { detectMilestones, toHistoryNights } = await import('../services/milestones.js');
    const history = (await loadScoredNights(p)).map(toHistoryPoint);
    const milestones = detectMilestones(toHistoryNights(history), p.tzOffset);
    res.json({ milestones, nights_analyzed: history.length });
  } catch (err: any) {
    handleRouteError(res, err, 'milestones_failed');
  }
});

// Compare two specific nights with Claude
router.get('/:babyUid/sleep/compare', requireToken, async (req, res) => {
  try {
    const p = rangeParams(req, 0);
    const dateA = String(req.query.date_a || '');
    const dateB = String(req.query.date_b || '');

    if (!dateA || !dateB || !p.birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'date_a, date_b, and birthdate required' });
      return;
    }
    if (dateA === dateB) {
      res.status(400).json({ error: 'bad_request', message: 'date_a and date_b must be different' });
      return;
    }

    const { compareNights } = await import('../services/night-comparison.js');

    const wa = nightWindowFromDateStr(dateA, p.bedtimeHour, p.wakeHour, p.tzOffset);
    const wb = nightWindowFromDateStr(dateB, p.bedtimeHour, p.wakeHour, p.tzOffset);

    const [nightA, nightB, eventsData, profile] = await Promise.all([
      scoreWindow(p, wa),
      scoreWindow(p, wb),
      nanit.getEvents(p.token, p.babyUid, 80).catch(() => ({ events: [] })),
      getBabyProfile(p.babyUid),
    ]);

    if (!nightA || !nightB) {
      res.status(404).json({ error: 'no_data', message: 'One or both nights have no sleep data' });
      return;
    }

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

    const adjAge = getAdjustedAgeMonths(p.birthdate, p.prematureWeeks, new Date(nightB.night.night_start * 1000));
    await consumeAiBudget(p.babyUid, 'compare');
    const comparison = await compareNights(
      { date: dateA, score: nightA.score, night: nightA.night, thumbnailDataUrls: thumbsA },
      { date: dateB, score: nightB.score, night: nightB.night, thumbnailDataUrls: thumbsB },
      adjAge,
      p.tzOffset,
      profilePromptBlock(profile),
    );

    res.json({
      comparison,
      night_a: { date: dateA, score: nightA.score },
      night_b: { date: dateB, score: nightB.score },
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
    const p = rangeParams(req, 10);
    if (!p.birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'birthdate query param required' });
      return;
    }
    const { detectRegressions } = await import('../services/regression-detector.js');
    const history = (await loadScoredNights(p)).map(toHistoryPoint);
    const alerts = detectRegressions(history, p.tzOffset);
    res.json({ alerts, nights_analyzed: history.length });
  } catch (err: any) {
    handleRouteError(res, err, 'alerts_failed');
  }
});

// Schedule Optimizer — Claude recommends optimal bedtime/wake windows
router.get('/:babyUid/sleep/schedule-optimizer', requireToken, async (req, res) => {
  try {
    const p = rangeParams(req, 21, 30);
    const force = req.query.force === 'true';
    if (!p.birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'birthdate query param required' });
      return;
    }

    // Firestore cache — valid for 24h unless force
    const today = localNow(p.tzOffset).toISOString().split('T')[0];
    const cacheKey = `schedule:v3:${today}:${p.days}:${p.bedtimeHour}:${p.wakeHour}`;
    if (!force) {
      const cached = await store.getCachedInsight(p.babyUid, cacheKey).catch(() => null);
      if (cached) {
        res.json({ recommendation: cached, cached: true });
        return;
      }
    }

    const { recommendSchedule } = await import('../services/schedule-optimizer.js');
    const history = (await loadScoredNights(p)).map(toHistoryPoint);
    const adjAge = getAdjustedAgeMonths(p.birthdate, p.prematureWeeks);
    await consumeAiBudget(p.babyUid, 'schedule');
    const recommendation = await recommendSchedule(history, adjAge, p.bedtimeHour, p.wakeHour, p.tzOffset);

    await store.cacheInsight(p.babyUid, cacheKey, recommendation as any).catch(() => {});

    res.json({ recommendation, nights_analyzed: history.length, cached: false });
  } catch (err: any) {
    console.error('[optimizer] Error:', err.message);
    handleRouteError(res, err, 'optimizer_failed');
  }
});

/**
 * Save (or clear) a manual night adjustment. Body: { custom_start_time?, custom_end_time?, notes? }
 * as unix seconds; null/absent for both times deletes the annotation.
 */
router.put('/:babyUid/sleep/:nightId', requireToken, async (req, res) => {
  try {
    const babyUid = String(req.params.babyUid);
    const id = String(req.params.nightId);
    const { custom_start_time, custom_end_time, notes } = req.body ?? {};

    const start = typeof custom_start_time === 'number' ? Math.floor(custom_start_time) : undefined;
    const end = typeof custom_end_time === 'number' ? Math.floor(custom_end_time) : undefined;
    if (start !== undefined && end !== undefined && end <= start) {
      res.status(400).json({ error: 'bad_request', message: 'custom_end_time must be after custom_start_time' });
      return;
    }

    if (start === undefined && end === undefined && !notes) {
      await store.deleteAnnotation(babyUid, id);
      res.json({ success: true, annotation: null });
      return;
    }

    const annotation: SleepAnnotation = {
      session_id: id,
      baby_uid: babyUid,
      ...(start !== undefined && { custom_start_time: start }),
      ...(end !== undefined && { custom_end_time: end }),
      ...(notes && { notes: String(notes) }),
      updated_at: Date.now(),
    };
    await store.saveAnnotation(annotation);
    res.json({ success: true, annotation });
  } catch (err: any) {
    handleRouteError(res, err, 'update_failed');
  }
});

export default router;
