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
  return s === "LIVE" || !!(m as any).minute;
}
function isFinished(m: Match) {
  const s = (m.status || "").toUpperCase();
  return s === "FT" || s.includes("FINISH");
}

// Korte namen voor tabs
function shortLeagueName(league: string): string {
  const map: Record<string, string> = {
    '🏆 Champions League': '🏆 UCL',
    '🥈 Europa League': '🥈 UEL',
    '🥉 Conference League': '🥉 UECL',
    '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League': '🏴󠁧󠁢󠁥󠁮󠁧󠁿 PL',
    '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Championship': '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Champ',
    '🇳🇱 Eredivisie': '🇳🇱 Ere',
    '🇳🇱 Eerste Divisie': '🇳🇱 Eerste',
    '🇳🇱 KNVB Beker': '🇳🇱 Beker',
    '🇩🇪 Bundesliga': '🇩🇪 BL1',
    '🇩🇪 2. Bundesliga': '🇩🇪 BL2',
    '🇪🇸 LaLiga': '🇪🇸 LL1',
    '🇪🇸 LaLiga2': '🇪🇸 LL2',
    '🇮🇹 Serie A': '🇮🇹 SA',
    '🇮🇹 Serie B': '🇮🇹 SB',
    '🇫🇷 Ligue 1': '🇫🇷 L1',
    '🇫🇷 Ligue 2': '🇫🇷 L2',
    '🇵🇹 Liga Portugal': '🇵🇹 LP1',
    '🇵🇹 Liga Portugal 2': '🇵🇹 LP2',
    '🇧🇪 Pro League': '🇧🇪 Pro',
    '🇧🇪 Challenger Pro League': '🇧🇪 Chall',
  };
  // Probeer exacte match
  if (map[league]) return map[league];
  // Haal flag + eerste woord op als fallback
  const parts = league.split(' ');
  return parts.slice(0, 2).join(' ');
}

const LEAGUE_ORDER = [
  '🏆 Champions League','🥈 Europa League','🥉 Conference League',
  '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League','🏴󠁧󠁢󠁥󠁮󠁧󠁿 Championship',
  '🇳🇱 Eredivisie','🇳🇱 Eerste Divisie','🇳🇱 KNVB Beker',
  '🇩🇪 Bundesliga','🇩🇪 2. Bundesliga',
  '🇪🇸 LaLiga','🇪🇸 LaLiga2',
  '🇮🇹 Serie A','🇮🇹 Serie B',
  '🇫🇷 Ligue 1','🇫🇷 Ligue 2',
  '🇵🇹 Liga Portugal','🇵🇹 Liga Portugal 2',
  '🇧🇪 Pro League','🇧🇪 Challenger Pro League',
];

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<"dashboard"|"history">("dashboard");
  const [selectedDate, setSelectedDate] = useState<string>(isoDate(new Date()));
  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<"laden"|"klaar"|"fout">("laden");
  const [lastRun, setLastRun] = useState<number|null>(null);
  const [activeFilter, setActiveFilter] = useState<"alle"|"live"|"gepland"|"gespeeld">("alle");
  const [selectedLeague, setSelectedLeague] = useState<string>("alle");
  const tabsRef = useRef<HTMLDivElement>(null);
  const learnedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setSyncStatus("laden");
    setMatches([]);
    setPredictions({});
    learnedRef.current.clear();

    const unsub = velocityEngine.subscribe(({ matches: nm, predictions: np, lastRun: lr }) => {
      setMatches(nm);
      setPredictions(np);
      setLoading(false);
      setSyncStatus("klaar");
      if (lr) setLastRun(lr);

      for (const m of nm) {
        if (!isFinished(m) || !m.score?.includes("-") || learnedRef.current.has(m.id)) continue;
        const pred = np[m.id];
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

  const filteredMatches = useMemo(() => {
    let base = selectedLeague === "alle" ? matches : matches.filter(m => m.league === selectedLeague);
    if (activeFilter === "live")     return base.filter(isLive);
    if (activeFilter === "gepland")  return base.filter(m => !isLive(m) && !isFinished(m));
    if (activeFilter === "gespeeld") return base.filter(isFinished);
    return base;
  }, [matches, selectedLeague, activeFilter]);

  const sortedMatches = useMemo(() => [...filteredMatches].sort((a, b) => {
    const aL = isLive(a), bL = isLive(b), aF = isFinished(a), bF = isFinished(b);
    if (aL && !bL) return -1; if (!aL && bL) return 1;
    if (!aF && bF) return -1; if (aF && !bF) return 1;
    return (a.kickoff||'').localeCompare(b.kickoff||'');
  }), [filteredMatches]);

  const allLeagues = useMemo(() => {
    const present = new Set(matches.map(m => m.league).filter(Boolean));
    const ordered = LEAGUE_ORDER.filter(l => present.has(l));
    for (const l of present) if (!LEAGUE_ORDER.includes(l)) ordered.push(l);
    return ordered;
  }, [matches]);

  const liveCount     = useMemo(() => matches.filter(isLive).length, [matches]);
  const plannedCount  = useMemo(() => matches.filter(m => !isLive(m) && !isFinished(m)).length, [matches]);
  const finishedCount = useMemo(() => matches.filter(isFinished).length, [matches]);

  const bestBets = useMemo(() => {
    return Object.entries(predictions)
      .map(([matchId, pred]) => {
        const m = matches.find(m => m.id === matchId);
        if (!m || !pred) return null;
        return { ...pred, homeTeam: m.homeTeamName, awayTeam: m.awayTeamName, league: m.league, matchId };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => (b.exactProb||b.confidence||0) - (a.exactProb||a.confidence||0))
      .slice(0, 5) as any[];
  }, [predictions, matches]);

  const scrollTabs = (dir: 'left'|'right') => {
    tabsRef.current?.scrollBy({ left: dir === 'right' ? 160 : -160, behavior: 'smooth' });
  };

  const lastRunLabel = lastRun
    ? new Date(lastRun).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    : null;

  const liveInLeague  = (l: string) => matches.filter(m => m.league === l && isLive(m)).length;

  return (
    <div className="min-h-screen pb-20 text-slate-100 bg-[#02020a]">
      <Header currentView={currentView} onViewChange={setCurrentView} />

      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-5">
        {currentView === "dashboard" ? (
          <>
            {/* Datum */}
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Datum</div>
                <div className="text-xl font-black text-white tracking-tight">{formatDateLabel(selectedDate)}</div>
                <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${syncStatus==='klaar'?'bg-green-400':syncStatus==='laden'?'bg-yellow-400 animate-pulse':'bg-red-400'}`}/>
                  {syncStatus==='laden' ? 'Data laden...' : `Gesynchroniseerd${lastRunLabel ? ` · Arbeider: ${lastRunLabel}` : ''}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="date" value={selectedDate}
                  onChange={e => { setSelectedDate(e.target.value); setSelectedLeague("alle"); setActiveFilter("alle"); }}
                  className="bg-slate-900/70 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none"/>
                <button onClick={() => { setSelectedDate(isoDate(new Date())); setSelectedLeague("alle"); setActiveFilter("alle"); }}
                  className="bg-blue-600 text-white rounded-xl px-4 py-2 text-sm font-black hover:bg-blue-500 transition">
                  Vandaag
                </button>
              </div>
            </div>

            {/* Tellers */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                {key:"gepland", label:"Gepland", count:plannedCount, c:"blue"},
                {key:"live",    label:"Live",    count:liveCount,    c:"red"},
                {key:"gespeeld",label:"Gespeeld",count:finishedCount,c:"slate"},
              ].map(({key,label,count,c})=>(
                <button key={key}
                  onClick={()=>setActiveFilter(activeFilter===key?"alle":key as any)}
                  className={`glass-card p-3 rounded-2xl border text-left transition
                    ${activeFilter===key?`border-${c}-500/60 bg-${c}-900/20`:`border-${c}-500/20 hover:border-${c}-500/30`}`}>
                  <div className={`text-[9px] font-black text-${c}-400 uppercase flex items-center gap-1`}>
                    {key==="live"&&<span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"/>}{label}
                  </div>
                  <div className="text-xl font-black">{count}</div>
                </button>
              ))}
            </div>

            {/* Competitie tabs — compact met pijlen */}
            <div className="flex items-center gap-1 mb-4">
              <button onClick={()=>scrollTabs('left')}
                className="flex-shrink-0 w-6 h-6 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 text-sm font-black flex items-center justify-center transition">‹</button>

              <div ref={tabsRef} className="flex gap-1 overflow-x-auto scrollbar-hide flex-1 py-0.5">
                {/* Alle knop */}
                <button onClick={()=>{setSelectedLeague("alle");setActiveFilter("alle");}}
                  className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-black transition whitespace-nowrap
                    ${selectedLeague==="alle"?"bg-white text-black":"bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                  ⚽ {matches.length}
                </button>

                {allLeagues.map(league=>{
                  const short   = shortLeagueName(league);
                  const total   = matches.filter(m=>m.league===league).length;
                  const liveCnt = liveInLeague(league);
                  const active  = selectedLeague===league;
                  return (
                    <button key={league} onClick={()=>setSelectedLeague(league)}
                      title={league}
                      className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-black transition whitespace-nowrap
                        ${active?"bg-blue-600 text-white":"bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                      {short}
                      {liveCnt > 0
                        ? <span className="ml-1 text-[8px] bg-red-500 text-white px-1 rounded animate-pulse">{liveCnt}🔴</span>
                        : <span className="ml-1 opacity-50 text-[9px]">{total}</span>
                      }
                    </button>
                  );
                })}
              </div>

              <button onClick={()=>scrollTabs('right')}
                className="flex-shrink-0 w-6 h-6 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 text-sm font-black flex items-center justify-center transition">›</button>
            </div>

            {/* Inhoud */}
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[1,2,3,4,5,6].map(i=><div key={i} className="h-64 glass-card rounded-2xl animate-pulse"/>)}
              </div>
            ) : sortedMatches.length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                <div className="text-5xl mb-3">⚽</div>
                <div className="font-bold">Geen wedstrijden voor deze selectie</div>
                {syncStatus==='klaar' && matches.length===0 && (
                  <div className="text-[11px] mt-2 text-slate-600">Start de GitHub Actions worker om wedstrijden te laden</div>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Top 5 tips */}
                {selectedLeague==="alle" && activeFilter==="alle" && bestBets.length > 0 && (
                  <section>
                    <h2 className="text-sm font-black uppercase mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-yellow-400 rounded-full"/>Top 5 meest zekere tips
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                      {bestBets.map((b:any)=><BestBetCard key={b.matchId} bet={b}/>)}
                    </div>
                  </section>
                )}

                {/* Live sectie */}
                {(activeFilter==="alle"||activeFilter==="live") && sortedMatches.filter(isLive).length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"/>
                      <span className="text-sm font-black uppercase">Live ({sortedMatches.filter(isLive).length})</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {sortedMatches.filter(isLive).map(m=>(
                        <MatchCard key={m.id} match={m} prediction={predictions[m.id]}/>
                      ))}
                    </div>
                  </section>
                )}

                {/* Gepland sectie */}
                {(activeFilter==="alle"||activeFilter==="gepland") && sortedMatches.filter(m=>!isLive(m)&&!isFinished(m)).length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2 h-2 bg-blue-500 rounded-full"/>
                      <span className="text-sm font-black uppercase">Nog te spelen ({sortedMatches.filter(m=>!isLive(m)&&!isFinished(m)).length})</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {sortedMatches.filter(m=>!isLive(m)&&!isFinished(m)).map(m=>(
                        <MatchCard key={m.id} match={m} prediction={predictions[m.id]}/>
                      ))}
                    </div>
                  </section>
                )}

                {/* Gespeeld sectie */}
                {(activeFilter==="alle"||activeFilter==="gespeeld") && sortedMatches.filter(isFinished).length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2 h-2 bg-slate-400 rounded-full"/>
                      <span className="text-sm font-black uppercase">Gespeeld ({sortedMatches.filter(isFinished).length})</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {sortedMatches.filter(isFinished).map(m=>(
                        <MatchCard key={m.id} match={m} prediction={predictions[m.id]}/>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </>
        ) : (
          <PredictionHistory/>
        )}
      </main>
    </div>
  );
};

export default App;
