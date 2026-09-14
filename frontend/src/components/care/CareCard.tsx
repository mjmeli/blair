import { Baby, Droplets, Info } from 'lucide-react';
import { Card } from '../common/Card';
import { StatValue } from '../common/StatValue';
import type { CalendarEvent } from '../../types';

interface Props {
  events: CalendarEvent[];
  allTypes: string[];
  loading?: boolean;
}

export function CareCard({ events, allTypes, loading }: Props) {
  if (loading) {
    return (
      <Card title="Care">
        <div className="flex h-24 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      </Card>
    );
  }

  const feeds = events.filter(e => e.type === 'bottle_feed');
  const diapers = events.filter(e => e.type === 'diaper_change');
  const totalMl = feeds.reduce((sum, f) => sum + (f.feed_amount || 0), 0);
  const totalOz = Math.round(totalMl * 0.033814 * 10) / 10;

  if (feeds.length === 0 && diapers.length === 0) {
    return (
      <Card title="Care (24h)">
        <div className="space-y-2">
          <p className="text-sm text-slate-400">No feed or diaper data logged for this date.</p>
          {allTypes.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-900">
              <Info size={14} className="mt-0.5 shrink-0 text-slate-400" />
              <p className="text-xs text-slate-500">
                Calendar types found: {allTypes.join(', ')}
              </p>
            </div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card title="Care (24h)">
      <div className="grid grid-cols-2 gap-4">
        <StatValue
          icon={<Baby size={16} />}
          label="Feeds"
          value={feeds.length}
          sub={totalMl > 0 ? `${totalMl}ml / ${totalOz}oz` : undefined}
        />
        <StatValue
          icon={<Droplets size={16} />}
          label="Diapers"
          value={diapers.length}
          sub={`${diapers.filter(d => d.change_type === 'poo' || d.change_type === 'mixed').length} poo`}
        />
      </div>
    </Card>
  );
}
