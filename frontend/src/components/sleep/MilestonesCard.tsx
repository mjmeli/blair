import { useState, useEffect } from 'react';
import { Award } from 'lucide-react';
import { Card } from '../common/Card';
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
  record: 'border-amber-500/40 bg-amber-950/30 text-amber-300',
  streak: 'border-indigo-500/40 bg-indigo-950/30 text-indigo-300',
  first: 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300',
  improvement: 'border-violet-500/40 bg-violet-950/30 text-violet-300',
};

export function MilestonesCard({ baby, prematureWeeks, bedtimeHour, wakeHour }: Props) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!baby) return;
    setLoading(true);
    api.getMilestones(baby.uid, baby.birthdate, prematureWeeks, 14, bedtimeHour, wakeHour)
      .then(result => setMilestones(result.milestones || []))
      .catch(() => setMilestones([]))
      .finally(() => setLoading(false));
  }, [baby, prematureWeeks, bedtimeHour, wakeHour]);

  if (loading) {
    return (
      <Card title="Milestones">
        <div className="flex h-20 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        </div>
      </Card>
    );
  }

  if (milestones.length === 0) {
    return (
      <Card title="Milestones" action={<Award size={14} className="text-amber-400" />}>
        <p className="py-3 text-center text-xs text-slate-400">
          Keep tracking — milestones appear as trends develop.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title={`Milestones (${milestones.length})`}
      action={<Award size={14} className="text-amber-400" />}
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
