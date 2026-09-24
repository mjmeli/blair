import { Router } from 'express';
import * as nanit from '../services/nanit-client.js';
import * as store from '../services/store.js';
import type { BabySettings } from '../services/storage.js';
import { DEFAULT_PROFILE, type BabyMilestones, type Pronouns, type Sleepwear } from '../services/baby-context.js';
import { requireToken } from '../middleware/auth.js';
import { handleRouteError } from '../middleware/errorHandler.js';
import { recordActiveBaby } from '../services/stats.js';

const router = Router();

router.get('/', requireToken, async (req, res) => {
  try {
    const token = (req as any).nanitToken;
    const result = await nanit.getBabies(token);
    for (const b of result.babies ?? []) recordActiveBaby(b.uid);
    res.json(result);
  } catch (err: any) {
    handleRouteError(res, err, 'fetch_failed');
  }
});

// Sleep settings + developmental profile for a baby (synced across devices)
router.get('/:babyUid/settings', requireToken, async (req, res) => {
  try {
    const babyUid = String(req.params.babyUid);
    const settings = await store.getBabySettings(babyUid);
    res.json({ settings });
  } catch (err: any) {
    handleRouteError(res, err, 'settings_failed');
  }
});

const SLEEPWEAR: Sleepwear[] = ['swaddle', 'sleep_sack', 'none'];
const PRONOUNS: Pronouns[] = ['they', 'she', 'he'];
const MILESTONE_KEYS: (keyof BabyMilestones)[] = ['rolls_back_to_belly', 'rolls_belly_to_back', 'sits_unassisted', 'pulls_to_stand'];

router.put('/:babyUid/settings', requireToken, async (req, res) => {
  try {
    const babyUid = String(req.params.babyUid);
    const b = req.body ?? {};
    const num = (v: unknown, lo: number, hi: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined;

    const milestones: Partial<BabyMilestones> = {};
    if (b.milestones && typeof b.milestones === 'object') {
      for (const k of MILESTONE_KEYS) {
        if (typeof b.milestones[k] === 'boolean') milestones[k] = b.milestones[k];
      }
    }

    const settings: BabySettings = {
      baby_uid: babyUid,
      name: typeof b.name === 'string' ? b.name.trim().slice(0, 40) : undefined,
      pronouns: PRONOUNS.includes(b.pronouns) ? b.pronouns : undefined,
      bedtime_hour: num(b.bedtime_hour, 0, 23),
      wake_hour: num(b.wake_hour, 0, 23),
      premature_weeks: num(b.premature_weeks, 0, 16),
      milestones: { ...DEFAULT_PROFILE.milestones, ...milestones },
      sleepwear: SLEEPWEAR.includes(b.sleepwear) ? b.sleepwear : undefined,
      pacifier: typeof b.pacifier === 'boolean' ? b.pacifier : undefined,
      notes: typeof b.notes === 'string' ? b.notes.slice(0, 1000) : undefined,
      updated_at: Date.now(),
    };
    await store.saveBabySettings(settings);
    res.json({ settings });
  } catch (err: any) {
    handleRouteError(res, err, 'settings_failed');
  }
});

export default router;
