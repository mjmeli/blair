import { Moon, Sun, LogOut, MessageSquare } from 'lucide-react';
import { FeedbackDialog } from '../common/FeedbackDialog';
import { useState, useEffect } from 'react';
import { logout } from '../../services/api';

export function Nav() {
  const [dark, setDark] = useState(() => localStorage.getItem('blair_theme') === 'dark');
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('blair_theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-700 dark:bg-slate-900/80">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <a href="/" className="text-xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400">
          blAIr
        </a>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setFeedbackOpen(true)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            title="Feedback & bug reports"
          >
            <MessageSquare size={18} /><span className="hidden sm:inline">Feedback</span>
          </button>
          <button
            onClick={() => setDark(!dark)}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            onClick={logout}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </nav>
  );
}
