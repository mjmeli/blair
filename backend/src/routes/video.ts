import { Router } from 'express';
import { readFile } from 'fs/promises';
import { requireToken } from '../middleware/auth.js';
import { handleRouteError } from '../middleware/errorHandler.js';
import * as video from '../services/video-stream.js';
import * as nanit from '../services/nanit-client.js';
import * as gemini from '../services/gemini-video.js';
import { buildNightSummaries, scoreNight, getAdjustedAgeMonths } from '../services/sleep-scorer.js';
import { analyzeLongTermPatterns, type NightWithEvents } from '../services/video-patterns.js';
import * as store from '../services/firestore.js';

const router = Router();

// Check video capabilities
router.get('/:babyUid/video/status', requireToken, async (_req, res) => {
  const hasFfmpeg = await video.checkFfmpeg();
  res.json({
    ffmpeg_available: hasFfmpeg,
    gemini_available: !!process.env.GEMINI_API_KEY,
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

// Debug: probe all possible video-related endpoints and return raw structures
router.get('/:babyUid/video/debug', requireToken, async (req, res) => {
  const token = (req as any).nanitToken;
  const babyUid = String(req.params.babyUid);
  const results: Record<string, any> = {};

  // 1. Try /events endpoint
  try {
    const eventsData = await nanit.getEvents(token, babyUid, 5);
    results.events = {
      top_keys: Object.keys(eventsData),
      sample: eventsData,
    };
  } catch (e: any) {
    results.events = { error: e.message };
  }

  // 2. Try fetching individual event by UID from a message
  try {
    const msgs = await nanit.getMessages(token, babyUid, 3);
    if (msgs.messages?.length > 0) {
      const msg = msgs.messages[0];
      results.message_sample = {
        type: msg.type,
        data: msg.data,
        all_keys: Object.keys(msg),
      };
      // Try to get individual event using event UID from message data
      const eventUid = (msg.data as any)?.event?.uid;
      if (eventUid) {
        try {
          const eventData = await nanit.getEvent(token, babyUid, eventUid);
          results.individual_event = {
            top_keys: Object.keys(eventData),
            sample: eventData,
          };
        } catch (e: any) {
          results.individual_event = { error: e.message };
        }
      }
    }
  } catch (e: any) {
    results.messages = { error: e.message };
  }

  // 3. Try some speculative endpoints
  const speculativeEndpoints = [
    `/babies/${babyUid}/clips`,
    `/babies/${babyUid}/recordings`,
    `/babies/${babyUid}/videos`,
    `/babies/${babyUid}/moments`,
  ];

  for (const ep of speculativeEndpoints) {
    try {
      const r = await fetch(`https://api.nanit.com${ep}?limit=3`, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Nanit/6.0.0 (iOS; iPhone; Scale/2.00)',
          'nanit-api-version': '1',
          'Authorization': `token ${token}`,
        },
      });
      if (r.ok) {
        const data = await r.json();
        results[ep] = { status: r.status, top_keys: Object.keys(data), sample_truncated: JSON.stringify(data).slice(0, 1000) };
      } else {
        results[ep] = { status: r.status, statusText: r.statusText };
      }
    } catch (e: any) {
      results[ep] = { error: e.message };
    }
  }

  res.json(results);
});

// Analyze a specific event's video clip with Gemini
router.post('/:babyUid/video/analyze', requireToken, async (req, res) => {
  try {
    const babyUid = String(req.params.babyUid);
    const { clip_url, thumbnail_url, event_type, event_title, birthdate, premature_weeks } = req.body;

    if (!clip_url && !thumbnail_url) {
      res.status(400).json({ error: 'bad_request', message: 'clip_url or thumbnail_url required' });
      return;
    }

    const adjAge = getAdjustedAgeMonths(birthdate || '2026-02-07', premature_weeks || 0);

    // Check Firestore cache
    const urlForCache = clip_url || thumbnail_url;
    const cacheKey = urlForCache.split('?')[0].split('/').pop() || urlForCache.slice(-40);
    const cached = await store.getCachedInsight(babyUid, `video:${cacheKey}`).catch(() => null);
    if (cached) {
      res.json({ analysis: cached, cached: true });
      return;
    }

    console.log(`[video] Analyzing event: ${event_type} - ${event_title}`);

    let analysis;
    if (clip_url) {
      analysis = await gemini.analyzeVideoClip(
        clip_url,
        thumbnail_url || null,
        event_type || 'unknown',
        event_title || '',
        adjAge,
      );
    } else {
      analysis = await gemini.analyzeFromThumbnail(
        thumbnail_url,
        event_type || 'unknown',
        event_title || '',
        adjAge,
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
    const today = new Date(Date.now() - tzOffset * 60 * 1000).toISOString().split('T')[0];
    const cacheKey = `patterns:${today}:${days}`;
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

    // Build night data for the last N nights
    const nowMs = Date.now() + tzOffset * 60 * 1000;
    const nights: NightWithEvents[] = [];

    for (let d = days; d >= 1; d--) {
      const pastMs = nowMs - d * 86400000;
      const pastDate = new Date(pastMs);
      const y = pastDate.getUTCFullYear();
      const m = pastDate.getUTCMonth();
      const day = pastDate.getUTCDate();
      const utcStart = Date.UTC(y, m, day, bedtimeHour, 0, 0);
      const utcEnd = Date.UTC(y, m, day + 1, wakeHour + 4, 0, 0);
      const ns = Math.floor((utcStart + tzOffset * 60 * 1000) / 1000);
      const ne = Math.floor((utcEnd + tzOffset * 60 * 1000) / 1000);
      const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      try {
        const calData = await nanit.getCalendarEvents(token, babyUid, ns, ne);
        const sleepEntries = calData.calendar.filter((e: any) => e.type === 'auto_sleep');
        const summaries = buildNightSummaries(sleepEntries);
        if (summaries.length === 0) continue;

        const best = summaries.reduce((b, n) => n.total_duration_minutes > b.total_duration_minutes ? n : b, summaries[0]);
        const score = scoreNight(best, birthdate, prematureWeeks, undefined, tzOffset);

        const nightEvents = allEvents
          .filter(e => e.time >= ns && e.time <= ne && e.media_urls?.thumbnail)
          .map(e => ({
            key: e.key,
            title: e.title,
            time: e.time,
            thumbnail_url: e.media_urls?.thumbnail,
          }));

        nights.push({
          date: dateStr,
          score: score.total_score,
          total_sleep_minutes: score.details.total_sleep_minutes,
          wake_count: score.details.wake_count,
          longest_stretch_minutes: score.details.longest_stretch_minutes,
          events: nightEvents,
        });
      } catch (err: any) {
        console.log(`[patterns] Night ${dateStr} failed: ${err.message}`);
      }
    }

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

    const result = await analyzeLongTermPatterns(nights, adjAge, tzOffset);

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

    // Cache by clip URL (strip query params)
    const cacheKey = `audio:${clip_url.split('?')[0].split('/').pop() || clip_url.slice(-40)}`;
    const cached = await store.getCachedInsight(babyUid, cacheKey).catch(() => null);
    if (cached) {
      res.json({ analysis: cached, cached: true });
      return;
    }

    const { analyzeAudio } = await import('../services/audio-analysis.js');
    const analysis = await analyzeAudio(clip_url, event_type || 'unknown', adjAge);

    await store.cacheInsight(babyUid, cacheKey, analysis as any).catch(() => {});

    res.json({ analysis, cached: false });
  } catch (err: any) {
    console.error('[audio] Route error:', err.message);
    handleRouteError(res, err, 'audio_analysis_failed');
  }
});

export default router;
