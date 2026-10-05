import React, { useEffect, useMemo, useState } from "react";
import { Match } from "../types";
import { addDaysToDateKey, todayAmsterdamKey } from "../shared/date.js";
import { advanceRollingCalendarStart, countFixturesByDate, rollingCalendarEnd } from "../shared/calendarMatches.js";

interface DateNavigationProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
}

const PLANNER_DAYS = 21;
const WEEKDAYS = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];

function monthStart(dateISO: string) {
  return `${dateISO.slice(0, 7)}-01`;
}

function shiftMonth(dateISO: string, offset: number) {
  const [year, month] = dateISO.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
}

function formatDateLabel(dateISO: string, today: string) {
  if (dateISO === today) return "Vandaag";
  if (dateISO === addDaysToDateKey(today, -1)) return "Gisteren";
  if (dateISO === addDaysToDateKey(today, 1)) return "Morgen";
  return new Date(`${dateISO}T12:00:00Z`).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

const DateNavigation: React.FC<DateNavigationProps> = ({ selectedDate, onDateChange }) => {
  const [today, setToday] = useState(todayAmsterdamKey);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(selectedDate));
  const [rangeStart, setRangeStart] = useState(() => advanceRollingCalendarStart(null, todayAmsterdamKey()));
  const [followsToday, setFollowsToday] = useState(true);
  const [plannerMatches, setPlannerMatches] = useState<Match[]>([]);
  const [plannerLoading, setPlannerLoading] = useState(false);

  useEffect(() => {
    const refreshToday = () => {
      const nextToday = todayAmsterdamKey();
      setToday(nextToday);
      setRangeStart((current) => advanceRollingCalendarStart(current, nextToday, followsToday));
    };
    const timer = window.setInterval(refreshToday, 60_000);
    return () => window.clearInterval(timer);
  }, [followsToday]);

  useEffect(() => {
    const controller = new AbortController();
    setPlannerLoading(true);
    const params = new URLSearchParams({
      date: rangeStart,
      days: String(PLANNER_DAYS),
      range: "calendar",
    });
    fetch(`/api/matches?${params.toString()}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!controller.signal.aborted) setPlannerMatches(Array.isArray(data?.matches) ? data.matches : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPlannerMatches([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPlannerLoading(false);
      });
    return () => controller.abort();
  }, [rangeStart]);

  const rangeEnd = rollingCalendarEnd(rangeStart, PLANNER_DAYS);
  const matchCounts = useMemo(
    () => countFixturesByDate(plannerMatches, rangeStart, rangeEnd),
    [plannerMatches, rangeStart, rangeEnd]
  );

  const monthCells = useMemo(() => {
    const [year, month] = visibleMonth.slice(0, 7).split("-").map(Number);
    const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    return [
      ...Array.from({ length: firstWeekday }, () => null),
      ...Array.from({ length: totalDays }, (_, index) => `${visibleMonth.slice(0, 7)}-${String(index + 1).padStart(2, "0")}`),
    ];
  }, [visibleMonth]);

  const selectDate = (date: string) => {
    onDateChange(date);
    setVisibleMonth(monthStart(date));
    if (date === today) {
      setFollowsToday(true);
      setRangeStart(today);
    } else if (date < rangeStart || date > rangeEnd) {
      setFollowsToday(false);
      setRangeStart(advanceRollingCalendarStart(date, today, false));
    }
  };

  const changeMonth = (offset: number) => {
    const nextMonth = shiftMonth(visibleMonth, offset);
    setVisibleMonth(nextMonth);
    setFollowsToday(false);
    setRangeStart(advanceRollingCalendarStart(nextMonth, today, false));
  };

  const monthLabel = new Date(`${visibleMonth.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("nl-NL", {
    month: "long",
    year: "numeric",
  });

  return (
    <section className="glass-card mb-3 rounded-xl border border-white/5 p-2.5 sm:p-3" aria-label="Wedstrijdkalender">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-white">Wedstrijdkalender</h2>
          <p className="text-[10px] text-slate-400">Wedstrijden per dag · bekend programma 3 weken vooruit</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => changeMonth(-1)} aria-label="Vorige maand" className="rounded-lg bg-slate-800/70 px-3 py-2 text-sm font-black text-slate-200 hover:bg-slate-700">‹</button>
          <div className="min-w-32 text-center text-sm font-black capitalize text-cyan-200">{monthLabel}</div>
          <button type="button" onClick={() => changeMonth(1)} aria-label="Volgende maand" className="rounded-lg bg-slate-800/70 px-3 py-2 text-sm font-black text-slate-200 hover:bg-slate-700">›</button>
          <button type="button" onClick={() => selectDate(today)} className="ml-1 rounded-lg bg-blue-600/20 px-2.5 py-2 text-[10px] font-black text-blue-200 hover:bg-blue-600/35">Vandaag</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((weekday) => <div key={weekday} className="py-1 text-[9px] font-black uppercase text-slate-500">{weekday}</div>)}
        {monthCells.map((date, index) => {
          if (!date) return <div key={`empty-${index}`} />;
          const count = matchCounts.get(date) || 0;
          const inPlanner = date >= rangeStart && date <= rangeEnd;
          const selected = date === selectedDate;
          const isCurrentDay = date === today;
          return (
            <button
              key={date}
              type="button"
              onClick={() => inPlanner && selectDate(date)}
              aria-label={`${new Date(`${date}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}${inPlanner ? `, ${count} wedstrijden` : ""}`}
              aria-pressed={selected}
              aria-disabled={!inPlanner}
              className={`relative flex min-h-8 flex-col items-center justify-center rounded-md border text-[11px] transition sm:min-h-9 ${
                !inPlanner ? "border-white/[0.03] bg-slate-950/10 text-slate-600" :
                selected ? "border-cyan-300 bg-cyan-400 text-slate-950" :
                isCurrentDay ? "border-blue-400/50 bg-blue-500/15 text-blue-100" :
                "border-white/5 bg-slate-950/25 text-slate-200 hover:border-white/20 hover:bg-white/5"
              }`}
            >
              <span className="font-bold">{Number(date.slice(-2))}</span>
              {inPlanner && <span className={`text-[8px] font-black ${selected ? "text-slate-900" : count ? "text-amber-300" : "text-slate-500"}`}>{count ? `${count} wed.` : "·"}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2">
        <div className="text-center sm:text-left">
          <div className="text-sm font-black capitalize text-white">{formatDateLabel(selectedDate, today)}</div>
          <div className="text-[10px] text-slate-400">{new Date(`${selectedDate}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}</div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => selectDate(addDaysToDateKey(selectedDate, -1))} aria-label="Vorige dag" className="rounded-lg bg-slate-800/70 px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700">← Vorige dag</button>
          <button type="button" onClick={() => selectDate(addDaysToDateKey(selectedDate, 1))} aria-label="Volgende dag" className="rounded-lg bg-slate-800/70 px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700">Volgende dag →</button>
        </div>
      </div>

      <p className="mt-1 text-right text-[9px] text-slate-500" aria-live="polite">
        {plannerLoading ? "Programma bijwerken…" : `21 dagen · ${rangeStart} t/m ${rangeEnd}`}
      </p>
    </section>
  );
};

export default DateNavigation;
