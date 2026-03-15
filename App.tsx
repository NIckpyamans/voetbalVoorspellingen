import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Header from "./components/Header";
import MatchCard from "./components/MatchCard";
import BestBetCard from "./components/BestBetCard";
import PredictionHistory from "./components/PredictionHistory";
import LivePanel from "./components/LivePanel";
import { Match, Prediction, BestBet } from "./types";
import { getEnhancedPrediction, getOrCreateTeam, saveToMemory, updateTeamModelsFromResult } from "./services/geminiService";
import { velocityEngine } from "./services/velocityEngine";

function isoDate(d: Date) { return d.toISOString().split("T")[0]; }

function formatDateLabel(dateISO: string) {
  const d = new Date(`${dateISO}T00:00:00`);
  return d.toLocaleDateString("nl-NL", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function isLive(m: Match) {
  const s = (m.status || "").toLowerCase();
  return s === "live" || s.includes("1st") || s.includes("2nd") || s.includes("ht") || !!m.minute;
}

function isFinished(m: Match) {
  const s = (m.status || "").toLowerCase();
  return s === "ft" || s.includes("finished") || s.includes("end") || s.includes("aet");
}

// Vlag emoji op basis van land
function getLeagueFlag(league: string): string {
  const l = league.toLowerCase();
  if (l.includes('england') || l.includes('premier league') || l.includes('championship')) return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
  if (l.includes('netherlands') || l.includes('eredivisie') || l.includes('eerste divisie')) return '🇳🇱';
  if (l.includes('germany') || l.includes('bundesliga')) return '🇩🇪';
  if (l.includes('spain') || l.includes('laliga') || l.includes('la liga')) return '🇪🇸';
  if (l.includes('italy') || l.includes('serie')) return '🇮🇹';
  if (l.includes('france') || l.includes('ligue')) return '🇫🇷';
  if (l.includes('portugal') || l.includes('liga portugal')) return '🇵🇹';
  if (l.includes('belgium') || l.includes('pro league')) return '🇧🇪';
  if (l.includes('champions league')) return '🏆';
  if (l.includes('europa league')) return '🥈';
  if (l.includes('conference league')) return '🥉';
  if (l.includes('scotland')) return '🏴󠁧󠁢󠁳󠁣󠁴󠁿';
  if (l.includes('turkey') || l.includes('süper lig')) return '🇹🇷';
  if (l.includes('greece')) return '🇬🇷';
  if (l.includes('austria')) return '🇦🇹';
  if (l.includes('switzerland')) return '🇨🇭';
  if (l.includes('denmark') || l.includes('superliga')) return '🇩🇰';
  if (l.includes('norway')) return '🇳🇴';
  if (l.includes('sweden')) return '🇸🇪';
  if (l.includes('poland')) return '🇵🇱';
  if (l.includes('czech')) return '🇨🇿';
  if (l.includes('romania')) return '🇷🇴';
  if (l.includes('croatia')) return '🇭🇷';
  if (l.includes('serbia')) return '🇷🇸';
  if (l.includes('russia')) return '🇷🇺';
  return '⚽';
}

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<"dashboard" | "history">("dashboard");
  const [selectedDate, setSelectedDate] = useState<string>(isoDate(new Date()));
  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Record<string, Prediction>>({});
  const [loading, setLoading] = useState(true);
  const [socketStatus, setSocketStatus] = useState<"OPEN" | "CLOSED" | "SYNCING">("CLOSED");
  const [activeTab, setActiveTab] = useState<"alle" | "live" | "gepland" | "gespeeld" | string>("alle");
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [livePanelOpen, setLivePanelOpen] = useState(false);
  const [serverPredictions, setServerPredictions] = useState<any[] | null>(null);
  const learnedRef = useRef<Set<string>>(new Set());
  const predLoadedRef = useRef<Set<string>>(new Set());

  // Laad server voorspellingen
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/predict?date=${selectedDate}`);
        const j = await res.json();
        if (j?.predictions?.length > 0) setServerPredictions(j.predictions);
        else setServerPredictions(null);
      } catch { setServerPredictions(null); }
    };
    load();
  }, [selectedDate]);

  // Laad wedstrijden via velocity engine
  useEffect(() => {
    setLoading(true);
    setSocketStatus("SYNCING");
    setMatches([]);
    predLoadedRef.current.clear();

    const unsub = velocityEngine.subscribe(async (newMatches) => {
      setMatches(newMatches);
      setLoading(false);
      setSocketStatus("OPEN");

      // Voorspellingen laden in batches (niet alles tegelijk = sneller)
      const unloaded = newMatches.filter(m => !predLoadedRef.current.has(m.id));
      for (const m of unloaded) {
        predLoadedRef.current.add(m.id);
        getEnhancedPrediction(m).then(pred => {
          setPredictions(prev => ({ ...prev, [m.id]: pred }));
        });
      }

      // Leren van afgelopen wedstrijden
      for (const m of newMatches) {
        if (!isFinished(m) || !m.score || m.score === "v" || !m.score.includes("-")) continue;
        if (learnedRef.current.has(m.id)) continue;
        const pred = predictions[m.id];
        if (!pred) continue;
        saveToMemory(m.id, `${pred.predHomeGoals}-${pred.predAwayGoals}`, m.score);
        const home = getOrCreateTeam({ id: m.homeTeamId, name: m.homeTeamName, league: m.league, logo: m.homeLogo });
        const away = getOrCreateTeam({ id: m.awayTeamId, name: m.awayTeamName, league: m.league, logo: m.awayLogo });
        updateTeamModelsFromResult(m, home, away);
        learnedRef.current.add(m.id);
      }
    });

    velocityEngine.startPulse(selectedDate);
    return () => { unsub(); velocityEngine.stopPulse(); setSocketStatus("CLOSED"); };
  }, [selectedDate]);

  // Leren als predictions later aankomen
  useEffect(() => {
    for (const m of matches) {
      if (!isFinished(m) || !m.score || m.score === "v" || !m.score.includes("-")) continue;
      if (learnedRef.current.has(m.id)) continue;
      const pred = predictions[m.id];
      if (!pred) continue;
      saveToMemory(m.id, `${pred.predHomeGoals}-${pred.predAwayGoals}`, m.score);
      const home = getOrCreateTeam({ id: m.homeTeamId, name: m.homeTeamName, league: m.league, logo: m.homeLogo });
      const away = getOrCreateTeam({ id: m.awayTeamId, name: m.awayTeamName, league: m.league, logo: m.awayLogo });
      updateTeamModelsFromResult(m, home, away);
      learnedRef.current.add(m.id);
    }
  }, [predictions, matches]);

  // Groepeer per competitie
  const groupByLeague = useCallback((arr: Match[]) => {
    return arr.reduce((acc: Record<string, Match[]>, m) => {
      const key = m.league || "Unknown";
      acc[key] = acc[key] || [];
      acc[key].push(m);
      return acc;
    }, {});
  }, []);

  const liveMatches = useMemo(() => matches.filter(isLive), [matches]);
  const upcomingMatches = useMemo(() => matches.filter(m => !isLive(m) && !isFinished(m)), [matches]);
  const finishedMatches = useMemo(() => matches.filter(isFinished), [matches]);

  // Alle unieke competities
  const allLeagues = useMemo(() => {
    const leagues = [...new Set(matches.map(m => m.league).filter(Boolean))];
    return leagues.sort((a, b) => {
      // UEFA eerst, dan op naam
      const aUefa = a.toLowerCase().includes('champions') || a.toLowerCase().includes('europa') || a.toLowerCase().includes('conference');
      const bUefa = b.toLowerCase().includes('champions') || b.toLowerCase().includes('europa') || b.toLowerCase().includes('conference');
      if (aUefa && !bUefa) return -1;
      if (!aUefa && bUefa) return 1;
      return a.localeCompare(b);
    });
  }, [matches]);

  // Welke matches worden getoond op basis van actieve tab/competitie
  const displayedMatches = useMemo(() => {
    if (selectedLeague) return matches.filter(m => m.league === selectedLeague);
    if (activeTab === "live") return liveMatches;
    if (activeTab === "gepland") return upcomingMatches;
    if (activeTab === "gespeeld") return finishedMatches;
    return matches; // alle
  }, [matches, liveMatches, upcomingMatches, finishedMatches, activeTab, selectedLeague]);

  const displayedByLeague = useMemo(() => {
    const grouped = groupByLeague(displayedMatches);
    return Object.entries(grouped).sort((a, b) => {
      const aUefa = a[0].toLowerCase().includes('champions') || a[0].toLowerCase().includes('europa');
      const bUefa = b[0].toLowerCase().includes('champions') || b[0].toLowerCase().includes('europa');
      if (aUefa && !bUefa) return -1;
      if (!aUefa && bUefa) return 1;
      return b[1].length - a[1].length;
    });
  }, [displayedMatches, groupByLeague]);

  const [expandedLeagues, setExpandedLeagues] = useState<Record<string, boolean>>({});
  const toggleLeague = (league: string) => {
    setExpandedLeagues(prev => ({ ...prev, [league]: !prev[league] }));
  };

  const bestBets = useMemo(() => {
    if (serverPredictions?.length) {
      return serverPredictions
        .sort((a: any, b: any) => (b.exactProb ?? b.confidence) - (a.exactProb ?? a.confidence))
        .slice(0, 5);
    }
    return [...liveMatches, ...upcomingMatches]
      .map(m => {
        const p = predictions[m.id];
        if (!p) return null;
        return { ...p, homeTeam: m.homeTeamName, awayTeam: m.awayTeamName, league: m.league, matchId: m.id };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => (b.exactProb ?? b.confidence) - (a.exactProb ?? a.confidence))
      .slice(0, 5) as any[];
  }, [liveMatches, upcomingMatches, predictions, serverPredictions]);

  const dateLabel = useMemo(() => formatDateLabel(selectedDate), [selectedDate]);

  return (
    <div className="min-h-screen pb-20 text-slate-100 bg-[#02020a]">
      <Header currentView={currentView} onViewChange={setCurrentView} />

      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-6">
        {currentView === "dashboard" ? (
          <>
            {/* Datum + navigatie */}
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-slate-500">Datum</div>
                <div className="text-xl md:text-2xl font-black text-white tracking-tight">{dateLabel}</div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Data: SofaScore · AI: Elo + Poisson · Status: <span className={socketStatus === "OPEN" ? "text-green-400" : socketStatus === "SYNCING" ? "text-yellow-400" : "text-red-400"}>{socketStatus}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={e => { setSelectedDate(e.target.value); setSelectedLeague(null); setActiveTab("alle"); }}
                  className="bg-slate-900/70 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-blue-500/40"
                />
                <button
                  onClick={() => { setSelectedDate(isoDate(new Date())); setSelectedLeague(null); setActiveTab("alle"); }}
                  className="bg-blue-600/20 border border-blue-500/30 text-blue-200 rounded-xl px-4 py-2 text-sm font-black hover:bg-blue-600/30 transition"
                >Vandaag</button>
              </div>
            </div>

            {/* Statistieken */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <button onClick={() => { setActiveTab("gepland"); setSelectedLeague(null); }}
                className={`glass-card p-4 rounded-2xl border transition ${activeTab === "gepland" && !selectedLeague ? "border-blue-500/50 bg-blue-900/20" : "border-blue-500/20 hover:border-blue-500/40"}`}>
                <div className="text-[10px] font-black text-blue-400 uppercase">Nog te spelen</div>
                <div className="text-2xl font-black">{upcomingMatches.length}</div>
              </button>
              <button onClick={() => { setActiveTab("live"); setSelectedLeague(null); }}
                className={`glass-card p-4 rounded-2xl border transition ${activeTab === "live" && !selectedLeague ? "border-red-500/50 bg-red-900/20" : "border-red-500/20 hover:border-red-500/40"}`}>
                <div className="text-[10px] font-black text-red-400 uppercase flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span> Live
                </div>
                <div className="text-2xl font-black">{liveMatches.length}</div>
              </button>
              <button onClick={() => { setActiveTab("gespeeld"); setSelectedLeague(null); }}
                className={`glass-card p-4 rounded-2xl border transition ${activeTab === "gespeeld" && !selectedLeague ? "border-slate-400/50 bg-slate-800/40" : "border-slate-500/20 hover:border-slate-400/40"}`}>
                <div className="text-[10px] font-black text-slate-400 uppercase">Gespeeld</div>
                <div className="text-2xl font-black">{finishedMatches.length}</div>
              </button>
            </div>

            {/* Competitie tabs */}
            <div className="mb-6 overflow-x-auto scrollbar-hide">
              <div className="flex gap-2 pb-2 min-w-max">
                <button
                  onClick={() => { setSelectedLeague(null); setActiveTab("alle"); }}
                  className={`px-4 py-2 rounded-xl text-xs font-black transition whitespace-nowrap ${!selectedLeague && activeTab === "alle" ? "bg-white text-black" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                >
                  ⚽ Alle ({matches.length})
                </button>
                {allLeagues.map(league => {
                  const count = matches.filter(m => m.league === league).length;
                  const isActive = selectedLeague === league;
                  return (
                    <button
                      key={league}
                      onClick={() => { setSelectedLeague(league); setActiveTab("alle"); }}
                      className={`px-3 py-2 rounded-xl text-xs font-black transition whitespace-nowrap ${isActive ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                    >
                      {getLeagueFlag(league)} {league.split(' — ')[1] || league} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            {loading ? (
              <div className="flex flex-col gap-4">
                {[1,2,3].map(i => <div key={i} className="h-32 glass-card rounded-3xl animate-pulse"></div>)}
              </div>
            ) : (
              <div className="space-y-10">
                {/* Top 5 beste voorspellingen */}
                {!selectedLeague && activeTab === "alle" && (
                  <section>
                    <h2 className="text-lg font-black uppercase tracking-tight mb-4 flex items-center gap-2">
                      <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
                      Top 5 meest zekere voorspellingen
                      <span className="text-[10px] font-black text-yellow-300 bg-yellow-900/10 border border-yellow-500/10 px-2 py-1 rounded-full">{bestBets.length}</span>
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
                      {bestBets.length === 0
                        ? <div className="text-slate-500 text-sm col-span-5">Voorspellingen worden geladen...</div>
                        : bestBets.map((b: any) => <BestBetCard key={b.matchId} bet={b} />)
                      }
                    </div>
                  </section>
                )}

                {/* Wedstrijden per competitie */}
                {displayedByLeague.length === 0 ? (
                  <div className="text-slate-500 text-center py-20">
                    <div className="text-4xl mb-4">⚽</div>
                    <div className="font-bold">Geen wedstrijden gevonden</div>
                  </div>
                ) : (
                  displayedByLeague.map(([league, ms]) => {
                    const isOpen = expandedLeagues[league] !== false; // standaard open
                    const liveMsInLeague = ms.filter(isLive);
                    return (
                      <section key={league}>
                        <button
                          onClick={() => toggleLeague(league)}
                          className="w-full text-left bg-slate-900/50 border border-white/5 hover:border-white/10 rounded-2xl px-5 py-4 flex items-center justify-between transition mb-3"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xl">{getLeagueFlag(league)}</span>
                            <div>
                              <div className="text-sm font-black text-white">{league}</div>
                              <div className="text-[10px] text-slate-500">{ms.length} wedstrijden</div>
                            </div>
                            {liveMsInLeague.length > 0 && (
                              <span className="flex items-center gap-1 bg-red-600/20 border border-red-500/30 text-red-400 text-[9px] font-black px-2 py-0.5 rounded-full animate-pulse">
                                ● {liveMsInLeague.length} LIVE
                              </span>
                            )}
                          </div>
                          <span className="text-slate-500 text-sm">{isOpen ? "▾" : "▸"}</span>
                        </button>

                        {isOpen && (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {ms.map(m => (
                              <MatchCard key={m.id} match={m} prediction={predictions[m.id]} />
                            ))}
                          </div>
                        )}
                      </section>
                    );
                  })
                )}
              </div>
            )}
          </>
        ) : (
          <PredictionHistory />
        )}
      </main>

      <LivePanel
        open={livePanelOpen}
        onClose={() => setLivePanelOpen(false)}
        liveMatches={liveMatches}
        onJumpToLeague={(league) => {
          setSelectedLeague(league);
          setLivePanelOpen(false);
        }}
      />
    </div>
  );
};

export default App;
