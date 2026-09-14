import { Activity, Volume2 } from 'lucide-react';
import { Card } from '../common/Card';
import { StatValue } from '../common/StatValue';
import type { NanitMessage } from '../../types';

interface Props {
  messages: NanitMessage[];
  loading?: boolean;
}

export function EventsCard({ messages, loading }: Props) {
  if (loading) {
    return (
      <Card title="Events">
        <div className="flex h-24 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      </Card>
    );
  }

  const motion = messages.filter(m => m.type === 'MOTION');
  const sound = messages.filter(m => m.type === 'SOUND');

  return (
    <Card title="Events (24h)">
      <div className="grid grid-cols-2 gap-4">
        <StatValue
          icon={<Activity size={16} />}
          label="Motion"
          value={motion.length}
          sub="events detected"
        />
        <StatValue
          icon={<Volume2 size={16} />}
          label="Sound"
          value={sound.length}
          sub="events detected"
        />
      </div>
    </Card>
  );
}
