import { useState } from 'react';
import { getAnalyticsChoice, setAnalyticsChoice } from '../../analytics';

/** One-time bottom bar asking whether Google Analytics may count the visit. */
export function AnalyticsConsent() {
  const [choice, setChoice] = useState(getAnalyticsChoice);
  if (choice) return null;

  const decide = (c: 'granted' | 'denied') => { setAnalyticsChoice(c); setChoice(c); };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[90] border-t border-slate-200 bg-white/95 p-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-600 dark:text-slate-300">
          Can I use Google Analytics to count visits? It helps me see whether anyone's using this. No sleep data or account details are sent, and you can change this in Settings.
        </p>
        <div className="flex shrink-0 gap-2">
          <button onClick={() => decide('denied')} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">No thanks</button>
          <button onClick={() => decide('granted')} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">Allow</button>
        </div>
      </div>
    </div>
  );
}
