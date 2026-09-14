import { Router } from 'express';
import * as nanit from '../services/nanit-client.js';
import { requireToken } from '../middleware/auth.js';
import { handleRouteError } from '../middleware/errorHandler.js';

const router = Router();

router.get('/:babyUid/events', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const babyUid = String(req.params.babyUid);
    const limit = parseInt(String(req.query.limit)) || 100;
    const result = await nanit.getMessages(token, babyUid, limit);

    // Optionally filter by type
    const typeFilter = String(req.query.type || '');
    if (typeFilter) {
      const types = typeFilter.toUpperCase().split(',');
      result.messages = result.messages.filter(m => types.includes(m.type));
    }

    res.json(result);
  } catch (err: any) {
    handleRouteError(res, err, 'fetch_failed');
  }
});

export default router;
