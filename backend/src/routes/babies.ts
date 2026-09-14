import { Router } from 'express';
import * as nanit from '../services/nanit-client.js';
import { requireToken } from '../middleware/auth.js';
import { handleRouteError } from '../middleware/errorHandler.js';

const router = Router();

router.get('/', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const result = await nanit.getBabies(token);
    res.json(result);
  } catch (err: any) {
    handleRouteError(res, err, 'fetch_failed');
  }
});

export default router;
