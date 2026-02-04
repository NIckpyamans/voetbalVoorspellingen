import React, { useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header";
import MatchCard from "./components/MatchCard";
import BestBetCard from "./components/BestBetCard";
import PredictionHistory from "./components/PredictionHistory";
import { Match, Prediction, BestBet } from "./types";
import { getEnhancedPrediction, getOrCreateTeam, saveToMemory, updateTeamModelsFromResult } from "./services/geminiService";
import { velocityEngine } from "./services/velocityEngine";

function isoDate(d: Date) {
  return d.toISOString().split("T")[0];
}

function formatDateLabel(dateISO: string) {
  const d = new Date(`${dateISO}T00:00:00`);
  return d.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function isLive(m: Match) {
  const s = (m.status || "").toLowerCase();
  return s.includes("live") || s.includes("1st") || s.includes("2nd") || !!m.minute;
}

function isFinished(m: Match) {
  const s = (m.status || "").toLowerCase();
  return s.includes("ft") || s.includes("finished") || s.includes("end");
}

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<"dashboard" | "history">("dashboard");
  const [selectedDate, setSelectedDate] = useState<string>(isoDate(new Date()));

  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Record<string, Prediction>>({});
  const [loading, setLoading] = useState(true);
  const [socketStatus, setSocketStatus] = useState<"OPEN" | "CLOSED" | "SYNCING">("CLOSED");

  // Prevent duplicate "learning" writes per match
  const learnedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setSocketStatus("SYNCING");

    const unsub = velocityEngine.subscribe(async (newMatches) => {
      setMatches(newMatches);
      setLoading(false);
      setSocketStatus("OPEN");

      // 1) Ensure we have predictions for all matches (fast local model)
      for (const m of newMatches) {
        if (!predictions[m.id]) {
          const pred = await getEnhancedPrediction(m);
          setPredictions((prev) => ({ ...prev, [m.id]: pred }));
        }
      }

      // 2) Learning: when a match is finished and has a final score, store it + update team model
      for (const m of newMatches) {
        if (!isFinished(m)) continue;
        if (!m.score || m.score === "v" || !m.score.includes("-")) continue;
        if (learnedRef.current.has(m.id)) continue;

        const pred = predictions[m.id];
        if (!pred) continue;

        const predScore = `${pred.predHomeGoals}-${pred.predAwayGoals}`;
        saveToMemory(m.id, predScore, m.score);

        // Update per-team model (Elo + attack/defense) so next predictions improve.
        const home = getOrCreateTeam({
          id: m.homeTeamId,
          name: m.homeTeamName,
          league: m.league,
          logo: m.homeLogo,
        });
        const away = getOrCreateTeam({
          id: m.awayTeamId,
          name: m.awayTeamName,
          league: m.league,
          logo: m.awayLogo,
        });
        updateTeamModelsFromResult(m, home, away);

        learnedRef.current.add(m.id);
      }
    });

    velocityEngine.startPulse(selectedDate);
    return () => {
      unsub();
      velocityEngine.stopPulse();
      setSocketStatus("CLOSED");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // When predictions arrive later, run learning pass again (for finished matches)
  useEffect(() => {
    for (const m of matches) {
      if (!isFinished(m)) continue;
      if (!m.score || m.score === "v" || !m.score.includes("-")) continue;
      if (learnedRef.current.has(m.id)) continue;
      const pred = predictions[m.id];
      if (!pred) continue;

      const predScore = `${pred.predHomeGoals}-${pred.predAwayGoals}`;
      saveToMemory(m.id, predScore, m.score);

      const home = getOrCreateTeam({ id: m.homeTeamId, name: m.homeTeamName, league: m.league, logo: m.homeLogo });
      const away = getOrCreateTeam({ id: m.awayTeamId, name: m.awayTeamName, league: m.league, logo: m.awayLogo });
      updateTeamModelsFromResult(m, home, away);

      learnedRef.current.add(m.id);
    }
  }, [predictions, matches]);

  const [liveMatches, upcomingMatches, finishedMatches] = useMemo(() => {
    const live: Match[] = [];
    const upcoming: Match[] = [];
    const finished: Match[] = [];

    for (const m of matches) {
      if (isFinished(m)) finished.push(m);
      else if (isLive(m)) live.push(m);
      else upcoming.push(m);
    }

    return [live, upcoming, finished];
  }, [matches]);

  const dateLabel = useMemo(() => formatDateLabel(selectedDate), [selectedDate]);

  // Expanded state for competitions
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleLeague = (league: string) => {
    setExpanded((prev) => ({ ...prev, [league]: !prev[league] }));
  };

  const groupByLeague = (arr: Match[]) => {
    return arr.reduce((acc: Record<string, Match[]>, m) => {
      const key = m.league || "Unknown";
      acc[key] = acc[key] || [];
      acc[key].push(m);
      return acc;
    }, {});
  };

  const [serverPredictions, setServerPredictions] = useState<any[] | null>(null);

  useEffect(() => {
    const loadServer = async () => {
      try {
        const res = await fetch(`/api/predict?date=${selectedDate}`);
        const j = await res.json();
        if (j?.source === 'server-data' && Array.isArray(j.predictions)) {
          setServerPredictions(j.predictions);
        } else {
          setServerPredictions(null);
        }
      } catch (e) {
        setServerPredictions(null);
      }
    };
    loadServer();
  }, [selectedDate]);

  const bestBets = useMemo(() => {
    // Prefer server predictions when available
    if (serverPredictions && serverPredictions.length) {
      const bets = serverPredictions
        .slice()
        .sort((a: any, b: any) => (b.exactProb ?? b.confidence) - (a.exactProb ?? a.confidence))
        .slice(0, 5);
      return bets as any[];
    }

    const pool = [...liveMatches, ...upcomingMatches];
    const bets = pool
      .map((m) => {
        const p = predictions[m.id];
        if (!p) return null;
        return {
          ...(p as any),
          homeTeam: m.homeTeamName,
          awayTeam: m.awayTeamName,
          league: m.league,
          matchId: m.id,
        } as any;
      })
      .filter(Boolean) as any[];

    bets.sort((a, b) => (b.exactProb ?? b.confidence) - (a.exactProb ?? a.confidence));
    return bets.slice(0, 5) as any[];
  }, [liveMatches, upcomingMatches, predictions, serverPredictions]);

  return (
    <div className="min-h-screen pb-20 text-slate-100 bg-[#02020a]">
      <Header currentView={currentView} onViewChange={setCurrentView} />

      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-6">
        {currentView === "dashboard" ? (
          <>
            {/* Top controls */}
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-slate-500">Datum</div>
                <div className="text-xl md:text-2xl font-black text-white tracking-tight">{dateLabel}</div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Data: SofaScore public feed · AI: lokaal (Elo + Poisson) · Status: {socketStatus}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-slate-900/70 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-blue-500/40"
                />
                <button
                  onClick={() => setSelectedDate(isoDate(new Date()))}
                  className="bg-blue-600/20 border border-blue-500/30 text-blue-200 rounded-xl px-4 py-2 text-sm font-black hover:bg-blue-600/30 transition"
                >
                  Vandaag
                </button>
              </div>
            </div>

            {/* Summary chips */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-10">
              <div className="glass-card p-4 rounded-2xl border border-blue-500/20">
                <div className="text-[10px] font-black text-blue-400 uppercase">Nog te spelen</div>
                <div className="text-2xl font-black">{upcomingMatches.length}</div>
              </div>
              <div className="glass-card p-4 rounded-2xl border border-red-500/20">
                <div className="text-[10px] font-black text-red-400 uppercase">Live</div>
                <div className="text-2xl font-black">{liveMatches.length}</div>
              </div>
              <div className="glass-card p-4 rounded-2xl border border-slate-500/20">
                <div className="text-[10px] font-black text-slate-400 uppercase">Gespeeld</div>
                <div className="text-2xl font-black">{finishedMatches.length}</div>
              </div>
            </div>

            {/* Main content */}
            {loading ? (
              <div className="flex flex-col gap-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-40 glass-card rounded-3xl animate-pulse"></div>
                ))}
              </div>
            ) : (
              <div className="space-y-12">
                {/* Top 5 meest zekere voorspellingen */}
                <section>
                  <h2 className="text-lg md:text-xl font-black uppercase tracking-tight mb-5 flex items-center gap-2">
                    <span className="w-2 h-2 bg-yellow-400 rounded-full"></span> Top 5 meest zekere voorspellingen
                    <span className="text-[10px] font-black text-yellow-300 bg-yellow-900/10 border border-yellow-500/10 px-2 py-1 rounded-full">
                      {(liveMatches.length + upcomingMatches.length)}
                    </span>
                  </h2>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                    {bestBets.length === 0 ? (
                      <div className="text-slate-500 text-sm">Nog geen voorspellingen beschikbaar.</div>
                    ) : (
                      bestBets.map((b) => <BestBetCard key={b.matchId} bet={b} />)
                    )}
                  </div>
                </section>

                {/* Live section grouped by competition */}
                <section>
                  <h2 className="text-lg md:text-xl font-black uppercase tracking-tight mb-5 flex items-center gap-2">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span> Live wedstrijden
                    <span className="text-[10px] font-black text-red-400 bg-red-900/20 border border-red-500/20 px-2 py-1 rounded-full">
                      {liveMatches.length}
                    </span>
                  </h2>

                  {liveMatches.length === 0 ? (
                    <div className="text-slate-500 text-sm">Geen live wedstrijden op dit moment.</div>
                  ) : (
                    Object.entries(groupByLeague(liveMatches)).map(([league, ms]) => (
                      <div key={`live-${league}`} className="mb-6">
                        <button
                          onClick={() => toggleLeague(league)}
                          className="w-full text-left bg-slate-900/40 border border-white/5 rounded-xl px-4 py-3 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <div className="text-sm font-black">{league}</div>
                            <div className="text-xs text-slate-400">{ms.length} wedstrijden</div>
                          </div>
                          <div className="text-xs text-slate-400">{expanded[league] ? '▾' : '▸'}</div>
                        </button>

                        {expanded[league] && (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
                            {ms.map((m) => (
                              <MatchCard key={m.id} match={m} prediction={predictions[m.id]} />
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </section>

                {/* Upcoming grouped by competition */}
                <section>
                  <h2 className="text-lg md:text-xl font-black uppercase tracking-tight mb-5 flex items-center gap-2">
                    <span className="w-2 h-2 bg-blue-500 rounded-full"></span> Nog te spelen
                    <span className="text-[10px] font-black text-blue-300 bg-blue-900/20 border border-blue-500/20 px-2 py-1 rounded-full">
                      {upcomingMatches.length}
                    </span>
                  </h2>

                  {upcomingMatches.length === 0 ? (
                    <div className="text-slate-500 text-sm">Geen komende wedstrijden gevonden voor deze datum.</div>
                  ) : (
                    Object.entries(groupByLeague(upcomingMatches)).map(([league, ms]) => (
                      <div key={`up-${league}`} className="mb-6">
                        <button
                          onClick={() => toggleLeague(league)}
                          className="w-full text-left bg-slate-900/40 border border-white/5 rounded-xl px-4 py-3 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <div className="text-sm font-black">{league}</div>
                            <div className="text-xs text-slate-400">{ms.length} wedstrijden</div>
                          </div>
                          <div className="text-xs text-slate-400">{expanded[league] ? '▾' : '▸'}</div>
                        </button>

                        {expanded[league] && (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
                            {ms.map((m) => (
                              <MatchCard key={m.id} match={m} prediction={predictions[m.id]} />
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </section>

                {/* Finished grouped by competition */}
                <section>
                  <h2 className="text-lg md:text-xl font-black uppercase tracking-tight mb-5 flex items-center gap-2">
                    <span className="w-2 h-2 bg-slate-400 rounded-full"></span> Gespeelde wedstrijden
                    <span className="text-[10px] font-black text-slate-300 bg-slate-800/40 border border-slate-500/20 px-2 py-1 rounded-full">
                      {finishedMatches.length}
                    </span>
                  </h2>

                  {finishedMatches.length === 0 ? (
                    <div className="text-slate-500 text-sm">Nog geen uitslagen binnen voor deze datum.</div>
                  ) : (
                    Object.entries(groupByLeague(finishedMatches)).map(([league, ms]) => (
                      <div key={`fin-${league}`} className="mb-6">
                        <button
                          onClick={() => toggleLeague(league)}
                          className="w-full text-left bg-slate-900/40 border border-white/5 rounded-xl px-4 py-3 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <div className="text-sm font-black">{league}</div>
                            <div className="text-xs text-slate-400">{ms.length} wedstrijden</div>
                          </div>
                          <div className="text-xs text-slate-400">{expanded[league] ? '▾' : '▸'}</div>
                        </button>

                        {expanded[league] && (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
                            {ms.map((m) => (
                              <MatchCard key={m.id} match={m} prediction={predictions[m.id]} />
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </section>
              </div>
            )}
          </>
        ) : (
          <PredictionHistory />
        )}
      </main>
    </div>
  );
};

export default App;
