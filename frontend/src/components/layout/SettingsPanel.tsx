import { Settings, X, Baby, Clock, Sparkles } from 'lucide-react';
import type { SleepSettings, BabyMilestones, Sleepwear, Pronouns } from '../../hooks/useSettings';
import { adjustedAgeMonths } from '../../hooks/useSettings';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: SleepSettings;
  onUpdate: (patch: Partial<SleepSettings>) => void;
  birthdate?: string;
  /** Name from the Nanit account, shown as a placeholder */
  nanitName?: string;
}

function hourLabel(h: number): string {
  if (h === 0) return '12:00 AM';
  if (h === 12) return '12:00 PM';
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
}

function ageLabel(months: number): string {
  if (months < 1) return `${Math.round(months * 4.33)} weeks`;
  if (months < 12) return `${Math.round(months * 10) / 10} months`;
  const y = Math.floor(months / 12);
  const m = Math.round(months % 12);
  return m > 0 ? `${y}y ${m}m` : `${y}y`;
}

// What the scoring expects at this adjusted age
function ageExpectationSummary(adjMonths: number): string {
  if (adjMonths < 1) return '3-5 night wakes normal, 2.5h+ longest stretch is great';
  if (adjMonths < 2) return '3-4 night wakes normal, 3h+ longest stretch is great';
  if (adjMonths < 3) return '2-3 night wakes normal, 3h+ longest stretch is great';
  if (adjMonths < 4) return '2-3 night wakes normal, 3-4h stretch expected';
  if (adjMonths < 6) return '1-2 night wakes normal, 4h+ stretch expected';
  if (adjMonths < 9) return '0-1 night wakes normal, 6h+ stretch expected';
  if (adjMonths < 12) return '0-1 night wakes normal, 8h+ stretch expected';
  return '0 wakes expected, sleeping through the night';
}

const MILESTONE_OPTIONS: { key: keyof BabyMilestones; label: string; hint?: string }[] = [
  { key: 'rolls_back_to_belly', label: 'Rolls from back to belly' },
  { key: 'rolls_belly_to_back', label: 'Rolls from belly to back' },
  { key: 'sits_unassisted', label: 'Sits up without help' },
  { key: 'pulls_to_stand', label: 'Pulls up to standing', hint: 'Standing in the crib becomes expected; only reachable hazards get flagged.' },
];

export function SettingsPanel({ open, onClose, settings, onUpdate, birthdate, nanitName }: Props) {
  if (!open) return null;

  const adjAge = birthdate ? adjustedAgeMonths(birthdate, settings.prematureWeeks) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 pt-12 pb-12" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-800"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-indigo-500" />
            <h2 className="text-lg font-semibold text-slate-800 dark:text-white">Settings</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-6">
          {/* Baby Profile Section */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Baby size={16} className="text-pink-400" />
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Baby Profile</h3>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Name in AI insights</label>
                <input
                  type="text"
                  value={settings.babyName}
                  onChange={e => onUpdate({ babyName: e.target.value.slice(0, 40) })}
                  placeholder={nanitName ? `e.g. ${nanitName}` : 'Optional'}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder:text-slate-500"
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Leave blank and the AI just says "baby". It will never make up a name.</p>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Pronouns</label>
                <select
                  value={settings.pronouns}
                  onChange={e => onUpdate({ pronouns: e.target.value as Pronouns })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                >
                  <option value="they">they/them</option>
                  <option value="she">she/her</option>
                  <option value="he">he/him</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Weeks premature
              </label>
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                How many weeks early was your baby born? This adjusts all sleep expectations to use developmental age instead of chronological age. Set to 0 for full-term babies.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={16}
                  value={settings.prematureWeeks}
                  onChange={e => onUpdate({ prematureWeeks: Number(e.target.value) })}
                  className="flex-1 accent-indigo-500"
                />
                <span className="w-16 text-right text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {settings.prematureWeeks}w
                </span>
              </div>
            </div>

            {adjAge !== null && settings.prematureWeeks > 0 && (
              <div className="mt-3 rounded-lg bg-pink-50 p-3 dark:bg-pink-950/30">
                <p className="text-xs text-pink-700 dark:text-pink-300">
                  <strong>Adjusted age: {ageLabel(adjAge)}</strong>
                </p>
                <p className="mt-1 text-xs text-pink-600/70 dark:text-pink-400/70">
                  Scoring uses adjusted age for all expectations. At this age: {ageExpectationSummary(adjAge)}
                </p>
              </div>
            )}

            {adjAge !== null && settings.prematureWeeks === 0 && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  At {ageLabel(adjAge)}: {ageExpectationSummary(adjAge)}
                </p>
              </div>
            )}
          </div>

          {/* Sleep Window Section */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Clock size={16} className="text-indigo-400" />
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Night Window</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Expected bedtime
                </label>
                <select
                  value={settings.bedtimeHour}
                  onChange={e => onUpdate({ bedtimeHour: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                >
                  {Array.from({ length: 8 }, (_, i) => i + 17).map(h => (
                    <option key={h} value={h}>{hourLabel(h)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Expected wake time
                </label>
                <select
                  value={settings.wakeHour}
                  onChange={e => onUpdate({ wakeHour: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                >
                  {Array.from({ length: 8 }, (_, i) => i + 5).map(h => (
                    <option key={h} value={h}>{hourLabel(h)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3 rounded-lg bg-indigo-50 p-3 dark:bg-indigo-950/50">
              <p className="text-xs text-indigo-700 dark:text-indigo-300">
                Night window: <strong>{hourLabel(settings.bedtimeHour)}</strong> to{' '}
                <strong>{hourLabel(settings.wakeHour + 4)}</strong> next day
              </p>
            </div>
          </div>

          {/* Development & sleep setup — feeds the AI so it doesn't flag things that are normal for this baby */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Sparkles size={16} className="text-violet-400" />
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Development &amp; Sleep Setup</h3>
            </div>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              The AI reads these before judging video and safety. Once she rolls both ways, belly sleeping stops being flagged.
            </p>

            <div className="space-y-2">
              {MILESTONE_OPTIONS.map(({ key, label, hint }) => (
                <label key={key} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40">
                  <input
                    type="checkbox"
                    checked={settings.milestones[key]}
                    onChange={e => onUpdate({ milestones: { ...settings.milestones, [key]: e.target.checked } })}
                    className="mt-0.5 accent-violet-500"
                  />
                  <span>
                    <span className="block text-sm text-slate-700 dark:text-slate-200">{label}</span>
                    {hint && <span className="block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
                  </span>
                </label>
              ))}
            </div>

            {settings.milestones.rolls_back_to_belly && settings.milestones.rolls_belly_to_back && (
              <p className="mt-2 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                Rolls both ways: stomach and side sleeping will be described neutrally, not as a safety alert.
              </p>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Sleepwear</label>
                <select
                  value={settings.sleepwear}
                  onChange={e => onUpdate({ sleepwear: e.target.value as Sleepwear })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                >
                  <option value="sleep_sack">Sleep sack</option>
                  <option value="swaddle">Swaddle</option>
                  <option value="none">Pajamas only</option>
                </select>
                {settings.sleepwear === 'swaddle' && (settings.milestones.rolls_back_to_belly || settings.milestones.rolls_belly_to_back) && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Swaddling should stop once rolling starts. The AI will mention this.</p>
                )}
              </div>
              <label className="flex cursor-pointer items-center gap-2.5 self-end rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                <input
                  type="checkbox"
                  checked={settings.pacifier}
                  onChange={e => onUpdate({ pacifier: e.target.checked })}
                  className="accent-violet-500"
                />
                <span className="text-sm text-slate-700 dark:text-slate-200">Uses a pacifier</span>
              </label>
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Anything else the AI should know</label>
              <textarea
                value={settings.notes}
                onChange={e => onUpdate({ notes: e.target.value.slice(0, 1000) })}
                rows={3}
                placeholder="e.g. She's a belly sleeper. White noise machine is on the shelf, not in the crib. Teething this week."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder:text-slate-500"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
