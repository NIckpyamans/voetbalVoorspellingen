import React, { useState, useEffect, useRef } from 'react';
import { Match } from '../types';

interface MatchCardProps {
  match: Match;
  prediction?: any;
}

function FormBadge({ form }: { form: string }) {
  if (!form) return null;
  return (
    <div className="flex gap-0.5 justify-center">
      {form.slice(-5).split('').map((l, i) => (
        <span key={i} className={`w-4 h-4 rounded-sm text-[8px] font-black flex items-center justify-center
          ${l === 'W' ? 'bg-green-500 text-white' : l === 'D' ? 'bg-yellow-500 text-black' : 'bg-red-500 text-white'}`}>
          {l}
        </span>
      ))}
    </div>
  );
}

function fmt(p: number) { return p > 0.01 ? (1 / p).toFixed(2) : '-'; }

const MatchCard: React.FC<MatchCardProps> = ({ match, prediction }) => {
  const [tab, setTab] = useState<'analyse' | 'h2h' | 'markten' | 'stats'>('analyse');
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const analysisKey = `ai_analysis_${match.id}`;
  const hasTriedRef = useRef(false);

  // Auto-laad AI analyse (uit cache of genereer)
  useEffect(() => {
    if (hasTriedRef.current || !prediction) return;
    hasTriedRef.current = true;

    // Check localStorage cache (24 uur geldig)
    const cached = localStorage.getItem(analysisKey);
    if (cached) {
      try {
        const { text, ts } = JSON.parse(cached);
        if (Date.now() - ts < 24 * 3600 * 1000) { setAiAnalysis(text); return; }
      } catch {}
    }

    // Genereer nieuwe analyse automatisch
    setAiLoading(true);
    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match, prediction })
    })
      .then(r => r.json())
      .then(data => {
        if (data.analysis) {
          setAiAnalysis(data.analysis);
          localStorage.setItem(analysisKey, JSON.stringify({ text: data.analysis, ts: Date.now() }));
        }
      })
      .catch(() => {})
      .finally(() => setAiLoading(false));
  }, [prediction]);

  if (!prediction) {
    return (
      <div className="glass-card rounded-2xl p-4 border border-white/5 animate-pulse">
        <div className="h-3 bg-slate-800 rounded w-1/2 mb-3" />
        <div className="flex justify-between gap-2">
          {[0,1].map(i => <div key={i} className="flex-1 flex flex-col items-center gap-2">
            <div className="w-10 h-10 bg-slate-800 rounded-full" />
            <div className="h-2 bg-slate-800 rounded w-16" />
          </div>)}
          <div className="w-14 h-8 bg-slate-800 rounded mx-2" />
        </div>
      </div>
    );
  }

  const isFinishedMatch = match.status === 'FT';
  const isLiveMatch     = match.status === 'LIVE' || !!(match as any).minute;
  const hasResult       = !!match.score && match.score !== 'v';
  const predictedScore  = `${prediction.predHomeGoals}-${prediction.predAwayGoals}`;
  const isCorrect       = isFinishedMatch && hasResult && match.score?.trim() === predictedScore.trim();
  const kickoffTime     = match.kickoff
    ? new Date(match.kickoff).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    : null;

  const homeOdds    = fmt(prediction.homeProb  || 0);
  const drawOdds    = fmt(prediction.drawProb  || 0);
  const awayOdds    = fmt(prediction.awayProb  || 0);
  const over25Odds  = fmt(prediction.over25    || 0);
  const under25Odds = prediction.over25 > 0.01 ? (1/(1-prediction.over25)).toFixed(2) : '-';
  const bttsY       = fmt(prediction.btts      || 0);
  const bttsN       = prediction.btts > 0.01 ? (1/(1-prediction.btts)).toFixed(2) : '-';

  const maxP       = Math.max(prediction.homeProb||0, prediction.drawProb||0, prediction.awayProb||0);
  const favLabel   = maxP === prediction.homeProb ? `${match.homeTeamName.split(' ')[0]} wint`
                   : maxP === prediction.drawProb ? 'Gelijkspel'
                   : `${match.awayTeamName.split(' ')[0]} wint`;

  const h2h             = (match as any).h2h || prediction.h2h;
  const homeSeasonStats = (match as any).homeSeasonStats;
  const awaySeasonStats = (match as any).awaySeasonStats;
  const scoreMatrix     = prediction.scoreMatrix || {};
  const topScores       = Object.entries(scoreMatrix).sort((a:any,b:any)=>b[1]-a[1]).slice(0,6);

  const statusTone = isCorrect      ? 'border-green-400/60 bg-green-900/15'
                   : isLiveMatch    ? 'border-red-500/40 bg-red-900/10'
                   : isFinishedMatch? 'border-slate-500/30 bg-slate-900/30'
                   :                  'border-blue-500/15 bg-blue-900/5';

  return (
    <div className={`glass-card rounded-2xl p-3 border ${statusTone}`}>

      {/* Header */}
      <div className="flex justify-between items-center mb-2">
        <span className="text-[8px] font-black text-blue-400 uppercase truncate max-w-[60%]">
          {match.league?.split(' ').slice(1).join(' ')}
        </span>
        <div className="flex items-center gap-1">
          {isCorrect && <span className="bg-green-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded">✓</span>}
          {isLiveMatch && <span className="bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded animate-pulse">● {(match as any).minute}</span>}
          {!isLiveMatch && kickoffTime && !isFinishedMatch && <span className="text-[8px] text-slate-400">🕐 {kickoffTime}</span>}
          {isFinishedMatch && !isLiveMatch && <span className="bg-slate-700 text-slate-300 text-[7px] font-black px-1.5 py-0.5 rounded">FT</span>}
        </div>
      </div>

      {/* Teams */}
      <div className="flex items-center justify-between gap-1 mb-3">
        <div className="flex flex-col items-center flex-1 gap-0.5 min-w-0">
          <img src={match.homeLogo} className="w-9 h-9 object-contain p-0.5 rounded-full bg-slate-800/50" alt=""
            onError={(e) => { (e.target as any).src=`https://ui-avatars.com/api/?name=${match.homeTeamName[0]}&background=1e293b&color=60a5fa&size=36&bold=true`; }}/>
          <span className="text-[9px] font-black text-white line-clamp-2 text-center leading-tight px-1">{match.homeTeamName}</span>
          <FormBadge form={prediction.homeForm || (match as any).homeForm || ''} />
          {prediction.homeElo && <span className="text-[7px] text-slate-600">Elo {prediction.homeElo}</span>}
        </div>

        <div className="flex flex-col items-center min-w-[68px] gap-0.5">
          <div className="text-lg font-black">
            {hasResult ? <span className={isLiveMatch ? 'text-red-300' : 'text-white'}>{match.score}</span>
                       : <span className="text-slate-600 text-sm">vs</span>}
          </div>
          <div className="bg-blue-600 px-2 py-0.5 rounded-full text-center shadow-lg shadow-blue-600/20">
            <div className="text-white text-[10px] font-black">{prediction.predHomeGoals}-{prediction.predAwayGoals}</div>
            <div className="text-[6px] text-blue-200 font-bold uppercase">AI tip</div>
          </div>
          <div className="text-[7px] text-yellow-400 font-bold text-center">{favLabel}</div>
        </div>

        <div className="flex flex-col items-center flex-1 gap-0.5 min-w-0">
          <img src={match.awayLogo} className="w-9 h-9 object-contain p-0.5 rounded-full bg-slate-800/50" alt=""
            onError={(e) => { (e.target as any).src=`https://ui-avatars.com/api/?name=${match.awayTeamName[0]}&background=1e293b&color=60a5fa&size=36&bold=true`; }}/>
          <span className="text-[9px] font-black text-white line-clamp-2 text-center leading-tight px-1">{match.awayTeamName}</span>
          <FormBadge form={prediction.awayForm || (match as any).awayForm || ''} />
          {prediction.awayElo && <span className="text-[7px] text-slate-600">Elo {prediction.awayElo}</span>}
        </div>
      </div>

      {/* Kansen balk */}
      <div className="flex h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
        <div className="bg-green-500 h-full" style={{width:`${(prediction.homeProb||0)*100}%`}}/>
        <div className="bg-slate-500 h-full" style={{width:`${(prediction.drawProb||0)*100}%`}}/>
        <div className="bg-red-500  h-full" style={{width:`${(prediction.awayProb||0)*100}%`}}/>
      </div>

      {/* 1X2 */}
      <div className="grid grid-cols-3 gap-1 mb-2">
        {[
          {label:'1 Thuis', prob:prediction.homeProb||0, odds:homeOdds, color:'text-green-400'},
          {label:'X Gelijk', prob:prediction.drawProb||0, odds:drawOdds, color:'text-slate-400'},
          {label:'2 Uit',   prob:prediction.awayProb||0, odds:awayOdds, color:'text-red-400'},
        ].map(({label,prob,odds,color})=>(
          <div key={label} className="bg-slate-900/60 rounded-lg p-1.5 text-center">
            <div className={`text-[7px] font-black ${color} uppercase`}>{label}</div>
            <div className="text-[11px] font-black text-white">{(prob*100).toFixed(0)}%</div>
            <div className="text-[10px] font-bold text-yellow-400 bg-yellow-900/20 rounded px-0.5">{odds}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-4 gap-0.5 mb-2 pt-1 border-t border-white/5">
        {([
          {key:'analyse', label:'🤖 AI'},
          {key:'h2h',     label:'⚔️ H2H'},
          {key:'markten', label:'📊 Markt'},
          {key:'stats',   label:'📈 Stats'},
        ] as const).map(({key,label})=>(
          <button key={key} onClick={()=>setTab(key)}
            className={`py-1 rounded-lg text-[8px] font-black transition
              ${tab===key?'bg-blue-600 text-white':'bg-slate-800/60 text-slate-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Analyse tab */}
      {tab==='analyse' && (
        <div className="space-y-2">
          <div className="bg-gradient-to-br from-blue-950/60 to-purple-950/40 border border-blue-500/20 rounded-xl p-2.5 min-h-[60px]">
            <div className="text-[7px] font-black text-blue-400 uppercase mb-1.5 flex items-center gap-1">
              🤖 Claude AI Analyse
              {aiLoading && <span className="text-slate-500 animate-pulse font-normal normal-case">genereert...</span>}
            </div>
            {aiAnalysis ? (
              <p className="text-[9px] text-blue-100/90 leading-relaxed">{aiAnalysis}</p>
            ) : aiLoading ? (
              <div className="flex gap-1">
                {[1,2,3].map(i=><div key={i} className="w-2 h-2 bg-blue-500/40 rounded-full animate-bounce" style={{animationDelay:`${i*0.15}s`}}/>)}
              </div>
            ) : (
              <p className="text-[9px] text-slate-500">Analyse wordt automatisch geladen...</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div className="bg-slate-900/60 rounded-lg p-2 text-center">
              <div className="text-[7px] text-slate-500 uppercase">xG Thuis</div>
              <div className="text-base font-black text-blue-400">{(prediction.homeXG||0).toFixed(2)}</div>
            </div>
            <div className="bg-slate-900/60 rounded-lg p-2 text-center">
              <div className="text-[7px] text-slate-500 uppercase">xG Uit</div>
              <div className="text-base font-black text-blue-400">{(prediction.awayXG||0).toFixed(2)}</div>
            </div>
          </div>

          {topScores.length > 0 && (
            <div className="bg-slate-900/60 rounded-xl p-2">
              <div className="text-[7px] text-slate-500 uppercase mb-1.5">Score matrix (Dixon-Coles)</div>
              <div className="flex flex-wrap gap-1">
                {topScores.map(([score,prob]:any)=>(
                  <div key={score} className={`px-2 py-0.5 rounded-lg text-[9px] font-black flex items-center gap-1
                    ${score===predictedScore?'bg-blue-600 text-white':'bg-slate-800 text-slate-300'}`}>
                    {score} <span className="opacity-60">{(prob*100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-[7px] text-slate-500 w-14">Zekerheid</span>
            <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${(prediction.confidence||0)>0.6?'bg-green-500':(prediction.confidence||0)>0.3?'bg-yellow-500':'bg-red-500'}`}
                style={{width:`${(prediction.confidence||0)*100}%`}}/>
            </div>
            <span className="text-[8px] font-black text-slate-300">{((prediction.confidence||0)*100).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* H2H tab */}
      {tab==='h2h' && (
        <div>
          {h2h ? (
            <div className="space-y-1.5">
              <div className="grid grid-cols-3 gap-1 text-center">
                {[
                  {label:'Thuis', val:h2h.homeWins, cls:'bg-green-900/20 border border-green-500/20 text-green-400'},
                  {label:'Gelijk', val:h2h.draws,   cls:'bg-slate-800/60 text-slate-400'},
                  {label:'Uit',   val:h2h.awayWins, cls:'bg-red-900/20 border border-red-500/20 text-red-400'},
                ].map(({label,val,cls})=>(
                  <div key={label} className={`rounded-lg p-1.5 ${cls}`}>
                    <div className="text-[7px] font-black uppercase">{label}</div>
                    <div className="text-xl font-black text-white">{val}</div>
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
              <div className="text-2xl mb-2">⚔️</div>H2H wordt geladen bij volgende worker run
            </div>
          )}
        </div>
      )}

      {/* Markten tab */}
      {tab==='markten' && (
        <div className="space-y-2">
          <div className="bg-slate-900/60 rounded-xl p-2">
            <div className="text-[7px] text-slate-500 uppercase mb-1.5">Over / Under</div>
            {[
              {label:'Over 1.5',  prob:prediction.over15||0, odds:fmt(prediction.over15||0)},
              {label:'Over 2.5',  prob:prediction.over25||0, odds:over25Odds},
              {label:'Under 2.5', prob:1-(prediction.over25||0), odds:under25Odds},
              {label:'Over 3.5',  prob:prediction.over35||0, odds:fmt(prediction.over35||0)},
            ].map(({label,prob,odds})=>(
              <div key={label} className="flex items-center gap-2 mb-1">
                <span className="text-[9px] text-slate-300 w-20 flex-shrink-0">{label}</span>
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{width:`${prob*100}%`}}/>
                </div>
                <span className="text-[9px] font-black text-white w-8 text-right">{(prob*100).toFixed(0)}%</span>
                <span className="text-[9px] text-yellow-400 font-bold w-8 text-right">{odds}</span>
              </div>
            ))}
          </div>
          <div className="bg-slate-900/60 rounded-xl p-2">
            <div className="text-[7px] text-slate-500 uppercase mb-1.5">Beide teams scoren</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                {label:'Ja',  prob:prediction.btts||0,          odds:bttsY, color:'text-green-400'},
                {label:'Nee', prob:1-(prediction.btts||0), odds:bttsN, color:'text-red-400'},
              ].map(({label,prob,odds,color})=>(
                <div key={label} className="bg-slate-800/60 rounded-lg p-2 text-center">
                  <div className={`text-[7px] font-black ${color} uppercase`}>BTTS {label}</div>
                  <div className="text-sm font-black text-white">{(prob*100).toFixed(0)}%</div>
                  <div className="text-[9px] text-yellow-400 font-bold">{odds}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stats tab */}
      {tab==='stats' && (
        <div className="space-y-2">
          {(homeSeasonStats || awaySeasonStats) && (homeSeasonStats?.possession || awaySeasonStats?.possession) ? (
            <div className="bg-slate-900/60 rounded-xl p-2">
              <div className="text-[7px] text-slate-500 uppercase mb-1.5">Balbezit (seizoen)</div>
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-black text-blue-400 w-8">{homeSeasonStats?.possession||50}%</span>
                <div className="flex-1 flex h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div className="bg-blue-500 h-full" style={{width:`${homeSeasonStats?.possession||50}%`}}/>
                  <div className="bg-red-500 h-full flex-1"/>
                </div>
                <span className="text-[8px] font-black text-red-400 w-8 text-right">{awaySeasonStats?.possession||50}%</span>
              </div>
            </div>
          ) : null}

          {prediction.homeElo && prediction.awayElo && (
            <div className="bg-slate-900/60 rounded-xl p-2">
              <div className="text-[7px] text-slate-500 uppercase mb-1.5">Elo sterkte</div>
              <div className="flex items-center gap-3">
                <div className="text-center">
                  <div className="text-base font-black text-purple-400">{prediction.homeElo}</div>
                  <div className="text-[7px] text-slate-500">{match.homeTeamName.split(' ')[0]}</div>
                </div>
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-500 rounded-full"
                    style={{width:`${(prediction.homeElo/(prediction.homeElo+prediction.awayElo))*100}%`}}/>
                </div>
                <div className="text-center">
                  <div className="text-base font-black text-purple-400">{prediction.awayElo}</div>
                  <div className="text-[7px] text-slate-500">{match.awayTeamName.split(' ')[0]}</div>
                </div>
              </div>
            </div>
          )}

          {(homeSeasonStats?.shotsOn || awaySeasonStats?.shotsOn) && (
            <div className="bg-slate-900/60 rounded-xl p-2">
              <div className="text-[7px] text-slate-500 uppercase mb-1.5">Schoten op doel/wedstrijd</div>
              {[
                {label:'Schoten op doel', h:homeSeasonStats?.shotsOn, a:awaySeasonStats?.shotsOn, max:8},
                {label:'Schoten totaal', h:homeSeasonStats?.shots, a:awaySeasonStats?.shots, max:20},
              ].filter(s=>s.h||s.a).map(({label,h,a,max})=>(
                <div key={label} className="mb-1.5">
                  <div className="text-[7px] text-slate-500 mb-0.5">{label}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-black text-blue-400 w-6 text-right">{h?.toFixed(1)||'-'}</span>
                    <div className="flex-1 flex gap-0.5">
                      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden flex justify-end">
                        <div className="h-full bg-blue-500 rounded-full" style={{width:`${Math.min(100,((h||0)/max)*100)}%`}}/>
                      </div>
                      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-red-500 rounded-full" style={{width:`${Math.min(100,((a||0)/max)*100)}%`}}/>
                      </div>
                    </div>
                    <span className="text-[8px] font-black text-red-400 w-6">{a?.toFixed(1)||'-'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MatchCard;
