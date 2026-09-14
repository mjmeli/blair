import { useState, useEffect } from 'react';
import { AlertTriangle, AlertCircle, Info, X, ChevronDown } from 'lucide-react';
import * as api from '../../services/api';
import { ErrorState } from '../common/ErrorState';
import { errorMessage } from '../../utils/errors';
import { todayStr } from '../../utils/date';
import type { RegressionAlert } from '../../services/api';
import type { Baby } from '../../types';

interface Props {
  baby: Baby | null;
  prematureWeeks: number;
  bedtimeHour: number;
  wakeHour: number;
}

// Format a value based on what metric it represents
function formatValue(value: number, metric: RegressionAlert['metric']): string {
  switch (metric) {
    case 'bedtime': {
      // value = minutes since midnight (local time)
      const h24 = Math.floor(value / 60);
      const m = value % 60;
      const ampm = h24 >= 12 ? 'PM' : 'AM';
      const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
      return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
    }
    case 'duration':
    case 'stretch': {
      // value = minutes
      const h = Math.floor(value / 60);
      const m = Math.round(value % 60);
      if (h === 0) return `${m}m`;
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    case 'score':
    case 'wakes':
    default:
      return String(value);
  }
}

// Label for the value (what is this number?)
function metricLabel(metric: RegressionAlert['metric']): string {
  switch (metric) {
    case 'bedtime': return 'Bedtime';
    case 'duration': return 'Total sleep';
    case 'stretch': return 'Longest stretch';
    case 'wakes': return 'Wake count';
    case 'score': return 'Score';
    default: return '';
  }
}

const SEVERITY_STYLES = {
  info: { bg: 'bg-sky-50 dark:bg-sky-950/40', border: 'border-sky-200 dark:border-sky-500/40', text: 'text-sky-800 dark:text-sky-300', accent: 'text-sky-600 dark:text-sky-400', Icon: Info },
  warning: { bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-500/40', text: 'text-amber-900 dark:text-amber-200', accent: 'text-amber-600 dark:text-amber-400', Icon: AlertTriangle },
  concern: { bg: 'bg-red-50 dark:bg-red-950/40', border: 'border-red-200 dark:border-red-500/40', text: 'text-red-900 dark:text-red-200', accent: 'text-red-600 dark:text-red-400', Icon: AlertCircle },
};

const DISMISSED_KEY = 'blair_dismissed_alerts';

function loadDismissed(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDismissed(map: Record<string, string>) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(map));
}

export function RegressionAlertsBanner({ baby, prematureWeeks, bedtimeHour, wakeHour }: Props) {
  const [alerts, setAlerts] = useState<RegressionAlert[]>([]);
  const [dismissed, setDismissed] = useState<Record<string, string>>(loadDismissed());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!baby) return;
    setError(null);
    api.getRegressionAlerts(baby.uid, baby.birthdate, prematureWeeks, bedtimeHour, wakeHour)
      .then(r => setAlerts(r.alerts || []))
      .catch(err => { setAlerts([]); setError(errorMessage(err)); });
  }, [baby, prematureWeeks, bedtimeHour, wakeHour, attempt]);

  // Dismissals are "for today" in the parent's local time, not UTC
  const today = todayStr();
  const visible = alerts.filter(a => dismissed[a.id] !== today);

  if (error) {
    return (
      <div className="mb-4">
        <ErrorState title="Couldn't check for sleep regressions" message={error} onRetry={() => setAttempt(a => a + 1)} compact />
      </div>
    );
  }

  if (visible.length === 0) return null;

  const dismissAlert = (id: string) => {
    const next = { ...dismissed, [id]: today };
    setDismissed(next);
    saveDismissed(next);
  };

  return (
    <div className="mb-4 space-y-2">
      {visible.map(alert => {
        const style = SEVERITY_STYLES[alert.severity];
        const Icon = style.Icon;
        const isExpanded = expanded === alert.id;

        return (
          <div
            key={alert.id}
            className={`rounded-lg border ${style.border} ${style.bg} overflow-hidden`}
          >
            <div className="flex items-start gap-3 p-3">
              <Icon size={18} className={`mt-0.5 shrink-0 ${style.accent}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${style.text}`}>{alert.title}</p>
                <p className={`mt-0.5 text-xs ${style.text} opacity-80`}>{alert.description}</p>
                {alert.recent_values && alert.recent_values.length > 0 && (
                  <button
                    onClick={() => setExpanded(isExpanded ? null : alert.id)}
                    className={`mt-1.5 flex items-center gap-1 text-[10px] ${style.accent} hover:underline`}
                  >
                    <ChevronDown size={10} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    {isExpanded ? 'Hide' : 'Show'} data
                  </button>
                )}
              </div>
              <button
                onClick={() => dismissAlert(alert.id)}
                className={`shrink-0 rounded p-1 ${style.text} opacity-60 hover:opacity-100`}
                title="Dismiss for today"
              >
                <X size={14} />
              </button>
            </div>
            {isExpanded && alert.recent_values && alert.recent_values.length > 0 && (
              <div className="border-t border-slate-200 dark:border-slate-700/50 p-3">
                <p className={`mb-1.5 text-[10px] uppercase tracking-wide ${style.accent}`}>
                  {metricLabel(alert.metric)}
                </p>
                <div className="flex gap-2 overflow-x-auto">
                  {alert.recent_values.map(v => (
                    <div key={v.date} className={`shrink-0 rounded bg-black/5 dark:bg-black/20 px-2 py-1 text-[10px] ${style.text}`}>
                      <div className="opacity-70">{v.date.slice(5)}</div>
                      <div className="font-mono font-semibold">{formatValue(v.value, alert.metric)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
