import { useState, useEffect } from 'react';
import { Award } from 'lucide-react';
import { Card } from '../common/Card';
import { ErrorState } from '../common/ErrorState';
import { errorMessage } from '../../utils/errors';
import * as api from '../../services/api';
import type { Milestone } from '../../services/api';
import type { Baby } from '../../types';

interface Props {
  baby: Baby | null;
  prematureWeeks: number;
  bedtimeHour: number;
  wakeHour: number;
}

const KIND_STYLES: Record<Milestone['kind'], string> = {
  record: 'border-amber-200 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300',
  streak: 'border-indigo-200 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-300',
  first: 'border-emerald-200 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300',
  improvement: 'border-violet-200 dark:border-violet-500/40 bg-violet-50 dark:bg-violet-950/30 text-violet-800 dark:text-violet-300',
};

export function MilestonesCard({ baby, prematureWeeks, bedtimeHour, wakeHour }: Props) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!baby) return;
    setLoading(true);
    setError(null);
    api.getMilestones(baby.uid, baby.birthdate, prematureWeeks, 14, bedtimeHour, wakeHour)
      .then(result => setMilestones(result.milestones || []))
      .catch(err => { setMilestones([]); setError(errorMessage(err)); })
      .finally(() => setLoading(false));
  }, [baby, prematureWeeks, bedtimeHour, wakeHour, attempt]);

  if (loading) {
    return (
      <Card title="Milestones">
        <div className="flex h-20 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Milestones" action={<Award size={14} className="text-amber-600 dark:text-amber-400" />}>
        <ErrorState message={error} onRetry={() => setAttempt(a => a + 1)} compact />
      </Card>
    );
  }

  if (milestones.length === 0) {
    return (
      <Card title="Milestones" action={<Award size={14} className="text-amber-600 dark:text-amber-400" />}>
        <p className="py-3 text-center text-xs text-slate-600 dark:text-slate-400">
          Keep tracking — milestones appear as trends develop.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title={`Milestones (${milestones.length})`}
      action={<Award size={14} className="text-amber-600 dark:text-amber-400" />}
    >
      <div className="space-y-2">
        {milestones.map(m => (
          <div
            key={m.id}
            className={`rounded-lg border p-2.5 ${KIND_STYLES[m.kind]}`}
          >
            <div className="flex items-start gap-2.5">
              <span className="text-lg leading-none">{m.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">{m.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed opacity-80">{m.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
