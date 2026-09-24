import { config } from '../config.js';
import { store } from './store.js';

export class AiBudgetError extends Error {
  status = 429;
  constructor(scope: 'baby' | 'global') {
    super(
      scope === 'baby'
        ? "You've hit today's AI analysis limit for this baby. Cached results still work; new analyses reset at midnight UTC."
        : "The app's shared AI budget for today is used up. Cached results still work; it resets at midnight UTC.",
    );
    this.name = 'AiBudgetError';
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Reserve one AI call for this baby today. Throws AiBudgetError when either
 * the per-baby or the global daily cap is reached. Call it right before the
 * model request, after cache checks, so cached responses stay free.
 */
export async function consumeAiBudget(babyUid: string, label: string): Promise<void> {
  const day = todayKey();
  const { perBabyPerDay, globalPerDay } = config.aiBudget;
  const exceeded = await store.reserveAiCall(day, babyUid, label, perBabyPerDay, globalPerDay);
  if (exceeded) throw new AiBudgetError(exceeded);
}
