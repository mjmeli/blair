import { FieldValue } from 'firebase-admin/firestore';
import { config } from '../config.js';
import { db } from './firestore.js';
const usageCol = () => db.collection('ai_usage');

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
  const babyRef = usageCol().doc(`${day}:${babyUid}`);
  const globalRef = usageCol().doc(`${day}:global`);
  const { perBabyPerDay, globalPerDay } = config.aiBudget;

  await db.runTransaction(async tx => {
    const [babyDoc, globalDoc] = await Promise.all([tx.get(babyRef), tx.get(globalRef)]);
    const babyCount = (babyDoc.data()?.count as number) ?? 0;
    const globalCount = (globalDoc.data()?.count as number) ?? 0;
    if (babyCount >= perBabyPerDay) throw new AiBudgetError('baby');
    if (globalCount >= globalPerDay) throw new AiBudgetError('global');
    tx.set(babyRef, { day, baby_uid: babyUid, count: FieldValue.increment(1), [`by_label.${label}`]: FieldValue.increment(1), updated_at: Date.now() }, { merge: true });
    tx.set(globalRef, { day, count: FieldValue.increment(1), [`by_label.${label}`]: FieldValue.increment(1), updated_at: Date.now() }, { merge: true });
  });
}
