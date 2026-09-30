import React, { useEffect, useMemo, useState } from "react";
import { Match } from "../types";
import { addDaysToDateKey, todayAmsterdamKey } from "../shared/date.js";

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

function matchDate(match: Match) {
  return String(match.date || match.kickoff || "").slice(0, 10);
}

const DateNavigation: React.FC<DateNavigationProps> = ({ selectedDate, onDateChange }) => {
  const today = todayAmsterdamKey();
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(selectedDate));
  const [rangeStart, setRangeStart] = useState(() => (selectedDate < today ? today : selectedDate));
  const [plannerMatches, setPlannerMatches] = useState<Match[]>([]);
  const [plannerLoading, setPlannerLoading] = useState(false);

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

  const rangeEnd = addDaysToDateKey(rangeStart, PLANNER_DAYS - 1);
  const matchCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const match of plannerMatches) {
      const date = matchDate(match);
      if (date) counts.set(date, (counts.get(date) || 0) + 1);
    }
    return counts;
  }, [plannerMatches]);

  const monthCells = useMemo(() => {
    const [year, month] = visibleMonth.slice(0, 7).split("-").map(Number);
    const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    return [
      ...Array.from({ length: firstWeekday }, () => null),
      ...Array.from({ length: totalDays }, (_, index) => `${visibleMonth.slice(0, 7)}-${String(index + 1).padStart(2, "0")}`),
    ];
  }, [visibleMonth]);

  const groupedUpcomingMatches = useMemo(() => {
    const grouped = new Map<string, Match[]>();
    for (const match of plannerMatches
      .filter((item) => {
        const date = matchDate(item);
        return date >= rangeStart && date <= rangeEnd && !["FT", "AET", "PEN", "RESULT_PENDING", "CANCELLED", "POSTPONED"].includes(String(item.status || "").toUpperCase());
      })
      .sort((a, b) => String(a.kickoff || a.date).localeCompare(String(b.kickoff || b.date)))) {
      for (const teamName of [match.homeTeamName, match.awayTeamName]) {
        const fixtures = grouped.get(teamName) || [];
        fixtures.push(match);
        grouped.set(teamName, fixtures);
      }
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [plannerMatches, rangeStart, rangeEnd]);

  const upcomingMatches = useMemo(
    () => new Set(groupedUpcomingMatches.flatMap(([, fixtures]) => fixtures.map((match) => match.id))).size,
    [groupedUpcomingMatches]
  );

  const selectDate = (date: string) => {
    onDateChange(date);
    setVisibleMonth(monthStart(date));
    if (date < rangeStart || date > rangeEnd) setRangeStart(date < today ? today : date);
  };

  const changeMonth = (offset: number) => {
    const nextMonth = shiftMonth(visibleMonth, offset);
    setVisibleMonth(nextMonth);
    setRangeStart(nextMonth < today ? today : nextMonth);
  };

  const monthLabel = new Date(`${visibleMonth.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("nl-NL", {
    month: "long",
    year: "numeric",
  });

  return (
    <section className="glass-card mb-4 rounded-2xl border border-white/5 p-3 sm:p-4" aria-label="Wedstrijdkalender">
      <div className="mb-3 flex items-center justify-between gap-2">
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
              onClick={() => selectDate(date)}
              aria-label={`${new Date(`${date}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}${count ? `, ${count} wedstrijden` : ""}`}
              aria-pressed={selected}
              className={`relative flex min-h-10 flex-col items-center justify-center rounded-lg border text-xs transition sm:min-h-11 ${
                selected ? "border-cyan-300 bg-cyan-400 text-slate-950" :
                isCurrentDay ? "border-blue-400/50 bg-blue-500/15 text-blue-100" :
                "border-white/5 bg-slate-950/25 text-slate-200 hover:border-white/20 hover:bg-white/5"
              }`}
            >
              <span className="font-bold">{Number(date.slice(-2))}</span>
              {count > 0 && <span className={`text-[8px] font-black ${selected ? "text-slate-900" : "text-amber-300"}`}>{count} wed.</span>}
              {inPlanner && !count && <span className={`mt-0.5 h-1 w-1 rounded-full ${selected ? "bg-slate-900/50" : "bg-cyan-400/50"}`} />}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3">
        <div className="text-center sm:text-left">
          <div className="text-base font-black capitalize text-white">{formatDateLabel(selectedDate, today)}</div>
          <div className="text-[10px] text-slate-400">{new Date(`${selectedDate}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}</div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => selectDate(addDaysToDateKey(selectedDate, -1))} aria-label="Vorige dag" className="rounded-lg bg-slate-800/70 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700">← Vorige dag</button>
          <button type="button" onClick={() => selectDate(addDaysToDateKey(selectedDate, 1))} aria-label="Volgende dag" className="rounded-lg bg-slate-800/70 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700">Volgende dag →</button>
        </div>
      </div>

      <details className="mt-3 rounded-xl border border-white/5 bg-slate-950/30">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-black text-cyan-200">
          Komende 3 weken per club {plannerLoading ? "· laden…" : `· ${upcomingMatches.length} bekende wedstrijden`}
        </summary>
        <div className="max-h-52 space-y-1 overflow-y-auto px-2 pb-2">
          {upcomingMatches > 0 ? groupedUpcomingMatches.map(([teamName, fixtures]) => (
            <div key={teamName} className="rounded-lg px-2 py-1.5 hover:bg-white/5">
              <div className="mb-1 text-[10px] font-black text-white">{teamName}</div>
              {fixtures.map((match) => (
                <button key={`${teamName}-${match.id}`} type="button" onClick={() => selectDate(matchDate(match))} className="grid w-full grid-cols-[72px_minmax(0,1fr)] gap-2 py-1 text-left">
                  <span className="text-[9px] font-bold text-slate-400">{new Date(`${matchDate(match)}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })}</span>
                  <span className="truncate text-[10px] font-bold text-cyan-100">{match.homeTeamName} <span className="text-slate-500">vs</span> {match.awayTeamName}</span>
                </button>
              ))}
            </div>
          )) : <p className="px-2 py-2 text-[10px] text-slate-500">{plannerLoading ? "Wedstrijden laden…" : "Nog geen fixtures bekend in dit venster. De kalender wordt dagelijks bijgewerkt."}</p>}
        </div>
      </details>
    </section>
  );
};

export default DateNavigation;
