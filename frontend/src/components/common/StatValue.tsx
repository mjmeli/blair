import type { ReactNode } from 'react';

interface StatValueProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  sub?: string;
}

export function StatValue({ label, value, icon, sub }: StatValueProps) {
  return (
    <div className="flex items-start gap-3">
      {icon && <div className="mt-0.5 text-slate-400 dark:text-slate-500">{icon}</div>}
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-lg font-semibold text-slate-800 dark:text-white">{value}</p>
        {sub && <p className="text-xs text-slate-400 dark:text-slate-500">{sub}</p>}
      </div>
    </div>
  );
}
