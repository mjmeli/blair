import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

interface Props {
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
}

/** Inline error block with an optional retry button. Use instead of silently rendering an empty state. */
export function ErrorState({ title = "Couldn't load this", message, onRetry, retrying, compact }: Props) {
  return (
    <div className={`rounded-lg border border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-950/30 ${compact ? 'p-2 space-y-1' : 'p-3 space-y-2'}`}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
        <AlertCircle size={12} /> {title}
      </p>
      <p className="text-[11px] text-red-800 dark:text-red-300/80">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={retrying}
          className="flex items-center gap-1.5 rounded-lg bg-red-100 px-2.5 py-1 text-[11px] font-medium text-red-900 transition hover:bg-red-200 disabled:opacity-50 dark:bg-red-600/20 dark:text-red-200 dark:hover:bg-red-600/30"
        >
          {retrying ? <><Loader2 size={11} className="animate-spin" /> Retrying…</> : <><RefreshCw size={11} /> Retry</>}
        </button>
      )}
    </div>
  );
}
