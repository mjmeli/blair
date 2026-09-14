import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Settings, Moon } from 'lucide-react';
import { DateTime } from 'luxon';
import { Nav } from './Nav';
import { SettingsPanel } from './SettingsPanel';
import { SleepScoreCard } from '../sleep/SleepScoreCard';
import { SleepTimeline } from '../sleep/SleepTimeline';
import { NightAdjustCard } from '../sleep/NightAdjustCard';
import { ErrorState } from '../common/ErrorState';
import { errorMessage } from '../../utils/errors';
import { SleepTrendChart } from '../sleep/SleepTrendChart';
import { NightInsightsCard } from '../sleep/NightInsightsCard';
import { NightInProgressCard } from '../sleep/NightInProgressCard';
import { VideoEventsCard } from '../sleep/VideoEventsCard';
import { VideoPatternsCard } from '../sleep/VideoPatternsCard';
import { MilestonesCard } from '../sleep/MilestonesCard';
import { RegressionAlertsBanner } from '../sleep/RegressionAlertsBanner';
import { ScheduleOptimizerCard } from '../sleep/ScheduleOptimizerCard';
import { NightComparisonCard } from '../sleep/NightComparisonCard';
import { EventsCard } from '../sensors/EventsCard';
import { CareCard } from '../care/CareCard';
import * as api from '../../services/api';
import { formatAge, yesterdayStr, dayStart, dayEnd, todayStr } from '../../utils/date';
import { useSettings, nightWindow, adjustedAgeMonths } from '../../hooks/useSettings';
import type { Baby, CalendarEvent, NanitMessage, ScoredNight } from '../../types';

export function Dashboard() {
  const [baby, setBaby] = useState<Baby | null>(null);
  const [date, setDate] = useState(yesterdayStr());
  const [sleepScore, setSleepScore] = useState<ScoredNight | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [careEvents, setCareEvents] = useState<CalendarEvent[]>([]);
  const [allTypes, setAllTypes] = useState<string[]>([]);
  const [messages, setMessages] = useState<NanitMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings, setSettings } = useSettings(baby?.uid);
  const nw = nightWindow(date, settings);

  // Tonight's window: from bedtimeHour today to wakeHour+4 tomorrow
  const tonightNw = nightWindow(todayStr(), settings);

  // The view is derived from the date: today = Tonight (night in progress), past = History
  const today = todayStr();
  const isTonight = date === today;

  // Load baby on mount
  useEffect(() => {
    api.getBabies().then(babies => {
      if (babies?.length > 0) setBaby(babies[0]);
    }).catch(console.error);
  }, []);

  // Load history data when baby, date, or settings change (skip for tonight — that card self-fetches)
  useEffect(() => {
    if (!baby || isTonight) return;
    setLoading(true);

    const start = dayStart(date);
    const end = dayEnd(date);

    setScoreError(null);

    Promise.all([
      api.getSleepScore(baby.uid, nw.start, nw.end, baby.birthdate, settings.prematureWeeks, settings.bedtimeHour)
        .then(scores => {
          setSleepScore(scores.find(s => s.is_main) ?? scores[0] ?? null);
        })
        .catch(err => {
          setSleepScore(null);
          setScoreError(errorMessage(err));
        }),
      // Care and sensor events are secondary; an outage there shouldn't blank the page
      api.getCareEvents(baby.uid, start, end).catch(() => ({ events: [], all_types: [] })),
      api.getEvents(baby.uid, undefined, 200).catch(() => []),
    ]).then(([, care, msgs]) => {
      setCareEvents(care.events);
      setAllTypes(care.all_types);
      const filtered = msgs.filter((m: NanitMessage) => m.time >= start && m.time <= end);
      setMessages(filtered);
    }).finally(() => setLoading(false));
  }, [baby, date, settings, isTonight, refreshKey]);

  const refetch = () => setRefreshKey(k => k + 1);

  const prevDay = () => {
    setDate(DateTime.fromISO(date).minus({ days: 1 }).toFormat('yyyy-MM-dd'));
  };

  const nextDay = () => {
    const next = DateTime.fromISO(date).plus({ days: 1 });
    // Allow navigating up to today (which auto-shows Tonight view)
    if (next.toFormat('yyyy-MM-dd') <= today) {
      setDate(next.toFormat('yyyy-MM-dd'));
    }
  };

  const switchToTonight = () => setDate(today);
  const switchToHistory = () => setDate(yesterdayStr());

  const isLatest = date >= today;
  const displayDate = DateTime.fromISO(date).toFormat('EEE, MMM d');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Nav />
      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Header */}
        <div className="mb-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              {baby && (
                <>
                  <h1 className="text-xl font-bold text-slate-800 dark:text-white sm:text-2xl">{baby.name}</h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
                    {formatAge(baby.birthdate)} old
                    {settings.prematureWeeks > 0 && (
                      <span className="ml-1.5 text-indigo-400">
                        (adj: {Math.round(adjustedAgeMonths(baby.birthdate, settings.prematureWeeks) * 10) / 10}m)
                      </span>
                    )}
                  </p>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSettingsOpen(true)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
                title="Sleep settings"
              >
                <Settings size={18} />
              </button>
              <button
                onClick={isTonight ? switchToHistory : switchToTonight}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  isTonight
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                }`}
              >
                <Moon size={14} />
                Tonight
              </button>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2">
            <button onClick={prevDay} className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800">
              <ChevronLeft size={20} />
            </button>
            <span className="min-w-[160px] text-center text-sm font-medium text-slate-700 dark:text-slate-300">
              Night of {displayDate}
              {isTonight && <span className="ml-1.5 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-400">LIVE</span>}
            </span>
            <button
              onClick={nextDay}
              disabled={isLatest}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 disabled:opacity-30 dark:hover:bg-slate-800"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Regression alerts banner — shows across all modes */}
        <RegressionAlertsBanner
          baby={baby}
          prematureWeeks={settings.prematureWeeks}
          bedtimeHour={settings.bedtimeHour}
          wakeHour={settings.wakeHour}
        />

        {isTonight ? (
          /* TONIGHT MODE */
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="col-span-full lg:col-span-2">
              <NightInProgressCard
                baby={baby}
                nightStart={tonightNw.start}
                nightEnd={tonightNw.end}
                prematureWeeks={settings.prematureWeeks}
                bedtimeHour={settings.bedtimeHour}
                wakeHour={settings.wakeHour}
              />
            </div>
            <MilestonesCard baby={baby} prematureWeeks={settings.prematureWeeks} bedtimeHour={settings.bedtimeHour} wakeHour={settings.wakeHour} />
            <VideoEventsCard
              baby={baby}
              prematureWeeks={settings.prematureWeeks}
              nightStart={tonightNw.start}
              nightEnd={tonightNw.end}
              nightLabel="Tonight"
            />
            <ScheduleOptimizerCard
              baby={baby}
              prematureWeeks={settings.prematureWeeks}
              bedtimeHour={settings.bedtimeHour}
              wakeHour={settings.wakeHour}
              onApply={(bedtime, wake) => setSettings({ bedtimeHour: bedtime, wakeHour: wake })}
            />
            <VideoPatternsCard baby={baby} prematureWeeks={settings.prematureWeeks} bedtimeHour={settings.bedtimeHour} wakeHour={settings.wakeHour} />
            <SleepTrendChart baby={baby} bedtimeHour={settings.bedtimeHour} wakeHour={settings.wakeHour} prematureWeeks={settings.prematureWeeks} />
          </div>
        ) : (
          /* HISTORY MODE */
          <div className="grid gap-4 lg:grid-cols-3">
            {scoreError && !loading && (
              <div className="col-span-full">
                <ErrorState title="Couldn't load this night from Nanit" message={scoreError} onRetry={refetch} />
              </div>
            )}
            <SleepScoreCard score={sleepScore} loading={loading} />
            <EventsCard messages={messages} loading={loading} />
            <SleepTimeline sleepScore={sleepScore} loading={loading} />
            <NightAdjustCard baby={baby} night={sleepScore} loading={loading} onSaved={refetch} />
            <NightInsightsCard
              baby={baby}
              nightStart={nw.start}
              nightEnd={nw.end}
              prematureWeeks={settings.prematureWeeks}
              bedtimeHour={settings.bedtimeHour}
              wakeHour={settings.wakeHour}
              hasSleepData={!!sleepScore}
            />
            <MilestonesCard baby={baby} prematureWeeks={settings.prematureWeeks} bedtimeHour={settings.bedtimeHour} wakeHour={settings.wakeHour} />
            <VideoEventsCard
              baby={baby}
              prematureWeeks={settings.prematureWeeks}
              nightStart={nw.start}
              nightEnd={nw.end}
              nightLabel={displayDate}
            />
            <CareCard events={careEvents} allTypes={allTypes} loading={loading} />
            <NightComparisonCard
              baby={baby}
              prematureWeeks={settings.prematureWeeks}
              bedtimeHour={settings.bedtimeHour}
              wakeHour={settings.wakeHour}
            />
            <ScheduleOptimizerCard
              baby={baby}
              prematureWeeks={settings.prematureWeeks}
              bedtimeHour={settings.bedtimeHour}
              wakeHour={settings.wakeHour}
              onApply={(bedtime, wake) => setSettings({ bedtimeHour: bedtime, wakeHour: wake })}
            />
            <VideoPatternsCard baby={baby} prematureWeeks={settings.prematureWeeks} bedtimeHour={settings.bedtimeHour} wakeHour={settings.wakeHour} />
            <SleepTrendChart baby={baby} bedtimeHour={settings.bedtimeHour} wakeHour={settings.wakeHour} prematureWeeks={settings.prematureWeeks} />
          </div>
        )}
      </main>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdate={setSettings}
        birthdate={baby?.birthdate}
        nanitName={baby?.name}
      />
    </div>
  );
}
