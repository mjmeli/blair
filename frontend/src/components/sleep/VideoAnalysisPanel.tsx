import { Eye, Film, Shield, AlertTriangle, Home, RotateCw } from 'lucide-react';
import type { VideoAnalysis } from '../../services/api';

interface Props {
  analysis: VideoAnalysis;
  compact?: boolean;
}

function stillnessBars(score: number) {
  const clamped = Math.max(1, Math.min(5, Math.round(score)));
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          className={`h-2 w-2 rounded-sm transition ${
            i <= clamped
              ? clamped >= 4
                ? 'bg-emerald-400'
                : clamped === 3
                  ? 'bg-amber-400'
                  : 'bg-red-400'
              : 'bg-slate-200 dark:bg-slate-700'
          }`}
        />
      ))}
    </div>
  );
}

function stillnessLabel(score: number): string {
  const s = Math.round(score);
  if (s >= 5) return 'Very still';
  if (s >= 4) return 'Restful';
  if (s >= 3) return 'Moderate';
  if (s >= 2) return 'Restless';
  return 'Very restless';
}

export function VideoAnalysisPanel({ analysis, compact = false }: Props) {
  const hasData =
    analysis.positions_observed?.length > 0 ||
    analysis.environment_observations?.length > 0 ||
    analysis.observations?.length > 0 ||
    analysis.safety_alerts?.length > 0 ||
    analysis.stillness_score > 0;

  if (!hasData) return null;

  const textSize = compact ? 'text-[10px]' : 'text-xs';
  const headingSize = compact ? 'text-[10px]' : 'text-xs';
  const iconSize = compact ? 10 : 12;
  const padding = compact ? 'p-2' : 'p-3';

  return (
    <div className={`rounded-lg border border-violet-200 dark:border-violet-500/20 bg-violet-50 dark:bg-violet-950/20 ${padding} space-y-3`}>
      <div className="flex items-center justify-between">
        <p className={`flex items-center gap-1.5 ${headingSize} font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400`}>
          <Film size={iconSize} /> Video Analysis
        </p>
      </div>

      {/* Safety alerts — top priority */}
      {analysis.safety_alerts && analysis.safety_alerts.length > 0 && (
        <div className="rounded border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-950/40 p-2">
          <p className={`mb-1 flex items-center gap-1 ${headingSize} font-semibold uppercase tracking-wide text-red-600 dark:text-red-400`}>
            <AlertTriangle size={iconSize} /> Safety
          </p>
          <ul className="space-y-0.5">
            {analysis.safety_alerts.map((alert, i) => (
              <li key={i} className={`${textSize} text-red-800 dark:text-red-300`}>• {alert}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Stillness + Position row */}
      <div className={`grid gap-3 ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'}`}>
        {analysis.stillness_score > 0 && (
          <div className="flex items-center gap-2">
            <Eye size={iconSize + 2} className="shrink-0 text-violet-600 dark:text-violet-400" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {stillnessBars(analysis.stillness_score)}
                <span className={`${textSize} font-medium text-slate-800 dark:text-slate-200`}>{stillnessLabel(analysis.stillness_score)}</span>
              </div>
              {analysis.stillness_description && (
                <p className={`${textSize} mt-0.5 text-slate-600 dark:text-slate-400`}>{analysis.stillness_description}</p>
              )}
            </div>
          </div>
        )}

        {(analysis.dominant_position || analysis.positions_observed?.length > 0) && (
          <div className="flex items-center gap-2">
            <RotateCw size={iconSize + 2} className="shrink-0 text-indigo-600 dark:text-indigo-400" />
            <div className="min-w-0 flex-1">
              <p className={`${textSize} font-medium text-slate-800 dark:text-slate-200`}>
                {analysis.dominant_position || analysis.positions_observed?.[0] || 'Unknown'}
              </p>
              <p className={`${textSize} text-slate-600 dark:text-slate-400`}>
                {analysis.position_changes > 0
                  ? `${analysis.position_changes} position change${analysis.position_changes === 1 ? '' : 's'}`
                  : 'No position changes detected'}
                {analysis.positions_observed && analysis.positions_observed.length > 1 && (
                  <span className="ml-1 text-slate-500">({analysis.positions_observed.join(', ')})</span>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Environment */}
      {analysis.environment_observations && analysis.environment_observations.length > 0 && (
        <div>
          <p className={`mb-1 flex items-center gap-1 ${headingSize} font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400`}>
            <Home size={iconSize} /> Environment
          </p>
          <ul className="space-y-0.5">
            {analysis.environment_observations.map((obs, i) => (
              <li key={i} className={`${textSize} text-slate-600 dark:text-slate-400`}>• {obs}</li>
            ))}
          </ul>
        </div>
      )}

      {/* General observations */}
      {analysis.observations && analysis.observations.length > 0 && (
        <div>
          <p className={`mb-1 flex items-center gap-1 ${headingSize} font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400`}>
            <Shield size={iconSize} /> Observations
          </p>
          <ul className="space-y-0.5">
            {analysis.observations.map((obs, i) => (
              <li key={i} className={`${textSize} text-slate-600 dark:text-slate-400`}>• {obs}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
