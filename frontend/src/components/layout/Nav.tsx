import { Moon, Sun, LogOut } from 'lucide-react';
import { useState, useEffect } from 'react';
import { logout } from '../../services/api';

export function Nav() {
  const [dark, setDark] = useState(() => localStorage.getItem('blair_theme') === 'dark');

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
    </nav>
  );
}
