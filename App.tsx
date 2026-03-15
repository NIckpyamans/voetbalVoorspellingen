import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Header from "./components/Header";
import MatchCard from "./components/MatchCard";
import BestBetCard from "./components/BestBetCard";
import PredictionHistory from "./components/PredictionHistory";
import LivePanel from "./components/LivePanel";
import { Match, Prediction } from "./types";
import { getEnhancedPrediction, getOrCreateTeam, saveToMemory, updateTeamModelsFromResult } from "./services/geminiService";
import { velocityEngine } from "./services/velocityEngine";

function isoDate(d: Date) { return d.toISOString().split("T")[0]; }

function formatDateLabel(dateISO: string) {
  const d = new Date(`${dateISO}T00:00:00`);
  return d.toLocaleDateString("nl-NL", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function isLive(m: Match) {
  const s = (m.status || "").toUpperCase();
  return s === "LIVE" || s.includes("1ST") || s.includes("2ND") || !!m.minute;
}

function isFinished(m: Match) {
  const s = (m.status || "").toUpperCase();
  return s === "FT" || s.includes("FINISH") || s.includes("AET");
}

// Vaste volgorde voor competities
const LEAGUE_ORDER = [
  '🏆 Champions League', '🥈 Europa League', '🥉 Conference League',
  '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League', '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Championship',
  '🇳🇱 Eredivisie', '🇳🇱 Eerste Divisie', '🇳🇱 KNVB Beker',
  '🇩🇪 Bundesliga', '🇩🇪 2. Bundesliga',
  '🇪🇸 LaLiga', '🇪🇸 LaLiga2',
  '🇮🇹 Serie A', '🇮🇹 Serie B',
  '🇫🇷 Ligue 1', '🇫🇷 Ligue 2',
  '🇵🇹 Liga Portugal', '🇵🇹 Liga Portugal 2',
  '🇧🇪 Pro League', '🇧🇪 Challenger Pro League',
];

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<"dashboard" | "history">("dashboard");
  const [selectedDate, setSelectedDate] = useState<string>(isoDate(new Date()));
  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Record<string, Prediction>>({});
  const [loading, setLoading] = useState(true);
  const [socketStatus, setSocketStatus] = useState<"OPEN" | "CLOSED" | "SYNCING">("CLOSED");
  const [selectedLeague, setSelectedLeague] = useState<string>("alle");
  const [activeStatus, setActiveStatus] = useState<"alle" | "live" | "gepland" | "gespeeld">("alle");
  const [livePanelOpen, setLivePanelOpen] = useState(false);
  const [serverPredictions, setServerPredictions] = useState<any[] | null>(null);
  const [expandedLeagues, setExpandedLeagues] = useState<Record<string, boolean>>({});
  const learnedRef = useRef<Set<string>>(new Set());
  const predLoadedRef = useRef<Set<string>>(new Set());
  const tabsRef = useRef<HTMLDivElement>(null);

  // Server voorspellingen
  useEffect(() => {
    fetch(`/api/predict?date=${selectedDate}`)
      .then(r => r.json())
      .then(j => setServerPredictions(j?.predictions?.length > 0 ? j.predictions : null))
      .catch(() => setServerPredictions(null));
  }, [selectedDate]);

  // Wedstrijden laden
  useEffect(() => {
    setLoading(true);
    setSocketStatus("SYNCING");
    setMatches([]);
    predLoadedRef.current.clear();

    const unsub = velocityEngine.subscribe(async (newMatches) => {
      setMatches(newMatches);
      setLoading(false);
      setSocketStatus("OPEN");

      // Voorspellingen in batches laden
      const unloaded = newMatches.filter(m => !predLoadedRef.current.has(m.id));
      for (const m of unloaded) {
        predLoadedRef.current.add(m.id);
        getEnhancedPrediction(m).then(pred =>
          setPredictions(prev => ({ ...prev, [m.id]: pred }))
        );
      }

      // Leren van resultaten
      for (const m of newMatches) {
        if (!isFinished(m) || !m.score?.includes("-") || learnedRef.current.has(m.id)) continue;
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

  // Extra leermoment als predictions later aankomen
  useEffect(() => {
    for (const m of matches) {
      if (!isFinished(m) || !m.score?.includes("-") || learnedRef.current.has(m.id)) continue;
      const pred = predictions[m.id];
      if (!pred) continue;
      saveToMemory(m.id, `${pred.predHomeGoals}-${pred.predAwayGoals}`, m.score);
      const home = getOrCreateTeam({ id: m.homeTeamId, name: m.homeTeamName, league: m.league, logo: m.homeLogo });
      const away = getOrCreateTeam({ id: m.awayTeamId, name: m.awayTeamName, league: m.league, logo: m.awayLogo });
      updateTeamModelsFromResult(m, home, away);
      learnedRef.current.add(m.id);
    }
  }, [predictions, matches]);

  const liveMatches = useMemo(() => matches.filter(isLive), [matches]);
  const upcomingMatches = useMemo(() => matches.filter(m => !isLive(m) && !isFinished(m)), [matches]);
  const finishedMatches = useMemo(() => matches.filter(isFinished), [matches]);

  // Unieke competities in vaste volgorde
  const allLeagues = useMemo(() => {
    const present = new Set(matches.map(m => m.league).filter(Boolean));
    const ordered = LEAGUE_ORDER.filter(l => present.has(l));
    // Voeg eventuele onbekende competities toe aan het einde
    for (const l of present) if (!LEAGUE_ORDER.includes(l)) ordered.push(l);
    return ordered;
  }, [matches]);

  // Gefilterde wedstrijden
  const filteredMatches = useMemo(() => {
    let base = selectedLeague === "alle" ? matches : matches.filter(m => m.league === selectedLeague);
    if (activeStatus === "live") return base.filter(isLive);
    if (activeStatus === "gepland") return base.filter(m => !isLive(m) && !isFinished(m));
    if (activeStatus === "gespeeld") return base.filter(isFinished);
    return base;
  }, [matches, selectedLeague, activeStatus]);

  // Groepeer per competitie in vaste volgorde
  const groupedMatches = useMemo(() => {
    const grouped: Record<string, Match[]> = {};
    for (const m of filteredMatches) {
      grouped[m.league] = grouped[m.league] || [];
      grouped[m.league].push(m);
    }
    const ordered = LEAGUE_ORDER.filter(l => grouped[l]);
    for (const l of Object.keys(grouped)) if (!LEAGUE_ORDER.includes(l)) ordered.push(l);
    return ordered.map(l => [l, grouped[l]] as [string, Match[]]);
  }, [filteredMatches]);

  const bestBets = useMemo(() => {
    const pool = serverPredictions?.length ? serverPredictions :
      [...liveMatches, ...upcomingMatches].map(m => {
        const p = predictions[m.id];
        return p ? { ...p, homeTeam: m.homeTeamName, awayTeam: m.awayTeamName, league: m.league, matchId: m.id } : null;
      }).filter(Boolean);
    return (pool as any[]).sort((a, b) => (b.exactProb ?? b.confidence) - (a.exactProb ?? a.confidence)).slice(0, 5);
  }, [liveMatches, upcomingMatches, predictions, serverPredictions]);

  const scrollTabs = (dir: 'left' | 'right') => {
    if (tabsRef.current) tabsRef.current.scrollBy({ left: dir === 'right' ? 200 : -200, behavior: 'smooth' });
  };

  const dateLabel = useMemo(() => formatDateLabel(selectedDate), [selectedDate]);

  return (
    <div className="min-h-screen pb-20 text-slate-100 bg-[#02020a]">
      <Header currentView={currentView} onViewChange={setCurrentView} />

      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-6">
        {currentView === "dashboard" ? (
          <>
            {/* Datum */}
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-5">
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-slate-500">Datum</div>
                <div className="text-xl md:text-2xl font-black text-white tracking-tight">{dateLabel}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  SofaScore · Elo+Poisson AI ·{" "}
                  <span className={socketStatus === "OPEN" ? "text-green-400" : socketStatus === "SYNCING" ? "text-yellow-400 animate-pulse" : "text-red-400"}>
                    ● {socketStatus}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="date" value={selectedDate}
                  onChange={e => { setSelectedDate(e.target.value); setSelectedLeague("alle"); setActiveStatus("alle"); }}
                  className="bg-slate-900/70 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-500/40" />
                <button onClick={() => { setSelectedDate(isoDate(new Date())); setSelectedLeague("alle"); setActiveStatus("alle"); }}
                  className="bg-blue-600 text-white rounded-xl px-4 py-2 text-sm font-black hover:bg-blue-500 transition">
                  Vandaag
                </button>
              </div>
            </div>

            {/* Status filters */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { key: "gepland", label: "Gepland", count: upcomingMatches.length, color: "blue" },
                { key: "live", label: "Live", count: liveMatches.length, color: "red" },
                { key: "gespeeld", label: "Gespeeld", count: finishedMatches.length, color: "slate" },
              ].map(({ key, label, count, color }) => (
                <button key={key}
                  onClick={() => setActiveStatus(activeStatus === key ? "alle" : key as any)}
                  className={`glass-card p-3 rounded-2xl border text-left transition ${activeStatus === key ? `border-${color}-500/60 bg-${color}-900/20` : `border-${color}-500/20 hover:border-${color}-500/30`}`}>
                  <div className={`text-[9px] font-black text-${color}-400 uppercase flex items-center gap-1`}>
                    {key === "live" && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>}
                    {label}
                  </div>
                  <div className="text-xl font-black">{count}</div>
                </button>
              ))}
            </div>

            {/* Competitie tabs met pijlen */}
            <div className="relative flex items-center gap-1 mb-5">
              <button onClick={() => scrollTabs('left')}
                className="flex-shrink-0 w-7 h-7 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center text-slate-400 hover:text-white transition z-10">
                ‹
              </button>

              <div ref={tabsRef} className="flex gap-1.5 overflow-x-auto scrollbar-hide flex-1 py-1">
                {/* Alle knop */}
                <button
                  onClick={() => setSelectedLeague("alle")}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-black transition ${selectedLeague === "alle" ? "bg-white text-black" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                  ⚽ Alle ({matches.length})
                </button>

                {allLeagues.map(league => {
                  const parts = league.split(' ');
                  const flag = parts[0]; // emoji
                  const name = parts.slice(1).join(' '); // naam zonder emoji
                  const count = matches.filter(m => m.league === league).length;
                  const liveCount = liveMatches.filter(m => m.league === league).length;
                  const isActive = selectedLeague === league;

                  return (
                    <button key={league}
                      onClick={() => setSelectedLeague(league)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-black transition flex items-center gap-1 ${isActive ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                      <span>{flag}</span>
                      <span className="whitespace-nowrap">{name}</span>
                      <span className={`text-[9px] px-1 rounded ${liveCount > 0 ? 'bg-red-500 text-white animate-pulse' : 'opacity-60'}`}>
                        {liveCount > 0 ? `${liveCount}🔴` : count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button onClick={() => scrollTabs('right')}
                className="flex-shrink-0 w-7 h-7 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center text-slate-400 hover:text-white transition">
                ›
              </button>
            </div>

            {/* Inhoud */}
            {loading ? (
              <div className="flex flex-col gap-3">
                {[1,2,3].map(i => <div key={i} className="h-24 glass-card rounded-2xl animate-pulse"></div>)}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Top 5 beste tips */}
                {selectedLeague === "alle" && activeStatus === "alle" && bestBets.length > 0 && (
                  <section>
                    <h2 className="text-sm font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
                      Top 5 meest zekere tips
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                      {bestBets.map((b: any) => <BestBetCard key={b.matchId} bet={b} />)}
                    </div>
                  </section>
                )}

                {/* Wedstrijden per competitie */}
                {groupedMatches.length === 0 ? (
                  <div className="text-center py-16 text-slate-500">
                    <div className="text-5xl mb-3">⚽</div>
                    <div className="font-bold">Geen wedstrijden voor deze selectie</div>
                  </div>
                ) : (
                  groupedMatches.map(([league, ms]) => {
                    const isOpen = expandedLeagues[league] !== false;
                    const liveCnt = ms.filter(isLive).length;
                    const parts = league.split(' ');
                    const flag = parts[0];
                    const name = parts.slice(1).join(' ');

                    return (
                      <section key={league}>
                        <button
                          onClick={() => setExpandedLeagues(p => ({ ...p, [league]: !isOpen }))}
                          className="w-full text-left bg-slate-900/60 border border-white/5 hover:border-white/10 rounded-xl px-4 py-3 flex items-center justify-between transition mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{flag}</span>
                            <span className="text-sm font-black text-white">{name}</span>
                            <span className="text-[10px] text-slate-500">{ms.length} wedstr.</span>
                            {liveCnt > 0 && (
                              <span className="bg-red-600/20 border border-red-500/30 text-red-400 text-[8px] font-black px-1.5 py-0.5 rounded-full animate-pulse">
                                ● {liveCnt} LIVE
                              </span>
                            )}
                          </div>
                          <span className="text-slate-500">{isOpen ? "▾" : "▸"}</span>
                        </button>

                        {isOpen && (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {ms.sort((a, b) => {
                              // Live eerst, dan gepland, dan gespeeld
                              if (isLive(a) && !isLive(b)) return -1;
                              if (!isLive(a) && isLive(b)) return 1;
                              return (a.kickoff || '').localeCompare(b.kickoff || '');
                            }).map(m => (
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
        onJumpToLeague={(league) => { setSelectedLeague(league); setLivePanelOpen(false); }}
      />
    </div>
  );
};

export default App;
