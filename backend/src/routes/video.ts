import { Router } from 'express';
import { readFile } from 'fs/promises';
import { requireToken } from '../middleware/auth.js';
import { handleRouteError } from '../middleware/errorHandler.js';
import * as video from '../services/video-stream.js';
import * as nanit from '../services/nanit-client.js';
import * as vision from '../services/video-analysis.js';
import { getAdjustedAgeMonths } from '../services/sleep-scorer.js';
import { loadScoredNights } from '../services/night-history.js';
import { localNow } from '../services/night-windows.js';
import { analyzeLongTermPatterns, type NightWithEvents } from '../services/video-patterns.js';
import * as store from '../services/firestore.js';
import { consumeAiBudget } from '../services/ai-budget.js';
import { getBabyProfile, profilePromptBlock } from '../services/baby-context.js';

const router = Router();

// Check video capabilities
router.get('/:babyUid/video/status', requireToken, async (_req, res) => {
  const hasFfmpeg = await video.checkFfmpeg();
  res.json({
    ffmpeg_available: hasFfmpeg,
    ai_available: !!process.env.ANTHROPIC_API_KEY,
    audio_available: !!process.env.GEMINI_API_KEY,
    stream_url_format: 'rtmps://media-secured.nanit.com/nanit/{baby_uid}.{token}',
  });
});

// Get Nanit events with clip URLs
router.get('/:babyUid/video/events', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const limit = parseInt(String(req.query.limit)) || 20;
    const data = await nanit.getEvents(token, babyUid, limit);
    res.json(data);
  } catch (err: any) {
    handleRouteError(res, err, 'events_failed');
  }
});

// Analyze a specific event's video clip (frames sampled with ffmpeg, analyzed by Claude)
router.post('/:babyUid/video/analyze', requireToken, async (req, res) => {
  try {
    const babyUid = String(req.params.babyUid);
    const { clip_url, thumbnail_url, event_type, event_title, birthdate, premature_weeks } = req.body;

    if (!clip_url && !thumbnail_url) {
      res.status(400).json({ error: 'bad_request', message: 'clip_url or thumbnail_url required' });
      return;
    }

    const adjAge = getAdjustedAgeMonths(birthdate || '2026-02-07', premature_weeks || 0);

    const profile = await getBabyProfile(babyUid);
    const profileBlock = profilePromptBlock(profile);

    // Check Firestore cache (keyed by clip and by profile version, so a changed profile re-analyzes)
    const urlForCache = clip_url || thumbnail_url;
    const cacheKey = `${urlForCache.split('?')[0].split('/').pop() || urlForCache.slice(-40)}:p${profile.updated_at}`;
    const cached = await store.getCachedInsight(babyUid, `video:${cacheKey}`).catch(() => null);
    if (cached) {
      res.json({ analysis: cached, cached: true });
      return;
    }

    console.log(`[video] Analyzing event: ${event_type} - ${event_title}`);
    await consumeAiBudget(babyUid, 'video');

    let analysis;
    if (clip_url) {
      analysis = await vision.analyzeVideoClip(
        clip_url,
        thumbnail_url || null,
        event_type || 'unknown',
        event_title || '',
        adjAge,
        profileBlock,
      );
    } else {
      analysis = await vision.analyzeFromThumbnail(
        thumbnail_url,
        event_type || 'unknown',
        event_title || '',
        adjAge,
        profileBlock,
      );
    }

    // Cache the result
    await store.cacheInsight(babyUid, `video:${cacheKey}`, analysis as any).catch(() => {});

    res.json({ analysis, cached: false });
  } catch (err: any) {
    console.error(`[video] Analysis error:`, err.message);
    handleRouteError(res, err, 'analysis_failed');
  }
});

// Get stream URL
router.get('/:babyUid/video/stream-url', requireToken, async (req, res) => {
  const token = (req as any).nanitToken;
  const babyUid = String(req.params.babyUid);
  const url = video.getStreamUrl(babyUid, token);
  res.json({ url });
});

// Capture a clip from live stream
router.post('/:babyUid/video/capture', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const duration = Math.min(parseInt(req.body.duration) || 30, 120);
    const label = String(req.body.label || 'manual');

    const hasFfmpeg = await video.checkFfmpeg();
    if (!hasFfmpeg) {
      res.status(503).json({ error: 'ffmpeg_not_found', message: 'ffmpeg is not installed' });
      return;
    }

    const filePath = await video.captureClip(babyUid, token, duration, label);
    res.json({ status: 'complete', path: filePath });
  } catch (err: any) {
    handleRouteError(res, err, 'capture_failed');
  }
});

// Capture and analyze a snapshot
router.post('/:babyUid/video/snapshot', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const { birthdate, premature_weeks } = req.body || {};

    const hasFfmpeg = await video.checkFfmpeg();
    if (!hasFfmpeg) {
      res.status(503).json({ error: 'ffmpeg_not_found', message: 'ffmpeg is not installed' });
      return;
    }

    const filePath = await video.captureSnapshot(babyUid, token);
    const imageBuffer = await readFile(filePath);
    const base64 = imageBuffer.toString('base64');

    res.json({ image: `data:image/jpeg;base64,${base64}` });
  } catch (err: any) {
    handleRouteError(res, err, 'snapshot_failed');
  }
});

// Long-term video pattern analysis across multiple nights
router.get('/:babyUid/video/patterns', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const birthdate = String(req.query.birthdate || '');
    const prematureWeeks = parseInt(String(req.query.premature_weeks)) || 0;
    const days = parseInt(String(req.query.days)) || 5;
    const bedtimeHour = parseInt(String(req.query.bedtime_hour)) || 19;
    const wakeHour = parseInt(String(req.query.wake_hour)) || 8;
    const tzOffset = parseInt(String(req.query.tz_offset)) || 0;

    if (!birthdate) {
      res.status(400).json({ error: 'bad_request', message: 'birthdate required' });
      return;
    }

    // Check Firestore cache (valid for 6 hours)
    const today = localNow(tzOffset).toISOString().split('T')[0];
    const profile = await getBabyProfile(babyUid);
    const cacheKey = `patterns:v2:${today}:${days}:p${profile.updated_at}`;
    const cached = await store.getCachedInsight(babyUid, cacheKey).catch(() => null);
    if (cached) {
      res.json({ patterns: cached, cached: true });
      return;
    }

    const adjAge = getAdjustedAgeMonths(birthdate, prematureWeeks);

    // Fetch all events once (covers the date range)
    let allEvents: any[] = [];
    try {
      const eventsData = await nanit.getEvents(token, babyUid, 100);
      allEvents = (eventsData.events || []);
    } catch (err: any) {
      console.log(`[patterns] Events fetch failed: ${err.message}`);
    }

    const scored = await loadScoredNights({ token, babyUid, days, birthdate, prematureWeeks, bedtimeHour, wakeHour, tzOffset });
    const nights: NightWithEvents[] = scored.map(n => ({
      date: n.date,
      score: n.score.total_score,
      total_sleep_minutes: n.score.details.total_sleep_minutes,
      wake_count: n.score.details.wake_count,
      longest_stretch_minutes: n.score.details.longest_stretch_minutes,
      events: allEvents
        .filter(e => e.time >= n.window.start && e.time <= n.window.end && e.media_urls?.thumbnail)
        .map(e => ({ key: e.key, title: e.title, time: e.time, thumbnail_url: e.media_urls?.thumbnail })),
    }));

    if (nights.length === 0) {
      res.json({ patterns: null, message: 'No sleep data found for the requested range' });
      return;
    }

    const totalEvents = nights.reduce((s, n) => s + n.events.length, 0);
    if (totalEvents === 0) {
      res.json({ patterns: null, message: 'No video events found across these nights' });
      return;
    }

    console.log(`[patterns] Analyzing ${nights.length} nights with ${totalEvents} total events`);

    await consumeAiBudget(babyUid, 'patterns');
    const result = await analyzeLongTermPatterns(nights, adjAge, tzOffset, profilePromptBlock(profile));

    // Cache for 6 hours
    await store.cacheInsight(babyUid, cacheKey, result as any).catch(() => {});

    res.json({ patterns: result, nights_analyzed: nights.length, events_analyzed: totalEvents });
  } catch (err: any) {
    console.error(`[patterns] Error:`, err.message);
    handleRouteError(res, err, 'patterns_failed');
  }
});

// Audio analysis — extract audio and classify infant vocalizations/cry type
router.post('/:babyUid/video/analyze-audio', requireToken, async (req, res) => {
  try {
    const babyUid = String(req.params.babyUid);
    const { clip_url, event_type, birthdate, premature_weeks } = req.body;

    if (!clip_url) {
      res.status(400).json({ error: 'bad_request', message: 'clip_url required' });
      return;
    }

    const hasFfmpeg = await video.checkFfmpeg();
    if (!hasFfmpeg) {
      res.status(503).json({ error: 'ffmpeg_not_found', message: 'ffmpeg required for audio extraction' });
      return;
    }

    const adjAge = getAdjustedAgeMonths(birthdate || '2026-02-07', premature_weeks || 0);

    const profile = await getBabyProfile(babyUid);
    // Cache by clip URL (strip query params) and profile version
    const cacheKey = `audio:${clip_url.split('?')[0].split('/').pop() || clip_url.slice(-40)}:p${profile.updated_at}`;
    const cached = await store.getCachedInsight(babyUid, cacheKey).catch(() => null);
    if (cached) {
      res.json({ analysis: cached, cached: true });
      return;
    }

    await consumeAiBudget(babyUid, 'audio');
    const { analyzeAudio } = await import('../services/audio-analysis.js');
    const analysis = await analyzeAudio(clip_url, event_type || 'unknown', adjAge, profilePromptBlock(profile));

    await store.cacheInsight(babyUid, cacheKey, analysis as any).catch(() => {});

    res.json({ analysis, cached: false });
  } catch (err: any) {
    console.error('[audio] Route error:', err.message);
    handleRouteError(res, err, 'audio_analysis_failed');
  }
});

export default router;
