import { Router } from 'express';
import * as nanit from '../services/nanit-client.js';
import { requireToken } from '../middleware/auth.js';
import { handleRouteError } from '../middleware/errorHandler.js';

const router = Router();

router.get('/:babyUid/care', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const start = parseInt(String(req.query.start));
    const end = parseInt(String(req.query.end));
    if (!start || !end) {
      res.status(400).json({ error: 'bad_request', message: 'start and end query params required (unix timestamps)' });
      return;
    }
    const result = await nanit.getCalendarEvents(token, babyUid, start, end);
    // Filter to only care events (exclude sleep)
    const careEvents = result.calendar.filter(
      e => e.type !== 'auto_sleep'
    );
    res.json({ events: careEvents, all_types: [...new Set(result.calendar.map(e => e.type))] });
  } catch (err: any) {
    handleRouteError(res, err, 'fetch_failed');
  }
});

export default router;
