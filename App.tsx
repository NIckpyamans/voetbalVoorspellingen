import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header";
import MatchCard from "./components/MatchCard";
import BestBetCard from "./components/BestBetCard";
import PredictionHistory from "./components/PredictionHistory";
import StandingsView from "./components/StandingsView";
import SettingsView from "./components/SettingsView";
import { getFavorites } from "./components/FavoriteTeams";
import { Match } from "./types";
import { velocityEngine } from "./services/velocityEngine";
import { getOrCreateTeam, saveToMemory, updateTeamModelsFromResult } from "./services/geminiService";

type View = "dashboard" | "history" | "standings" | "settings";
type FilterMode = "alle" | "favorieten" | "live" | "gepland" | "gespeeld";

function isoDate(date: Date) {
  return date.toISOString().split("T")[0];
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
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isLive(match: Match) {
  const status = String(match.status || "").toUpperCase();
  return status === "LIVE" || !!(match as any).minute || !!(match as any).minuteValue;
}

function isFinished(match: Match) {
  const status = String(match.status || "").toUpperCase();
  return status === "FT" || status.includes("FINISH");
}

function belongsToSelectedDate(match: Match, dateISO: string) {
  if (match.kickoff) {
    const parsed = new Date(match.kickoff);
    if (!Number.isNaN(parsed.getTime())) {
      return formatAmsterdamDate(parsed) === dateISO;
    }
  }

  return String(match.date || "") === dateISO;
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
  const [selectedDate, setSelectedDate] = useState<string>(isoDate(new Date()));
  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Record<string, any>>({});
  const [standings, setStandings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<"laden" | "klaar" | "fout">("laden");
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterMode>("alle");
  const [selectedLeague, setSelectedLeague] = useState<string>("alle");
  const [favRefresh, setFavRefresh] = useState(0);
  const tabsRef = useRef<HTMLDivElement>(null);
  const learnedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/standings")
      .then((response) => response.json())
      .then((data) => setStandings(data.standings || {}))
      .catch(() => {});
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

        saveToMemory(match.id, `${prediction.predHomeGoals}-${prediction.predAwayGoals}`, match.score, match);
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
  }, [activeFilter, dayMatches, favoriteTeams, selectedLeague]);

  const sortedMatches = useMemo(() => {
    return [...filteredMatches].sort((left, right) => {
      const leftLive = isLive(left);
      const rightLive = isLive(right);
      const leftFinished = isFinished(left);
      const rightFinished = isFinished(right);

      if (leftLive && !rightLive) return -1;
      if (!leftLive && rightLive) return 1;
      if (!leftFinished && rightFinished) return -1;
      if (leftFinished && !rightFinished) return 1;

      return String(left.kickoff || "").localeCompare(String(right.kickoff || ""));
    });
  }, [filteredMatches]);

  const allLeagues = useMemo(() => {
    const present = new Set(dayMatches.map((match) => match.league).filter(Boolean));
    const ordered = LEAGUE_ORDER.filter((league) => present.has(league));
    for (const league of present) {
      if (!LEAGUE_ORDER.includes(league)) ordered.push(league);
    }
    return ordered;
  }, [dayMatches]);

  const liveCount = useMemo(() => dayMatches.filter(isLive).length, [dayMatches]);
  const plannedCount = useMemo(
    () => dayMatches.filter((match) => !isLive(match) && !isFinished(match)).length,
    [dayMatches]
  );
  const finishedCount = useMemo(() => dayMatches.filter(isFinished).length, [dayMatches]);
  const favoriteMatches = useMemo(() => {
    return dayMatches.filter((match) => {
      const homeKey = (match as any).homeTeamId || match.homeTeamName.toLowerCase();
      const awayKey = (match as any).awayTeamId || match.awayTeamName.toLowerCase();
      return favoriteTeams.includes(homeKey) || favoriteTeams.includes(awayKey);
    });
  }, [dayMatches, favoriteTeams]);
  const favoriteCount = favoriteMatches.length;

  const bestBets = useMemo(() => {
    return Object.entries(predictions)
      .map(([matchId, prediction]) => {
        const match = dayMatches.find((entry) => entry.id === matchId);
        if (!match || !prediction || isFinished(match)) return null;

        return {
          ...prediction,
          homeTeam: match.homeTeamName,
          awayTeam: match.awayTeamName,
          league: match.league,
          matchId,
        };
      })
      .filter(Boolean)
      .sort((left: any, right: any) => (right.exactProb || right.confidence || 0) - (left.exactProb || left.confidence || 0))
      .slice(0, 5) as any[];
  }, [dayMatches, predictions]);

  const scrollTabs = (direction: "left" | "right") => {
    tabsRef.current?.scrollBy({
      left: direction === "right" ? 160 : -160,
      behavior: "smooth",
    });
  };

  const lastRunLabel = lastRun
    ? new Date(lastRun).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })
    : null;

  const liveMatches = sortedMatches.filter(isLive);
  const plannedMatches = sortedMatches.filter((match) => !isLive(match) && !isFinished(match));
  const finishedMatches = sortedMatches.filter(isFinished);

  return (
    <div className="min-h-screen pb-20 text-slate-100 bg-[#02020a]">
      <Header currentView={view} onViewChange={setView} />
      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-5">
        {view === "standings" && <StandingsView />}
        {view === "settings" && <SettingsView />}
        {view === "history" && <PredictionHistory />}

        {view === "dashboard" && (
          <>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Datum</div>
                <div className="text-xl font-black text-white tracking-tight">{formatDateLabel(selectedDate)}</div>
                <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      syncStatus === "klaar"
                        ? "bg-green-400"
                        : syncStatus === "laden"
                          ? "bg-yellow-400 animate-pulse"
                          : "bg-red-400"
                    }`}
                  />
                  {syncStatus === "laden"
                    ? "Data laden..."
                    : `Gesynchroniseerd${lastRunLabel ? ` · Worker: ${lastRunLabel}` : ""}`}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => {
                    setSelectedDate(event.target.value);
                    setSelectedLeague("alle");
                    setActiveFilter("alle");
                  }}
                  className="bg-slate-900/70 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none"
                />
                <button
                  onClick={() => {
                    setSelectedDate(isoDate(new Date()));
                    setSelectedLeague("alle");
                    setActiveFilter("alle");
                  }}
                  className="bg-blue-600 text-white rounded-xl px-4 py-2 text-sm font-black hover:bg-blue-500 transition"
                >
                  Vandaag
                </button>
              </div>
            </div>

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

            <div className="flex items-center gap-1 mb-4">
              <button
                onClick={() => scrollTabs("left")}
                className="flex-shrink-0 w-6 h-6 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 text-sm font-black flex items-center justify-center"
              >
                ‹
              </button>

              <div ref={tabsRef} className="flex gap-1 overflow-x-auto scrollbar-hide flex-1 py-0.5">
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

              <button
                onClick={() => scrollTabs("right")}
                className="flex-shrink-0 w-6 h-6 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 text-sm font-black flex items-center justify-center"
              >
                ›
              </button>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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

                {selectedLeague === "alle" && activeFilter === "alle" && bestBets.length > 0 && (
                  <section>
                    <h2 className="text-sm font-black uppercase mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-yellow-400 rounded-full" />
                      Top 5 meest zekere tips
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                      {bestBets.map((bet: any) => (
                        <BestBetCard key={bet.matchId} bet={bet} />
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
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
  );
};

export default App;
