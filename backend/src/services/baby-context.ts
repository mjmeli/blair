import * as store from './firestore.js';

/**
 * Parent-provided facts about the baby that change how the AI should read the
 * data — most importantly whether belly/side sleeping is a safety concern.
 */
export interface BabyMilestones {
  rolls_back_to_belly: boolean;
  rolls_belly_to_back: boolean;
  sits_unassisted: boolean;
  pulls_to_stand: boolean;
}

export type Sleepwear = 'swaddle' | 'sleep_sack' | 'none';

export interface BabyProfile {
  milestones: BabyMilestones;
  sleepwear: Sleepwear;
  pacifier: boolean;
  notes: string;
  updated_at: number;
}

export const DEFAULT_PROFILE: BabyProfile = {
  milestones: { rolls_back_to_belly: false, rolls_belly_to_back: false, sits_unassisted: false, pulls_to_stand: false },
  sleepwear: 'sleep_sack',
  pacifier: false,
  notes: '',
  updated_at: 0,
};

export async function getBabyProfile(babyUid: string): Promise<BabyProfile> {
  const s = await store.getBabySettings(babyUid).catch(() => null);
  if (!s) return DEFAULT_PROFILE;
  return {
    milestones: { ...DEFAULT_PROFILE.milestones, ...(s.milestones ?? {}) },
    sleepwear: s.sleepwear ?? DEFAULT_PROFILE.sleepwear,
    pacifier: s.pacifier ?? DEFAULT_PROFILE.pacifier,
    notes: s.notes ?? '',
    updated_at: s.updated_at ?? 0,
  };
}

const yn = (b: boolean) => (b ? 'yes' : 'no');

/**
 * Prompt block describing the parent's context. Written so the model treats
 * it as ground truth and adjusts its safety judgments accordingly.
 */
export function profilePromptBlock(p: BabyProfile): string {
  const m = p.milestones;
  const rollsBoth = m.rolls_back_to_belly && m.rolls_belly_to_back;
  const lines: string[] = [];

  lines.push(`- Rolling: back-to-belly ${yn(m.rolls_back_to_belly)}, belly-to-back ${yn(m.rolls_belly_to_back)}.`);
  if (rollsBoth) {
    lines.push('  => Rolls both ways independently. Sleeping on the stomach or side is developmentally appropriate for this baby. Do NOT flag stomach or side sleeping as a safety concern or position issue; describe it neutrally.');
  } else if (m.rolls_back_to_belly || m.rolls_belly_to_back) {
    lines.push('  => Rolls only one way so far. If you see the baby on their stomach, mention it briefly as something to watch (once they roll both ways it becomes fine), not as an alarm.');
  } else {
    lines.push('  => Not rolling yet. Stomach or side sleeping IS worth flagging as a safety concern.');
  }

  lines.push(`- Sits unassisted: ${yn(m.sits_unassisted)}. Pulls to stand: ${yn(m.pulls_to_stand)}.`);
  if (m.pulls_to_stand) {
    lines.push('  => Standing in the crib is expected; only flag hazards a standing baby could reach (mobiles, cords, items on nearby furniture).');
  }

  const wear = p.sleepwear === 'swaddle' ? 'swaddle' : p.sleepwear === 'sleep_sack' ? 'wearable sleep sack' : 'none (pajamas only)';
  lines.push(`- Sleepwear: ${wear}.`);
  if (p.sleepwear === 'sleep_sack') {
    lines.push('  => A sleep sack is expected and safe; do not describe it as a loose blanket or covering.');
  }
  if (p.sleepwear === 'swaddle' && (m.rolls_back_to_belly || m.rolls_belly_to_back)) {
    lines.push('  => The baby is swaddled but has started rolling. This IS worth flagging gently: swaddling should stop once rolling begins.');
  }

  lines.push(`- Pacifier: ${yn(p.pacifier)}.${p.pacifier ? ' A pacifier in the crib is expected, not an object hazard.' : ''}`);

  if (p.notes.trim()) {
    lines.push(`- Notes from the parent: "${p.notes.trim().slice(0, 600)}"`);
  }

  return `PARENT-PROVIDED CONTEXT (treat as ground truth; adjust your judgments to it and never re-flag things the parent has established as normal):\n${lines.join('\n')}`;
}
