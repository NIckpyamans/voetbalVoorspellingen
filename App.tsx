import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header";
import MatchCard from "./components/MatchCard";
import BestBetCard from "./components/BestBetCard";
import PredictionHistory from "./components/PredictionHistory";
import StandingsView from "./components/StandingsView";
import SettingsView from "./components/SettingsView";
import DateNavigation from "./components/DateNavigation"; // NIEUW IMPORT
import { getFavorites } from "./components/FavoriteTeams";
import { Match } from "./types";
import { velocityEngine } from "./services/velocityEngine";
import { getOrCreateTeam, saveToMemory, updateTeamModelsFromResult } from "./services/geminiService";
import { todayAmsterdamKey, toAmsterdamDateKey } from "./shared/date.js";

type View = "dashboard" | "history" | "standings" | "settings";
type FilterMode = "alle" | "favorieten" | "live" | "gepland" | "gespeeld";

type DashboardHistoryItem = {
  matchId: string;
  prediction: string;
  actual: string;
  wasCorrect: boolean;
  winnerCorrect?: boolean;
  errorMargin?: number;
  timestamp?: number;
  homeTeam?: string | null;
  awayTeam?: string | null;
  league?: string | null;
  bestBetRank?: number | null;
  topExactScorePick?: boolean;
  exactScoreConfidence?: number;
};

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function isoDate(date: Date) {
  return toAmsterdamDateKey(date) || todayAmsterdamKey();
}

function formatDateLabel(dateISO: string) {
  return new Date(`${dateISO}T12:00:00`).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatAmsterdamDate(date: Date) {
  return toAmsterdamDateKey(date) || isoDate(date);
}

function isLive(match: Match) {
  const status = String(match.status || "").toUpperCase();
  return status === "LIVE" || status === "HT" || !!(match as any).minute || !!(match as any).minuteValue;
}

function isFinished(match: Match) {
  const status = String(match.status || "").toUpperCase();
  return status === "FT" || status.includes("FINISH");
}

function belongsToSelectedDate(match: Match, dateISO: string) {
  if (String(match.date || "") === dateISO) {
    return true;
  }

  if (match.kickoff) {
    const parsed = new Date(match.kickoff);
    if (!Number.isNaN(parsed.getTime())) {
      return formatAmsterdamDate(parsed) === dateISO;
    }
  }
  return false;
}

function shortLeague(league: string) {
  const parts = String(league || "").split(" - ");
  if (parts.length >= 2) {
    return `${parts[0]} - ${parts[1]}`;
  }
  return league;
}

const LEAGUE_ORDER = [
  "Europe - Champions League",
  "Europe - Europa League",
  "Europe - Conference League",
  "Europe - UEFA Nations League",
  "Europe - World Cup Qualification",
  "Europe - Euro Qualification",
  "Europe - European Championship",
  "Europe - International Friendly",
  "England - Premier League",
  "England - Championship",
  "Netherlands - Eredivisie",
  "Netherlands - Eerste Divisie",
  "Netherlands - KNVB Beker",
  "Germany - Bundesliga",
  "Germany - 2. Bundesliga",
  "Spain - LaLiga",
  "Spain - LaLiga 2",
  "Italy - Serie A",
  "Italy - Serie B",
  "France - Ligue 1",
  "France - Ligue 2",
  "Portugal - Liga Portugal",
  "Portugal - Liga Portugal 2",
  "Belgium - Pro League",
  "Belgium - Challenger Pro League",
];

const App: React.FC = () => {
  const [view, setView] = useState<View>("dashboard");
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return isoDate(new Date());
  });
  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Record<string, any>>({});
  const [standings, setStandings] = useState<Record<string, any>>({});
  const [historyItems, setHistoryItems] = useState<DashboardHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<"laden" | "klaar" | "fout">("laden");
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterMode>("alle");
  const [selectedLeague, setSelectedLeague] = useState<string>("alle");
  const [expandedTopClub, setExpandedTopClub] = useState<string | null>(null);
  const [favRefresh, setFavRefresh] = useState(0);
  const learnedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/standings")
      .then((response) => response.json())
      .then((data) => setStandings(data.standings || {}))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/history", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setHistoryItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        try {
          const raw = localStorage.getItem("footypredict_memory");
          if (!cancelled) setHistoryItems(raw ? JSON.parse(raw) : []);
        } catch {
          if (!cancelled) setHistoryItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    setSyncStatus("laden");
    setMatches([]);
    setPredictions({});
    learnedRef.current.clear();

    const unsubscribe = velocityEngine.subscribe(({ matches: nextMatches, predictions: nextPredictions, lastRun: nextLastRun }) => {
      setMatches(nextMatches);
      setPredictions(nextPredictions);
      setLoading(false);
      setSyncStatus("klaar");
      if (nextLastRun) setLastRun(nextLastRun);

      for (const match of nextMatches) {
        if (!isFinished(match) || !match.score?.includes("-") || learnedRef.current.has(match.id)) continue;
        const prediction = nextPredictions[match.id];
        if (!prediction) continue;

        saveToMemory(match.id, `${prediction.predHomeGoals}-${prediction.predAwayGoals}`, match.score, match, prediction);
        const home = getOrCreateTeam({
          id: match.homeTeamId,
          name: match.homeTeamName,
          league: match.league,
          logo: match.homeLogo,
        });
        const away = getOrCreateTeam({
          id: match.awayTeamId,
          name: match.awayTeamName,
          league: match.league,
          logo: match.awayLogo,
        });

        updateTeamModelsFromResult(match, home, away);
        learnedRef.current.add(match.id);
      }
    });

    velocityEngine.startPulse(selectedDate);

    return () => {
      unsubscribe();
      velocityEngine.stopPulse();
    };
  }, [selectedDate]);

  const standingsMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const table of Object.values(standings) as any[]) {
      for (const row of table.rows || []) {
        if (row.teamId) map[row.teamId] = row.pos;
      }
    }
    return map;
  }, [standings]);

  const enrichMatch = useCallback(
    (match: Match) => ({
      ...match,
      homePos: standingsMap[(match as any).homeTeamId] || (match as any).homePos || null,
      awayPos: standingsMap[(match as any).awayTeamId] || (match as any).awayPos || null,
    }),
    [standingsMap]
  );

  const favoriteTeams = useMemo(() => getFavorites(), [favRefresh]);

  const dayMatches = useMemo(
    () => matches.filter((match) => belongsToSelectedDate(match, selectedDate)),
    [matches, selectedDate]
  );

  const filteredMatches = useMemo(() => {
    const leagueScoped =
      selectedLeague === "alle"
        ? dayMatches
        : dayMatches.filter((match) => match.league === selectedLeague);

    if (activeFilter === "live") return leagueScoped.filter(isLive);
    if (activeFilter === "gepland") return leagueScoped.filter((match) => !isLive(match) && !isFinished(match));
    if (activeFilter === "gespeeld") return leagueScoped.filter(isFinished);

    if (activeFilter === "favorieten") {
      return leagueScoped.filter((match) => {
        const homeKey = (match as any).homeTeamId || match.homeTeamName.toLowerCase();
        const awayKey = (match as any).awayTeamId || match.awayTeamName.toLowerCase();
        return favoriteTeams.includes(homeKey) || favoriteTeams.includes(awayKey);
      });
    }

    return leagueScoped;
  }, [dayMatches, activeFilter, selectedLeague, favoriteTeams]);

  const sortedMatches = useMemo(() => {
    return [...filteredMatches].sort((a, b) => {
      const aIdx = LEAGUE_ORDER.indexOf(a.league);
      const bIdx = LEAGUE_ORDER.indexOf(b.league);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.league.localeCompare(b.league);
    });
  }, [filteredMatches]);

  const allLeagues = useMemo(() => {
    const uniqueLeagues = Array.from(new Set(dayMatches.map((match) => match.league)));
    return uniqueLeagues.sort((a, b) => {
      const aIdx = LEAGUE_ORDER.indexOf(a);
      const bIdx = LEAGUE_ORDER.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [dayMatches]);

  const favoriteMatches = useMemo(() => {
    return dayMatches.filter((match) => {
      const homeKey = (match as any).homeTeamId || match.homeTeamName.toLowerCase();
      const awayKey = (match as any).awayTeamId || match.awayTeamName.toLowerCase();
      return favoriteTeams.includes(homeKey) || favoriteTeams.includes(awayKey);
    });
  }, [dayMatches, favoriteTeams]);

  const liveMatches = useMemo(() => sortedMatches.filter(isLive), [sortedMatches]);
  const plannedMatches = useMemo(() => sortedMatches.filter((match) => !isLive(match) && !isFinished(match)), [sortedMatches]);
  const finishedMatches = useMemo(() => sortedMatches.filter(isFinished), [sortedMatches]);

  const favoriteCount = favoriteMatches.length;
  const matchGridClass = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2.5";
  const liveCount = dayMatches.filter(isLive).length;
  const plannedCount = dayMatches.filter((match) => !isLive(match) && !isFinished(match)).length;
  const finishedCount = dayMatches.filter(isFinished).length;

  const bestBets = useMemo(() => {
    return Object.entries(predictions)
      .filter(([matchId]) => {
        const match = matches.find((match) => match.id === matchId);
        return match && belongsToSelectedDate(match, selectedDate);
      })
      .map(([matchId, pred]) => {
        const match = matches.find((match) => match.id === matchId);
        if (!match) return null;

        const homeProb = pred.homeProb || 0;
        const drawProb = pred.drawProb || 0;
        const awayProb = pred.awayProb || 0;
        const maxProb = Math.max(homeProb, drawProb, awayProb);
        const exactScoreConfidence = Number((pred as any).exactScoreConfidence || (match as any).exactScoreConfidence || pred.exactProb || 0);
        const rank = Number((pred as any).bestBetRank || (match as any).bestBetRank || 0) || null;

        return {
          matchId,
          homeTeam: match.homeTeamName,
          awayTeam: match.awayTeamName,
          league: match.league,
          predHomeGoals: pred.predHomeGoals || 0,
          predAwayGoals: pred.predAwayGoals || 0,
          homeProb,
          drawProb,
          awayProb,
          confidence: pred.confidence || maxProb,
          exactProb: pred.exactProb,
          exactScoreConfidence,
          bestBetRank: rank,
          exactScoreReasons: (pred as any).exactScoreReasons || (match as any).exactScoreReasons || [],
          status: match.status,
          score: match.score,
        };
      })
      .filter((bet): bet is NonNullable<typeof bet> => bet !== null)
      .sort((a, b) => {
        if (a.bestBetRank && b.bestBetRank) return a.bestBetRank - b.bestBetRank;
        if (a.bestBetRank) return -1;
        if (b.bestBetRank) return 1;
        return (b.exactScoreConfidence || 0) - (a.exactScoreConfidence || 0) || (b.confidence || 0) - (a.confidence || 0);
      })
      .slice(0, 5);
  }, [predictions, matches, selectedDate]);

  const dashboardInsights = useMemo(() => {
    const topFiveReviews = historyItems.filter((item) => item.topExactScorePick || (Number(item.bestBetRank || 0) > 0 && Number(item.bestBetRank || 0) <= 5));
    const otherReviews = historyItems.filter((item) => !(item.topExactScorePick || (Number(item.bestBetRank || 0) > 0 && Number(item.bestBetRank || 0) <= 5)));
    const topExact = topFiveReviews.filter((item) => item.wasCorrect).length;
    const topOutcome = topFiveReviews.filter((item) => item.winnerCorrect).length;
    const otherExact = otherReviews.filter((item) => item.wasCorrect).length;
    const topAvgError = topFiveReviews.length
      ? (topFiveReviews.reduce((sum, item) => sum + Number(item.errorMargin || 0), 0) / topFiveReviews.length).toFixed(2)
      : "0.00";
    const otherExactPct = pct(otherExact, otherReviews.length);
    const topExactPct = pct(topExact, topFiveReviews.length);
    const clubMap = new Map<string, {
      team: string;
      total: number;
      exact: number;
      outcome: number;
      avgError: number;
      exactMatches: DashboardHistoryItem[];
    }>();
    for (const item of historyItems) {
      for (const team of [item.homeTeam, item.awayTeam]) {
        const name = String(team || "").trim();
        if (!name) continue;
        const current = clubMap.get(name) || { team: name, total: 0, exact: 0, outcome: 0, avgError: 0, exactMatches: [] };
        current.total += 1;
        if (item.wasCorrect) {
          current.exact += 1;
          current.exactMatches.push(item);
        }
        if (item.winnerCorrect) current.outcome += 1;
        current.avgError += Number(item.errorMargin || 0);
        clubMap.set(name, current);
      }
    }
    const topClubs = [...clubMap.values()]
      .filter((item) => item.total >= 2)
      .map((item) => ({
        ...item,
        exactPct: pct(item.exact, item.total),
        outcomePct: pct(item.outcome, item.total),
        avgError: Number((item.avgError / Math.max(item.total, 1)).toFixed(2)),
      }))
      .sort((a, b) => b.exactPct - a.exactPct || b.exact - a.exact || b.outcomePct - a.outcomePct || b.total - a.total)
      .slice(0, 10);

    return {
      topFiveTotal: topFiveReviews.length,
      topFiveExact: topExact,
      topFiveOutcome: topOutcome,
      topFiveExactPct: topExactPct,
      topFiveOutcomePct: pct(topOutcome, topFiveReviews.length),
      topFiveAvgError: topAvgError,
      otherExactPct,
      otherExactCount: otherExact,
      otherTotal: otherReviews.length,
      topSelectionIsBetter: topExactPct >= otherExactPct,
      topClubs,
    };
  }, [historyItems]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-[url('/footyai-stadium-bg.jpeg')] bg-cover bg-center bg-no-repeat opacity-55"
      />
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-gradient-to-br from-slate-950/92 via-slate-900/70 to-slate-950/90"
      />
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(20,184,166,0.18),transparent_42%)]"
      />
      <div className="relative z-10">
      <Header 
        view={view} 
        onViewChange={setView}
        syncStatus={syncStatus}
        lastRun={lastRun}
      />

      <main className="max-w-7xl mx-auto px-4 py-6">
        {view === "history" ? (
          <PredictionHistory />
        ) : view === "standings" ? (
          <StandingsView />
        ) : view === "settings" ? (
          <SettingsView />
        ) : (
          <>
            {/* DATE NAVIGATION - NIEUW! */}
            <DateNavigation 
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
            />

            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                { key: "favorieten", label: "Favorieten", count: favoriteCount, color: "yellow", icon: "★" },
                { key: "live", label: "Live", count: liveCount, color: "red", icon: "●" },
                { key: "gepland", label: "Gepland", count: plannedCount, color: "blue", icon: "" },
                { key: "gespeeld", label: "Gespeeld", count: finishedCount, color: "slate", icon: "" },
              ].map(({ key, label, count, color, icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveFilter(activeFilter === key ? "alle" : (key as FilterMode))}
                  className={`glass-card p-3 rounded-2xl border text-left transition ${
                    activeFilter === key
                      ? `border-${color}-500/60 bg-${color}-900/20`
                      : `border-${color}-500/20 hover:border-${color}-500/30`
                  }`}
                >
                  <div className={`text-[9px] font-black text-${color}-400 uppercase flex items-center gap-1`}>
                    {icon && <span className={key === "live" ? "animate-pulse" : ""}>{icon}</span>}
                    {label}
                  </div>
                  <div className="text-xl font-black">{count}</div>
                </button>
              ))}
            </div>

            {/* AANGEPAST: Multi-row league tabs zonder scroll */}
            <div className="flex flex-wrap gap-1 mb-4 py-0.5">
              <button
                onClick={() => {
                  setSelectedLeague("alle");
                  setActiveFilter("alle");
                }}
                className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-black whitespace-nowrap ${
                  selectedLeague === "alle"
                    ? "bg-white text-black"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                ⚽ {dayMatches.length}
              </button>

              {allLeagues.map((league) => {
                const total = dayMatches.filter((match) => match.league === league).length;
                const leagueLiveCount = dayMatches.filter((match) => match.league === league && isLive(match)).length;

                return (
                  <button
                    key={league}
                    onClick={() => setSelectedLeague(league)}
                    title={league}
                    className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-black whitespace-nowrap ${
                      selectedLeague === league
                        ? "bg-blue-600 text-white"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {shortLeague(league)}
                    {leagueLiveCount > 0 ? (
                      <span className="ml-1 text-[8px] bg-red-500 text-white px-1 rounded animate-pulse">
                        {leagueLiveCount}
                      </span>
                    ) : (
                      <span className="ml-1 opacity-50 text-[9px]">{total}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px] gap-4 mb-6">
              <section className="glass-card rounded-2xl border border-yellow-500/20 p-4 bg-yellow-500/5">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <h2 className="text-sm font-black uppercase text-white flex items-center gap-2">
                      <span className="w-2 h-2 bg-yellow-400 rounded-full" />
                      Top 5 exacte-score voorspellingen vandaag
                    </h2>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      AI kiest deze 5 omdat de kans op de exacte uitslag het hoogst is. Deze picks worden achteraf apart gemonitord.
                    </p>
                  </div>
                  <div className="hidden md:block rounded-full bg-yellow-500/15 px-3 py-1 text-[10px] font-black text-yellow-200">
                    {bestBets.length}/5 gevuld
                  </div>
                </div>

                {bestBets.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                    {bestBets.map((bet: any) => (
                      <BestBetCard key={bet.matchId} bet={bet} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-yellow-500/20 bg-slate-950/30 p-5 text-sm font-bold text-slate-400">
                    Nog geen top-5 beschikbaar voor deze dag. Zodra de worker voorspellingen voor deze datum heeft, verschijnt dit blok automatisch.
                  </div>
                )}

                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="rounded-xl bg-slate-950/40 border border-white/5 p-3">
                    <div className="text-[8px] font-black text-slate-500 uppercase">Top-5 exact</div>
                    <div className="text-xl font-black text-white">{dashboardInsights.topFiveExactPct}%</div>
                    <div className="text-[9px] text-slate-500">{dashboardInsights.topFiveExact}/{dashboardInsights.topFiveTotal}</div>
                  </div>
                  <div className="rounded-xl bg-slate-950/40 border border-white/5 p-3">
                    <div className="text-[8px] font-black text-slate-500 uppercase">Winnaar/gelijk</div>
                    <div className="text-xl font-black text-white">{dashboardInsights.topFiveOutcomePct}%</div>
                    <div className="text-[9px] text-slate-500">top-5 monitor</div>
                  </div>
                  <div className="rounded-xl bg-slate-950/40 border border-white/5 p-3">
                    <div className="text-[8px] font-black text-slate-500 uppercase">Rest exact</div>
                    <div className="text-xl font-black text-white">{dashboardInsights.otherExactPct}%</div>
                    <div className="text-[9px] text-slate-500">{dashboardInsights.otherExactCount}/{dashboardInsights.otherTotal}</div>
                  </div>
                  <div className={`rounded-xl border p-3 ${dashboardInsights.topSelectionIsBetter ? "border-green-500/20 bg-green-500/10" : "border-amber-500/20 bg-amber-500/10"}`}>
                    <div className="text-[8px] font-black text-slate-500 uppercase">Selectiecheck</div>
                    <div className={`text-[12px] font-black mt-1 ${dashboardInsights.topSelectionIsBetter ? "text-green-300" : "text-amber-300"}`}>
                      {dashboardInsights.topSelectionIsBetter ? "AI kiest beter" : "Bijsturen nodig"}
                    </div>
                    <div className="text-[9px] text-slate-500">foutmarge {dashboardInsights.topFiveAvgError}</div>
                  </div>
                </div>
              </section>

              <aside className="glass-card rounded-2xl border border-blue-500/20 p-4 bg-blue-500/5">
                <div className="mb-3">
                  <h2 className="text-sm font-black uppercase text-white">Top 10 clubs exact goed</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">Teams waarbij AI historisch vaak de juiste uitslag raakt.</p>
                </div>
                {dashboardInsights.topClubs.length > 0 ? (
                  <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                    {dashboardInsights.topClubs.map((club, index) => (
                      <div key={club.team} className="rounded-xl bg-slate-950/40 border border-white/5 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setExpandedTopClub(expandedTopClub === club.team ? null : club.team)}
                          className="w-full flex items-center justify-between gap-2 text-left"
                        >
                          <div className="min-w-0">
                            <div className="text-[11px] font-black text-white truncate">#{index + 1} {club.team}</div>
                            <div className="text-[9px] text-slate-500">
                              {club.exact}/{club.total} exact - winnaar {club.outcomePct}% - klik voor juiste duels
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-lg font-black text-green-300">{club.exactPct}%</div>
                            <div className="text-[10px] text-slate-500">{expandedTopClub === club.team ? "▲" : "▼"}</div>
                          </div>
                        </button>
                        {expandedTopClub === club.team && (
                          <div className="mt-2 space-y-1 border-t border-white/5 pt-2">
                            {club.exactMatches.length > 0 ? (
                              club.exactMatches.slice(0, 8).map((item) => (
                                <div key={`${club.team}-${item.matchId}`} className="rounded-lg bg-slate-900/70 px-2 py-1.5">
                                  <div className="text-[9px] font-black text-white truncate">
                                    {item.homeTeam} - {item.awayTeam}
                                  </div>
                                  <div className="text-[8px] text-slate-500">
                                    {item.league || "Onbekend"} - voorspeld {item.prediction}, uitslag {item.actual}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-[9px] text-slate-500">Geen exact-goed wedstrijden gevonden.</div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-blue-500/20 bg-slate-950/30 p-4 text-[12px] font-bold text-slate-400">
                    Nog te weinig reviews voor een betrouwbare club top 10.
                  </div>
                )}
              </aside>
            </div>

            {loading ? (
              <div className={matchGridClass}>
                {[1, 2, 3, 4, 5, 6].map((index) => (
                  <div key={index} className="h-64 glass-card rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : sortedMatches.length === 0 && activeFilter !== "alle" ? (
              <div className="text-center py-16 text-slate-500">
                <div className="text-5xl mb-3">{activeFilter === "favorieten" ? "★" : "⚽"}</div>
                <div className="font-bold">
                  {activeFilter === "favorieten"
                    ? "Geen wedstrijden van favoriete teams op deze dag"
                    : "Geen wedstrijden voor deze selectie"}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {activeFilter === "alle" && favoriteCount > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-yellow-400">★</span>
                      <span className="text-sm font-black uppercase">Favoriete teams ({favoriteCount})</span>
                    </div>

                    <div className={matchGridClass}>
                      {favoriteMatches.slice(0, 6).map((match) => (
                        <MatchCard
                          key={match.id}
                          match={enrichMatch(match)}
                          prediction={predictions[match.id]}
                          onFavoriteChange={() => setFavRefresh((value) => value + 1)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {(activeFilter === "alle" || activeFilter === "live" || activeFilter === "favorieten") && liveMatches.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                      <span className="text-sm font-black uppercase">Live ({liveMatches.length})</span>
                    </div>
                    <div className={matchGridClass}>
                      {liveMatches.map((match) => (
                        <MatchCard
                          key={match.id}
                          match={enrichMatch(match)}
                          prediction={predictions[match.id]}
                          onFavoriteChange={() => setFavRefresh((value) => value + 1)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {(activeFilter === "alle" || activeFilter === "gepland" || activeFilter === "favorieten") && plannedMatches.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2 h-2 bg-blue-500 rounded-full" />
                      <span className="text-sm font-black uppercase">Nog te spelen ({plannedMatches.length})</span>
                    </div>
                    <div className={matchGridClass}>
                      {plannedMatches.map((match) => (
                        <MatchCard
                          key={match.id}
                          match={enrichMatch(match)}
                          prediction={predictions[match.id]}
                          onFavoriteChange={() => setFavRefresh((value) => value + 1)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {(activeFilter === "alle" || activeFilter === "gespeeld" || activeFilter === "favorieten") && finishedMatches.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2 h-2 bg-slate-400 rounded-full" />
                      <span className="text-sm font-black uppercase">Gespeeld ({finishedMatches.length})</span>
                    </div>
                    <div className={matchGridClass}>
                      {finishedMatches.map((match) => (
                        <MatchCard
                          key={match.id}
                          match={enrichMatch(match)}
                          prediction={predictions[match.id]}
                          onFavoriteChange={() => setFavRefresh((value) => value + 1)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {!loading && dayMatches.length === 0 && (
                  <div className="text-center py-16 text-slate-500">
                    <div className="text-5xl mb-3">📅</div>
                    <div className="font-bold">Geen wedstrijden gevonden voor {formatDateLabel(selectedDate)}</div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
      </div>
    </div>
  );
};

export default App;
