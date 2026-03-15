import React, { useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header";
import MatchCard from "./components/MatchCard";
import BestBetCard from "./components/BestBetCard";
import PredictionHistory from "./components/PredictionHistory";
import { Match } from "./types";
import { velocityEngine } from "./services/velocityEngine";
import { getOrCreateTeam, saveToMemory, updateTeamModelsFromResult } from "./services/geminiService";

function isoDate(d: Date) { return d.toISOString().split("T")[0]; }

function formatDateLabel(dateISO: string) {
  return new Date(`${dateISO}T12:00:00`).toLocaleDateString("nl-NL", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric"
  });
}

function isLive(m: Match) {
  const s = (m.status || "").toUpperCase();
  return s === "LIVE" || s.includes("1ST") || s.includes("2ND") || !!(m as any).minute;
}

function isFinished(m: Match) {
  const s = (m.status || "").toUpperCase();
  return s === "FT" || s.includes("FINISH") || s.includes("AET");
}

// Vaste competitievolgorde
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
  const [predictions, setPredictions] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<"laden" | "klaar" | "fout">("laden");
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<"alle" | "live" | "gepland" | "gespeeld">("alle");
  const [selectedLeague, setSelectedLeague] = useState<string>("alle");
  const tabsRef = useRef<HTMLDivElement>(null);
  const learnedRef = useRef<Set<string>>(new Set());

  // Wedstrijden + server predictions laden via velocityEngine
  useEffect(() => {
    setLoading(true);
    setSyncStatus("laden");
    setMatches([]);
    setPredictions({});
    learnedRef.current.clear();

    const unsub = velocityEngine.subscribe(({ matches: newMatches, predictions: newPreds, lastRun: lr }) => {
      setMatches(newMatches);
      setPredictions(newPreds);
      setLoading(false);
      setSyncStatus("klaar");
      if (lr) setLastRun(lr);

      // Leren van afgelopen wedstrijden
      for (const m of newMatches) {
        if (!isFinished(m) || !m.score?.includes("-") || learnedRef.current.has(m.id)) continue;
        const pred = newPreds[m.id];
        if (!pred) continue;
        saveToMemory(m.id, `${pred.predHomeGoals}-${pred.predAwayGoals}`, m.score!);
        const home = getOrCreateTeam({ id: m.homeTeamId, name: m.homeTeamName, league: m.league, logo: m.homeLogo });
        const away = getOrCreateTeam({ id: m.awayTeamId, name: m.awayTeamName, league: m.league, logo: m.awayLogo });
        updateTeamModelsFromResult(m, home, away);
        learnedRef.current.add(m.id);
      }
    });

    velocityEngine.startPulse(selectedDate);
    return () => { unsub(); velocityEngine.stopPulse(); };
  }, [selectedDate]);

  // Gefilterde wedstrijden
  const filteredMatches = useMemo(() => {
    let base = selectedLeague === "alle" ? matches : matches.filter(m => m.league === selectedLeague);
    if (activeFilter === "live")     return base.filter(isLive);
    if (activeFilter === "gepland")  return base.filter(m => !isLive(m) && !isFinished(m));
    if (activeFilter === "gespeeld") return base.filter(isFinished);
    return base;
  }, [matches, selectedLeague, activeFilter]);

  // Gesorteerde wedstrijden: live eerst, dan gepland op tijd, dan gespeeld
  const sortedMatches = useMemo(() => {
    return [...filteredMatches].sort((a, b) => {
      const aLive = isLive(a), bLive = isLive(b);
      const aFin = isFinished(a), bFin = isFinished(b);
      if (aLive && !bLive) return -1;
      if (!aLive && bLive) return 1;
      if (!aFin && bFin) return -1;
      if (aFin && !bFin) return 1;
      return (a.kickoff || '').localeCompare(b.kickoff || '');
    });
  }, [filteredMatches]);

  // Unieke competities in vaste volgorde
  const allLeagues = useMemo(() => {
    const present = new Set(matches.map(m => m.league).filter(Boolean));
    const ordered = LEAGUE_ORDER.filter(l => present.has(l));
    for (const l of present) if (!LEAGUE_ORDER.includes(l)) ordered.push(l);
    return ordered;
  }, [matches]);

  // Competitie tabs scrollen
  const scrollTabs = (dir: 'left' | 'right') => {
    tabsRef.current?.scrollBy({ left: dir === 'right' ? 200 : -200, behavior: 'smooth' });
  };

  // Statistieken
  const liveCount     = useMemo(() => matches.filter(isLive).length, [matches]);
  const plannedCount  = useMemo(() => matches.filter(m => !isLive(m) && !isFinished(m)).length, [matches]);
  const finishedCount = useMemo(() => matches.filter(isFinished).length, [matches]);

  // Top 5 beste voorspellingen
  const bestBets = useMemo(() => {
    const pool = Object.entries(predictions)
      .map(([matchId, pred]) => {
        const m = matches.find(m => m.id === matchId);
        if (!m || !pred) return null;
        return { ...pred, homeTeam: m.homeTeamName, awayTeam: m.awayTeamName, league: m.league, matchId };
      })
      .filter(Boolean) as any[];
    return pool
      .sort((a, b) => (b.exactProb ?? b.confidence ?? 0) - (a.exactProb ?? a.confidence ?? 0))
      .slice(0, 5);
  }, [predictions, matches]);

  const lastRunLabel = lastRun
    ? new Date(lastRun).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="min-h-screen pb-20 text-slate-100 bg-[#02020a]">
      <Header currentView={currentView} onViewChange={setCurrentView} />

      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-5">
        {currentView === "dashboard" ? (
          <>
            {/* Datum + navigatie */}
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Datum</div>
                <div className="text-xl font-black text-white tracking-tight">{formatDateLabel(selectedDate)}</div>
                <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${syncStatus === 'klaar' ? 'bg-green-400' : syncStatus === 'laden' ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'}`} />
                  {syncStatus === 'laden' ? 'Data laden...' : syncStatus === 'klaar' ? `Gesynchroniseerd${lastRunLabel ? ` · Worker: ${lastRunLabel}` : ''}` : 'Fout bij laden'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="date" value={selectedDate}
                  onChange={e => { setSelectedDate(e.target.value); setSelectedLeague("alle"); setActiveFilter("alle"); }}
                  className="bg-slate-900/70 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-500/40" />
                <button onClick={() => { setSelectedDate(isoDate(new Date())); setSelectedLeague("alle"); setActiveFilter("alle"); }}
                  className="bg-blue-600 text-white rounded-xl px-4 py-2 text-sm font-black hover:bg-blue-500 transition">
                  Vandaag
                </button>
              </div>
            </div>

            {/* Status tellers */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { key: "gepland",  label: "Gepland",  count: plannedCount,  color: "blue"  },
                { key: "live",     label: "Live",      count: liveCount,     color: "red"   },
                { key: "gespeeld", label: "Gespeeld",  count: finishedCount, color: "slate" },
              ].map(({ key, label, count, color }) => (
                <button key={key}
                  onClick={() => setActiveFilter(activeFilter === key ? "alle" : key as any)}
                  className={`glass-card p-3 rounded-2xl border text-left transition
                    ${activeFilter === key
                      ? `border-${color}-500/60 bg-${color}-900/20`
                      : `border-${color}-500/20 hover:border-${color}-500/30`}`}>
                  <div className={`text-[9px] font-black text-${color}-400 uppercase flex items-center gap-1`}>
                    {key === "live" && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />}
                    {label}
                  </div>
                  <div className="text-xl font-black">{count}</div>
                </button>
              ))}
            </div>

            {/* Competitie tabs */}
            <div className="relative flex items-center gap-1 mb-4">
              <button onClick={() => scrollTabs('left')}
                className="flex-shrink-0 w-7 h-7 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white text-lg font-black flex items-center justify-center transition">
                ‹
              </button>
              <div ref={tabsRef} className="flex gap-1.5 overflow-x-auto scrollbar-hide flex-1 py-0.5">
                <button onClick={() => { setSelectedLeague("alle"); setActiveFilter("alle"); }}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-black transition whitespace-nowrap
                    ${selectedLeague === "alle" ? "bg-white text-black" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                  ⚽ Alle ({matches.length})
                </button>
                {allLeagues.map(league => {
                  const parts   = league.split(' ');
                  const flag    = parts[0];
                  const name    = parts.slice(1).join(' ');
                  const total   = matches.filter(m => m.league === league).length;
                  const liveCnt = matches.filter(m => m.league === league && isLive(m)).length;
                  return (
                    <button key={league} onClick={() => setSelectedLeague(league)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-black transition whitespace-nowrap flex items-center gap-1
                        ${selectedLeague === league ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                      <span>{flag}</span>
                      <span>{name}</span>
                      <span className={`text-[8px] px-1 rounded ${liveCnt > 0 ? 'bg-red-500 text-white animate-pulse' : 'opacity-50'}`}>
                        {liveCnt > 0 ? `${liveCnt}🔴` : total}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button onClick={() => scrollTabs('right')}
                className="flex-shrink-0 w-7 h-7 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white text-lg font-black flex items-center justify-center transition">
                ›
              </button>
            </div>

            {/* Inhoud */}
            {loading ? (
              <div className="flex flex-col gap-3">
                {[1,2,3,4,5,6].map(i => (
                  <div key={i} className="h-20 glass-card rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Top 5 beste tips */}
                {selectedLeague === "alle" && activeFilter === "alle" && bestBets.length > 0 && (
                  <section>
                    <h2 className="text-sm font-black uppercase tracking-tight mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-yellow-400 rounded-full" />
                      Top 5 meest zekere tips
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                      {bestBets.map((b: any) => <BestBetCard key={b.matchId} bet={b} />)}
                    </div>
                  </section>
                )}

                {/* ALLE wedstrijden plat (geen groepering per competitie) */}
                {sortedMatches.length === 0 ? (
                  <div className="text-center py-16 text-slate-500">
                    <div className="text-5xl mb-3">⚽</div>
                    <div className="font-bold">Geen wedstrijden voor deze selectie</div>
                    {syncStatus === 'klaar' && matches.length === 0 && (
                      <div className="text-[11px] mt-2 text-slate-600">
                        Start de GitHub Actions worker om wedstrijden te laden
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Sectiekopjes per status (alleen als filter "alle") */}
                    {activeFilter === "alle" && liveCount > 0 && (
                      <section>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                          <span className="text-sm font-black uppercase">Live ({liveCount})</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {sortedMatches.filter(isLive).map(m => (
                            <MatchCard key={m.id} match={m} prediction={predictions[m.id]} />
                          ))}
                        </div>
                      </section>
                    )}

                    {activeFilter === "alle" && plannedCount > 0 && (
                      <section>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="w-2 h-2 bg-blue-500 rounded-full" />
                          <span className="text-sm font-black uppercase">Nog te spelen ({plannedCount})</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {sortedMatches.filter(m => !isLive(m) && !isFinished(m)).map(m => (
                            <MatchCard key={m.id} match={m} prediction={predictions[m.id]} />
                          ))}
                        </div>
                      </section>
                    )}

                    {activeFilter === "alle" && finishedCount > 0 && (
                      <section>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="w-2 h-2 bg-slate-400 rounded-full" />
                          <span className="text-sm font-black uppercase">Gespeeld ({finishedCount})</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {sortedMatches.filter(isFinished).map(m => (
                            <MatchCard key={m.id} match={m} prediction={predictions[m.id]} />
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Als gefilterd op status of competitie: gewoon een grid */}
                    {activeFilter !== "alle" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {sortedMatches.map(m => (
                          <MatchCard key={m.id} match={m} prediction={predictions[m.id]} />
                        ))}
                      </div>
                    )}
                  </>
                )}
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
