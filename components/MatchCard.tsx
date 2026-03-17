import React, { useState, useEffect, useRef } from 'react';
import { Match } from '../types';
import { FavoriteButton } from './FavoriteTeams';

interface MatchCardProps {
  match: Match & {
    homePos?: number|null; awayPos?: number|null;
    liveStats?: any; homeInjuries?: any; awayInjuries?: any;
    homeGoalTiming?: any; awayGoalTiming?: any;
    period?: string; extraTime?: number|null;
  };
  prediction?: any;
  onFavoriteChange?: () => void;
}

// ── Sub-componenten ──────────────────────────────────────────────────────────

function Logo({ teamId, directUrl, name }: { teamId: string; directUrl?: string; name: string }) {
  const [attempt, setAttempt] = useState(0);
  const sources = [
    teamId ? `/api/logo?id=${teamId}` : null,
    teamId ? `https://api.sofascore.app/api/v1/team/${teamId}/image` : null,
    directUrl || null,
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name[0]||'?')}&background=1e293b&color=60a5fa&size=80&bold=true&format=png`,
  ].filter(Boolean) as string[];
  return (
    <img src={sources[Math.min(attempt, sources.length-1)]}
      referrerPolicy="no-referrer" crossOrigin="anonymous"
      className="w-12 h-12 object-contain rounded-full bg-slate-800/60 p-0.5"
      alt={name} onError={() => setAttempt(a => Math.min(a+1, sources.length-1))} />
  );
}

function FormBadge({ form }: { form: string }) {
  if (!form) return null;
  return (
    <div className="flex gap-0.5 justify-center">
      {form.slice(-5).split('').map((l,i) => (
        <span key={i} className={`w-4 h-4 rounded-sm text-[8px] font-black flex items-center justify-center
          ${l==='W'?'bg-green-500 text-white':l==='D'?'bg-yellow-500 text-black':'bg-red-500 text-white'}`}>{l}</span>
      ))}
    </div>
  );
}

function PosBadge({ pos }: { pos?: number|null }) {
  if (!pos) return null;
  const color = pos<=3?'bg-blue-500/20 text-blue-300 border-blue-500/30'
              : pos>=16?'bg-red-500/20 text-red-300 border-red-500/30'
              : 'bg-slate-700/60 text-slate-400 border-slate-600/30';
  return <span className={`text-[8px] font-black px-1.5 py-0.5 rounded border ${color}`}>#{pos}</span>;
}

function InjuryBadge({ injuries }: { injuries: any }) {
  if (!injuries?.injuredCount) return null;
  return (
    <span className="text-[7px] bg-orange-900/40 text-orange-400 border border-orange-500/20 px-1 py-0.5 rounded"
      title={injuries.keyPlayersMissing?.join(', ')}>
      🤕 {injuries.injuredCount}
    </span>
  );
}

// Live klok component — toont minuut, extra tijd en periode
function LiveClock({ minute, extraTime, period }: { minute?: string|null; extraTime?: number|null; period?: string }) {
  const [pulse, setPulse] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setPulse(p => !p), 500);
    return () => clearInterval(t);
  }, []);

  const isHT = period?.toLowerCase().includes('half time') || minute === 'HT';
  const is2nd = period?.toLowerCase().includes('2nd') || (minute && !isHT && parseInt(minute) > 45);

  return (
    <div className="flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0 transition-opacity ${pulse?'opacity-100':'opacity-30'}`}/>
      <span className="bg-red-600/90 text-white text-[9px] font-black px-1.5 py-0.5 rounded leading-tight">
        {isHT ? 'HT' : minute || 'LIVE'}
      </span>
      {extraTime && extraTime > 0 && !isHT && (
        <span className="bg-amber-600/80 text-white text-[8px] font-black px-1 py-0.5 rounded">+{extraTime}'</span>
      )}
      {is2nd && !isHT && !extraTime && (
        <span className="text-[7px] text-red-400/70">2e</span>
      )}
    </div>
  );
}

function QuarterBar({ timing, label, color='blue' }: { timing: any; label: string; color?: string }) {
  if (!timing?.total) return null;
  const quarters = [
    { key:'q1', label:"0-22'", pct:timing.q1pct||0 },
    { key:'q2', label:"23-45'", pct:timing.q2pct||0 },
    { key:'q3', label:"46-67'", pct:timing.q3pct||0 },
    { key:'q4', label:"68-90'", pct:timing.q4pct||0 },
  ];
  return (
    <div className="mb-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[7px] text-slate-500">{label}</span>
        <span className="text-[7px] text-slate-600">{timing.total} goals · {timing.games} wedstr.</span>
      </div>
      <div className="flex gap-1 items-end h-8">
        {quarters.map(q => (
          <div key={q.key} className="flex-1 flex flex-col items-center gap-0.5">
            <div className="w-full relative flex items-end justify-center" style={{height:'24px'}}>
              <div className={`w-full rounded-t transition-all ${q.key===timing.peak?(color==='blue'?'bg-blue-500':'bg-red-500'):'bg-slate-700'}`}
                style={{height:`${Math.max(8, q.pct)}%`, maxHeight:'24px'}}/>
              {q.key===timing.peak && <span className="absolute -top-2.5 text-[8px]">★</span>}
            </div>
            <span className={`text-[7px] font-black ${q.key===timing.peak?(color==='blue'?'text-blue-400':'text-red-400'):'text-slate-600'}`}>
              {q.pct}%
            </span>
            <span className="text-[6px] text-slate-700 leading-tight text-center">{q.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmt(p: number) { return p > 0.01 ? (1/p).toFixed(2) : '-'; }

// ── Hoofd component ──────────────────────────────────────────────────────────
const MatchCard: React.FC<MatchCardProps> = ({ match, prediction, onFavoriteChange }) => {
  const [tab, setTab] = useState<'analyse'|'h2h'|'markten'|'stats'>('analyse');
  const [aiAnalysis, setAiAnalysis] = useState<string|null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const triedRef = useRef(false);
  const cacheKey = `ai_v4_${match.id}`;

  useEffect(() => {
    if (triedRef.current || !prediction) return;
    triedRef.current = true;
    try {
      const c = localStorage.getItem(cacheKey);
      if (c) {
        const { text, ts } = JSON.parse(c);
        if (Date.now()-ts < 24*3600*1000) { setAiAnalysis(text); return; }
      }
    } catch {}
    setAiLoading(true);
    fetch('/api/analyze', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ match, prediction })
    })
      .then(r=>r.json())
      .then(d => {
        if (d.analysis) {
          setAiAnalysis(d.analysis);
          try { localStorage.setItem(cacheKey, JSON.stringify({ text:d.analysis, ts:Date.now() })); } catch {}
        }
      })
      .catch(()=>{})
      .finally(()=>setAiLoading(false));
  }, [prediction]);

  if (!prediction) {
    return (
      <div className="glass-card rounded-2xl p-4 border border-white/5 animate-pulse">
        <div className="h-3 bg-slate-800 rounded w-1/2 mb-3"/>
        <div className="flex justify-between items-center gap-3">
          <div className="flex-1 flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-slate-800 rounded-full"/><div className="h-2 bg-slate-800 rounded w-16"/>
          </div>
          <div className="w-16 h-8 bg-slate-800 rounded"/>
          <div className="flex-1 flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-slate-800 rounded-full"/><div className="h-2 bg-slate-800 rounded w-16"/>
          </div>
        </div>
      </div>
    );
  }

  const isLive     = match.status === 'LIVE' || !!(match as any).minute;
  const isFinished = match.status === 'FT';
  const hasResult  = !!match.score && match.score !== 'v';
  const predScore  = `${prediction.predHomeGoals}-${prediction.predAwayGoals}`;
  const isCorrect  = isFinished && hasResult && match.score?.trim() === predScore.trim();
  const kickoff    = match.kickoff
    ? new Date(match.kickoff).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})
    : null;

  const maxP     = Math.max(prediction.homeProb||0, prediction.drawProb||0, prediction.awayProb||0);
  const favLabel = maxP===prediction.homeProb ? `${match.homeTeamName.split(' ')[0]} wint`
                 : maxP===prediction.drawProb  ? 'Gelijkspel'
                 : `${match.awayTeamName.split(' ')[0]} wint`;

  const h2h             = (match as any).h2h || prediction.h2h;
  const homeSeasonStats = (match as any).homeSeasonStats;
  const awaySeasonStats = (match as any).awaySeasonStats;
  const liveStats       = (match as any).liveStats;
  const homeInj         = (match as any).homeInjuries;
  const awayInj         = (match as any).awayInjuries;
  const homeGT          = (match as any).homeGoalTiming;
  const awayGT          = (match as any).awayGoalTiming;
  const matchImportance = (match as any).matchImportance || prediction.matchImportance;

  const topScores = Object.entries(prediction.scoreMatrix||{})
    .sort((a:any,b:any)=>b[1]-a[1]).slice(0,6);

  const border = isCorrect   ? 'border-green-400/60 bg-green-900/10'
               : isLive      ? 'border-red-500/50 bg-red-950/20'
               : isFinished  ? 'border-slate-600/30 bg-slate-900/20'
               :               'border-slate-700/30';

  const qLabel: Record<string,string> = { q1:"0-22'", q2:"23-45'", q3:"46-67'", q4:"68-90'" };

  return (
    <div className={`glass-card rounded-2xl p-3 border ${border} transition-all`}>

      {/* ── Header ── */}
      <div className="flex justify-between items-center mb-2 gap-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-[8px] font-black text-blue-400 uppercase truncate">
            {match.league?.split(' ').slice(1).join(' ')}
          </span>
          {matchImportance > 1.05 && (
            <span className="flex-shrink-0 text-[7px] bg-amber-900/40 text-amber-400 border border-amber-500/20 px-1 py-0.5 rounded">
              🔥
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isLive && (
            <LiveClock
              minute={(match as any).minute}
              extraTime={(match as any).extraTime}
              period={(match as any).period}
            />
          )}
          {!isLive && kickoff && !isFinished && (
            <span className="text-[8px] text-slate-400">🕐 {kickoff}</span>
          )}
          {isFinished && !isLive && (
            <span className="bg-slate-700 text-slate-300 text-[7px] font-black px-1.5 py-0.5 rounded">FT</span>
          )}
          {isCorrect && <span className="bg-green-600 text-white text-[7px] font-black px-1 py-0.5 rounded">✓</span>}
          <FavoriteButton teamId={(match as any).homeTeamId||''} teamName={match.homeTeamName} onChange={onFavoriteChange}/>
          <FavoriteButton teamId={(match as any).awayTeamId||''} teamName={match.awayTeamName} onChange={onFavoriteChange}/>
        </div>
      </div>

      {/* ── Live voortgangsbalk ── */}
      {isLive && (match as any).minute && (match as any).minute !== 'HT' && (
        <div className="mb-2">
          <div className="flex h-1 bg-slate-800 rounded-full overflow-hidden">
            <div className="bg-red-500/60 h-full rounded-full transition-all"
              style={{width:`${Math.min(100, (parseInt((match as any).minute)||0)/90*100)}%`}}/>
          </div>
        </div>
      )}

      {/* ── Teams ── */}
      <div className="flex items-center justify-between gap-2 mb-3">
        {/* Thuis */}
        <div className="flex flex-col items-center flex-1 gap-0.5 min-w-0">
          <Logo teamId={(match as any).homeTeamId||''} directUrl={match.homeLogo} name={match.homeTeamName}/>
          <span className="text-[9px] font-black text-white text-center leading-tight line-clamp-2 px-0.5 mt-0.5">
            {match.homeTeamName}
          </span>
          <div className="flex items-center gap-1 flex-wrap justify-center">
            <PosBadge pos={match.homePos}/>
            <InjuryBadge injuries={homeInj}/>
          </div>
          <FormBadge form={prediction.homeForm||(match as any).homeForm||''}/>
          {prediction.homeElo && (
            <span className="text-[7px] text-slate-600">Elo {prediction.homeElo}</span>
          )}
        </div>

        {/* Score */}
        <div className="flex flex-col items-center min-w-[76px] gap-0.5 flex-shrink-0">
          <div className="text-xl font-black">
            {hasResult
              ? <span className={isLive?'text-red-300':'text-white'}>{match.score}</span>
              : <span className="text-slate-600 text-base">vs</span>}
          </div>
          <div className="bg-blue-600 px-2.5 py-0.5 rounded-full text-center shadow-lg shadow-blue-600/20">
            <div className="text-white text-[10px] font-black">{prediction.predHomeGoals}-{prediction.predAwayGoals}</div>
            <div className="text-[6px] text-blue-200 uppercase">AI tip</div>
          </div>
          <div className="text-[7px] text-yellow-400 font-bold text-center leading-tight mt-0.5">{favLabel}</div>
        </div>

        {/* Uit */}
        <div className="flex flex-col items-center flex-1 gap-0.5 min-w-0">
          <Logo teamId={(match as any).awayTeamId||''} directUrl={match.awayLogo} name={match.awayTeamName}/>
          <span className="text-[9px] font-black text-white text-center leading-tight line-clamp-2 px-0.5 mt-0.5">
            {match.awayTeamName}
          </span>
          <div className="flex items-center gap-1 flex-wrap justify-center">
            <PosBadge pos={match.awayPos}/>
            <InjuryBadge injuries={awayInj}/>
          </div>
          <FormBadge form={prediction.awayForm||(match as any).awayForm||''}/>
          {prediction.awayElo && (
            <span className="text-[7px] text-slate-600">Elo {prediction.awayElo}</span>
          )}
        </div>
      </div>

      {/* ── Live stats balk ── */}
      {isLive && liveStats?.possession && (
        <div className="mb-2 bg-red-950/20 border border-red-500/10 rounded-lg p-1.5">
          <div className="flex justify-between text-[7px] text-slate-500 mb-0.5">
            <span className="text-blue-400 font-bold">{liveStats.possession.home}%</span>
            <span>balbezit</span>
            <span className="text-red-400 font-bold">{liveStats.possession.away}%</span>
          </div>
          <div className="flex h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="bg-blue-500 h-full" style={{width:`${liveStats.possession.home}%`}}/>
            <div className="bg-red-500 h-full flex-1"/>
          </div>
          {liveStats.shots_on_target && (
            <div className="flex justify-between text-[7px] mt-0.5">
              <span className="text-blue-400">{liveStats.shots_on_target.home} 🎯</span>
              <span className="text-slate-600">schoten</span>
              <span className="text-red-400">🎯 {liveStats.shots_on_target.away}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Kansen balk ── */}
      <div className="flex h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
        <div className="bg-green-500 h-full" style={{width:`${(prediction.homeProb||0)*100}%`}}/>
        <div className="bg-slate-500 h-full" style={{width:`${(prediction.drawProb||0)*100}%`}}/>
        <div className="bg-red-500 h-full"  style={{width:`${(prediction.awayProb||0)*100}%`}}/>
      </div>

      {/* ── 1X2 ── */}
      <div className="grid grid-cols-3 gap-1 mb-2">
        {[
          {label:'1 Thuis', p:prediction.homeProb||0, odds:fmt(prediction.homeProb||0), c:'text-green-400'},
          {label:'X Gelijk', p:prediction.drawProb||0, odds:fmt(prediction.drawProb||0), c:'text-slate-400'},
          {label:'2 Uit',   p:prediction.awayProb||0, odds:fmt(prediction.awayProb||0), c:'text-red-400'},
        ].map(({label,p,odds,c}) => (
          <div key={label} className="bg-slate-900/60 rounded-lg p-1.5 text-center">
            <div className={`text-[7px] font-black ${c} uppercase`}>{label}</div>
            <div className="text-[11px] font-black text-white">{(p*100).toFixed(0)}%</div>
            <div className="text-[9px] font-bold text-yellow-400 bg-yellow-900/20 rounded">{odds}</div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="grid grid-cols-4 gap-0.5 mb-2 pt-1 border-t border-white/5">
        {([
          {k:'analyse',l:'🤖 AI'},
          {k:'h2h',    l:'⚔️ H2H'},
          {k:'markten',l:'📊 Markt'},
          {k:'stats',  l:'📈 Stats'},
        ] as const).map(({k,l}) => (
          <button key={k} onClick={()=>setTab(k)}
            className={`py-1 rounded-lg text-[8px] font-black transition
              ${tab===k?'bg-blue-600 text-white':'bg-slate-800/60 text-slate-400 hover:text-white'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ── Analyse tab ── */}
      {tab==='analyse' && (
        <div className="space-y-2">
          <div className="bg-gradient-to-br from-blue-950/60 to-purple-950/40 border border-blue-500/20 rounded-xl p-2.5 min-h-[60px]">
            <div className="text-[7px] font-black text-blue-400 uppercase mb-1.5 flex items-center gap-1">
              🤖 AI Analyse
              {aiLoading && <span className="text-slate-500 animate-pulse font-normal normal-case">genereert...</span>}
            </div>
            {aiAnalysis ? (
              <p className="text-[9px] text-blue-100/90 leading-relaxed">{aiAnalysis}</p>
            ) : aiLoading ? (
              <div className="flex gap-1 mt-2">
                {[0,1,2].map(i=><div key={i} className="w-1.5 h-1.5 bg-blue-500/40 rounded-full animate-bounce" style={{animationDelay:`${i*0.2}s`}}/>)}
              </div>
            ) : (
              <p className="text-[9px] text-slate-600">Analyse wordt geladen...</p>
            )}
          </div>

          {/* Blessure info */}
          {((homeInj?.keyPlayersMissing?.length>0)||(awayInj?.keyPlayersMissing?.length>0)) && (
            <div className="bg-orange-900/20 border border-orange-500/20 rounded-xl p-2">
              <div className="text-[7px] font-black text-orange-400 uppercase mb-1">🤕 Afwezig</div>
              {homeInj?.keyPlayersMissing?.length>0 && (
                <div className="text-[8px] text-orange-300">
                  <span className="font-bold">{match.homeTeamName.split(' ')[0]}:</span> {homeInj.keyPlayersMissing.join(', ')}
                </div>
              )}
              {awayInj?.keyPlayersMissing?.length>0 && (
                <div className="text-[8px] text-orange-300">
                  <span className="font-bold">{match.awayTeamName.split(' ')[0]}:</span> {awayInj.keyPlayersMissing.join(', ')}
                </div>
              )}
            </div>
          )}

          {/* xG */}
          <div className="grid grid-cols-2 gap-1.5">
            {[{l:'xG Thuis',v:(prediction.homeXG||0).toFixed(2)},{l:'xG Uit',v:(prediction.awayXG||0).toFixed(2)}].map(({l,v})=>(
              <div key={l} className="bg-slate-900/60 rounded-lg p-2 text-center">
                <div className="text-[7px] text-slate-500 uppercase">{l}</div>
                <div className="text-lg font-black text-blue-400">{v}</div>
              </div>
            ))}
          </div>

          {/* Score matrix */}
          {topScores.length>0 && (
            <div className="bg-slate-900/60 rounded-xl p-2">
              <div className="text-[7px] text-slate-500 uppercase mb-1.5">Score matrix (Dixon-Coles)</div>
              <div className="flex flex-wrap gap-1">
                {topScores.map(([score,prob]:any)=>(
                  <div key={score} className={`px-2 py-0.5 rounded-lg text-[9px] font-black flex items-center gap-1
                    ${score===predScore?'bg-blue-600 text-white':'bg-slate-800 text-slate-300'}`}>
                    {score} <span className="opacity-60">{(prob*100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confidence */}
          <div className="flex items-center gap-2">
            <span className="text-[7px] text-slate-500 w-14 flex-shrink-0">Zekerheid</span>
            <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${(prediction.confidence||0)>0.6?'bg-green-500':(prediction.confidence||0)>0.3?'bg-yellow-500':'bg-red-500'}`}
                style={{width:`${(prediction.confidence||0)*100}%`}}/>
            </div>
            <span className="text-[8px] font-black text-white">{((prediction.confidence||0)*100).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* ── H2H tab ── */}
      {tab==='h2h' && (
        <div>
          {h2h ? (
            <div className="space-y-1.5">
              <div className="grid grid-cols-3 gap-1 text-center">
                {[
                  {l:'Thuis',v:h2h.homeWins,cls:'bg-green-900/20 border border-green-500/20 text-green-400'},
                  {l:'Gelijk',v:h2h.draws,  cls:'bg-slate-800 text-slate-400'},
                  {l:'Uit',  v:h2h.awayWins,cls:'bg-red-900/20 border border-red-500/20 text-red-400'},
                ].map(({l,v,cls})=>(
                  <div key={l} className={`rounded-lg p-1.5 ${cls}`}>
                    <div className="text-[7px] font-black uppercase">{l}</div>
                    <div className="text-2xl font-black text-white">{v}</div>
                  </div>
                ))}
              </div>
              <div className="bg-slate-900/60 rounded-xl p-2 space-y-1">
                <div className="text-[7px] text-slate-500 uppercase mb-1">Laatste ontmoetingen</div>
                {h2h.results.slice(-5).reverse().map((r:any,i:number)=>(
                  <div key={i} className="flex items-center justify-between text-[9px] py-0.5 border-b border-white/5 last:border-0">
                    <span className="text-slate-300 truncate max-w-[90px]">{r.home}</span>
                    <span className="font-black text-white mx-1 bg-slate-800 px-1.5 py-0.5 rounded">{r.score}</span>
                    <span className="text-slate-300 truncate max-w-[90px] text-right">{r.away}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-slate-500 text-[10px]">
              <div className="text-2xl mb-2">⚔️</div>H2H nog niet beschikbaar
            </div>
          )}
        </div>
      )}

      {/* ── Markten tab ── */}
      {tab==='markten' && (
        <div className="space-y-2">
          <div className="bg-slate-900/60 rounded-xl p-2">
            <div className="text-[7px] text-slate-500 uppercase mb-1.5">Over / Under</div>
            {[
              {l:'Over 1.5',  p:prediction.over15||0,           o:fmt(prediction.over15||0)},
              {l:'Over 2.5',  p:prediction.over25||0,           o:fmt(prediction.over25||0)},
              {l:'Under 2.5', p:1-(prediction.over25||0),       o:(prediction.over25||0)>0.01?(1/(1-(prediction.over25||0))).toFixed(2):'-'},
              {l:'Over 3.5',  p:prediction.over35||0,           o:fmt(prediction.over35||0)},
            ].map(({l,p,o})=>(
              <div key={l} className="flex items-center gap-2 mb-1.5">
                <span className="text-[9px] text-slate-300 w-20 flex-shrink-0">{l}</span>
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{width:`${p*100}%`}}/>
                </div>
                <span className="text-[9px] font-black text-white w-8 text-right">{(p*100).toFixed(0)}%</span>
                <span className="text-[9px] text-yellow-400 font-bold w-8 text-right">{o}</span>
              </div>
            ))}
          </div>
          <div className="bg-slate-900/60 rounded-xl p-2">
            <div className="text-[7px] text-slate-500 uppercase mb-1.5">Beide teams scoren (BTTS)</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                {l:'Ja', p:prediction.btts||0, o:fmt(prediction.btts||0), c:'text-green-400'},
                {l:'Nee',p:1-(prediction.btts||0), o:(prediction.btts||0)>0.01?(1/(1-(prediction.btts||0))).toFixed(2):'-', c:'text-red-400'},
              ].map(({l,p,o,c})=>(
                <div key={l} className="bg-slate-800/60 rounded-lg p-2 text-center">
                  <div className={`text-[7px] font-black ${c} uppercase`}>BTTS {l}</div>
                  <div className="text-sm font-black text-white">{(p*100).toFixed(0)}%</div>
                  <div className="text-[9px] text-yellow-400 font-bold">{o}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Stats tab ── */}
      {tab==='stats' && (
        <div className="space-y-2">
          {/* Live statistieken */}
          {isLive && liveStats && (
            <div className="bg-red-950/20 border border-red-500/10 rounded-xl p-2">
              <div className="text-[7px] text-red-400 font-black uppercase mb-1.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"/> Live statistieken
              </div>
              {[
                {l:'Balbezit', h:liveStats.possession?.home, a:liveStats.possession?.away, unit:'%', max:80},
                {l:'Schoten doel', h:liveStats.shots_on_target?.home, a:liveStats.shots_on_target?.away, unit:'', max:10},
                {l:'Totaal shots', h:liveStats.shots_total?.home, a:liveStats.shots_total?.away, unit:'', max:20},
              ].filter(s=>s.h!=null||s.a!=null).map(({l,h,a,unit,max})=>(
                <div key={l} className="mb-1.5">
                  <div className="flex justify-between text-[7px] mb-0.5">
                    <span className="text-blue-400 font-bold">{h}{unit}</span>
                    <span className="text-slate-500">{l}</span>
                    <span className="text-red-400 font-bold">{a}{unit}</span>
                  </div>
                  <div className="flex h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="bg-blue-500 h-full" style={{width:`${Math.min(100,((Number(h)||0)/max)*100)}%`}}/>
                    <div className="flex-1"/>
                    <div className="bg-red-500 h-full" style={{width:`${Math.min(100,((Number(a)||0)/max)*100)}%`}}/>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Seizoensstatistieken */}
          {(homeSeasonStats?.avgShotsOn || awaySeasonStats?.avgShotsOn) && (
            <div className="bg-slate-900/60 rounded-xl p-2">
              <div className="text-[7px] text-slate-500 uppercase mb-1.5">Seizoensgemiddelde</div>
              {[
                {l:'Schoten op doel', h:homeSeasonStats?.avgShotsOn, a:awaySeasonStats?.avgShotsOn, max:8},
                {l:'Balbezit %',      h:homeSeasonStats?.avgPossession, a:awaySeasonStats?.avgPossession, max:70},
              ].filter(s=>s.h||s.a).map(({l,h,a,max})=>(
                <div key={l} className="mb-1.5">
                  <div className="flex justify-between text-[7px] text-slate-500 mb-0.5">
                    <span className="text-blue-400 font-bold">{h?.toFixed(1)||'-'}</span>
                    <span>{l}</span>
                    <span className="text-red-400 font-bold">{a?.toFixed(1)||'-'}</span>
                  </div>
                  <div className="flex h-1.5 gap-0.5">
                    <div className="flex-1 bg-slate-800 rounded-full overflow-hidden flex justify-end">
                      <div className="h-full bg-blue-500 rounded-full" style={{width:`${Math.min(100,((h||0)/max)*100)}%`}}/>
                    </div>
                    <div className="flex-1 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-red-500 rounded-full" style={{width:`${Math.min(100,((a||0)/max)*100)}%`}}/>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Elo vergelijking */}
          {prediction.homeElo && prediction.awayElo && (
            <div className="bg-slate-900/60 rounded-xl p-2">
              <div className="text-[7px] text-slate-500 uppercase mb-1.5">Elo sterkte</div>
              <div className="flex items-center gap-3">
                <div className="text-center min-w-[40px]">
                  <div className="text-base font-black text-purple-400">{prediction.homeElo}</div>
                  <div className="text-[7px] text-slate-600">{match.homeTeamName.split(' ')[0]}</div>
                </div>
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-500 rounded-full"
                    style={{width:`${(prediction.homeElo/(prediction.homeElo+prediction.awayElo))*100}%`}}/>
                </div>
                <div className="text-center min-w-[40px]">
                  <div className="text-base font-black text-purple-400">{prediction.awayElo}</div>
                  <div className="text-[7px] text-slate-600">{match.awayTeamName.split(' ')[0]}</div>
                </div>
              </div>
            </div>
          )}

          {/* Doelpunten timing kwartaalanalyse */}
          {(homeGT || awayGT) && (
            <div className="bg-slate-900/60 rounded-xl p-2.5">
              <div className="text-[7px] text-slate-500 uppercase mb-2 flex items-center gap-1">
                ⏱️ Doelpunten timing — per kwartaal
              </div>
              <QuarterBar timing={homeGT?.scored} label={`${match.homeTeamName.split(' ')[0]} scoort`} color="blue"/>
              <QuarterBar timing={awayGT?.scored} label={`${match.awayTeamName.split(' ')[0]} scoort`} color="red"/>
              {homeGT?.scored?.peak && awayGT?.scored?.peak && (
                <div className="text-[8px] text-amber-300 bg-amber-900/20 border border-amber-500/15 rounded-lg px-2 py-1.5 mt-1 leading-relaxed">
                  <span className="font-black">{match.homeTeamName.split(' ')[0]}</span> scoort meest in {qLabel[homeGT.scored.peak]} ·{' '}
                  <span className="font-black">{match.awayTeamName.split(' ')[0]}</span> scoort meest in {qLabel[awayGT.scored.peak]}
                </div>
              )}
            </div>
          )}

          {!homeSeasonStats && !awaySeasonStats && !homeGT && !awayGT && (
            <div className="text-center py-6 text-slate-600 text-[10px]">
              <div className="text-3xl mb-2">📈</div>
              Statistieken laden na volgende worker run
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MatchCard;
