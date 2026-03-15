import React, { useState, useCallback } from 'react';
import { Match, Prediction } from '../types';

interface MatchCardProps {
  match: Match;
  prediction?: Prediction;
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

function StatBar({ label, value, max = 100, color = 'bg-blue-500' }: { label: string, value: number, max?: number, color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[8px] text-slate-400 w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
      <span className="text-[9px] font-black text-white w-10 text-right">{value.toFixed(0)}%</span>
    </div>
  );
}

const MatchCard: React.FC<MatchCardProps> = ({ match, prediction }) => {
  const [tab, setTab] = useState<'analyse' | 'h2h' | 'markten' | 'stats'>('analyse');
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const loadAiAnalysis = useCallback(async () => {
    if (aiAnalysis || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match, prediction })
      });
      const data = await res.json();
      if (data.analysis) setAiAnalysis(data.analysis);
      else setAiError(data.error || 'Analyse niet beschikbaar');
    } catch {
      setAiError('Verbinding mislukt');
    } finally {
      setAiLoading(false);
    }
  }, [match, prediction, aiAnalysis, aiLoading]);

  if (!prediction) {
    return (
      <div className="glass-card rounded-2xl p-4 border border-white/5 animate-pulse">
        <div className="h-3 bg-slate-800 rounded w-1/2 mb-4" />
        <div className="flex justify-between gap-2 mb-3">
          {[0, 1].map(i => (
            <div key={i} className="flex-1 flex flex-col items-center gap-2">
              <div className="w-10 h-10 bg-slate-800 rounded-full" />
              <div className="h-2 bg-slate-800 rounded w-16" />
            </div>
          ))}
          <div className="w-14 h-8 bg-slate-800 rounded mx-2" />
        </div>
      </div>
    );
  }

  const isFinishedMatch = match.status === 'FT';
  const isLiveMatch     = match.status === 'LIVE' || !!(match.minute);
  const hasResult       = !!match.score && match.score !== 'v';
  const predictedScore  = `${prediction.predHomeGoals}-${prediction.predAwayGoals}`;
  const isCorrect       = isFinishedMatch && hasResult && match.score?.trim() === predictedScore.trim();

  const kickoffTime = match.kickoff
    ? new Date(match.kickoff).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    : null;

  // Noteringen
  const fmt = (p: number) => p > 0.01 ? (1 / p).toFixed(2) : '-';
  const homeOdds   = fmt(prediction.homeProb);
  const drawOdds   = fmt(prediction.drawProb);
  const awayOdds   = fmt(prediction.awayProb);
  const over25Odds = fmt((prediction as any).over25 || 0);
  const under25Odds= (prediction as any).over25 > 0 ? (1 / (1 - (prediction as any).over25)).toFixed(2) : '-';
  const bttsYesOdds= fmt((prediction as any).btts || 0);
  const bttsNoOdds = (prediction as any).btts > 0 ? (1 / (1 - (prediction as any).btts)).toFixed(2) : '-';

  const maxProb    = Math.max(prediction.homeProb, prediction.drawProb, prediction.awayProb);
  const favLabel   = maxProb === prediction.homeProb ? `${match.homeTeamName} wint`
                   : maxProb === prediction.drawProb ? 'Gelijkspel'
                   : `${match.awayTeamName} wint`;

  const statusTone = isCorrect      ? 'border-green-400/60 bg-green-900/15'
                   : isLiveMatch    ? 'border-red-500/40 bg-red-900/10'
                   : isFinishedMatch? 'border-slate-500/30 bg-slate-900/40'
                   :                  'border-blue-500/15 bg-blue-900/5';

  const h2h  = (match as any).h2h;
  const homeSeasonStats = (match as any).homeSeasonStats;
  const awaySeasonStats = (match as any).awaySeasonStats;

  const scoreMatrix = (prediction as any).scoreMatrix || {};
  const topScores   = Object.entries(scoreMatrix).sort((a: any, b: any) => b[1] - a[1]).slice(0, 6);

  return (
    <div className={`glass-card rounded-2xl p-3 border transition-all ${statusTone}`}>

      {/* ─── Header ─── */}
      <div className="flex justify-between items-center mb-2">
        <span className="text-[8px] font-black text-blue-400 uppercase truncate max-w-[60%]">
          {match.league?.split(' ').slice(1).join(' ')}
        </span>
        <div className="flex items-center gap-1">
          {isCorrect && <span className="bg-green-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded">✓ CORRECT</span>}
          {isLiveMatch && <span className="bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded animate-pulse">● LIVE {match.minute}</span>}
          {!isLiveMatch && kickoffTime && !isFinishedMatch && <span className="text-[8px] text-slate-400">🕐 {kickoffTime}</span>}
          {isFinishedMatch && !isLiveMatch && <span className="bg-slate-700 text-slate-300 text-[7px] font-black px-1.5 py-0.5 rounded">FT</span>}
        </div>
      </div>

      {/* ─── Teams + Score ─── */}
      <div className="flex items-center justify-between gap-1 mb-3">
        {/* Thuis */}
        <div className="flex flex-col items-center flex-1 gap-0.5 min-w-0">
          <img src={match.homeLogo} className="w-9 h-9 object-contain p-0.5 rounded-full bg-slate-800/50" alt=""
            onError={(e) => { (e.target as any).src = `https://ui-avatars.com/api/?name=${match.homeTeamName[0]}&background=1e293b&color=60a5fa&size=36&bold=true`; }} />
          <span className="text-[9px] font-black text-white line-clamp-2 text-center leading-tight px-1">{match.homeTeamName}</span>
          <FormBadge form={(prediction as any).homeForm || (match as any).homeForm || ''} />
          {(prediction as any).homeElo && <span className="text-[7px] text-slate-600">Elo {(prediction as any).homeElo}</span>}
        </div>

        {/* Score */}
        <div className="flex flex-col items-center min-w-[68px] gap-0.5">
          <div className="text-lg font-black">
            {hasResult
              ? <span className={isLiveMatch ? 'text-red-300' : 'text-white'}>{match.score}</span>
              : <span className="text-slate-600 text-sm">vs</span>}
          </div>
          <div className="bg-blue-600 px-2 py-0.5 rounded-full text-center shadow-lg shadow-blue-600/20">
            <div className="text-white text-[10px] font-black leading-tight">{prediction.predHomeGoals}-{prediction.predAwayGoals}</div>
            <div className="text-[6px] text-blue-200 font-bold uppercase">AI tip</div>
          </div>
          <div className="text-[7px] text-yellow-400 font-bold text-center leading-tight">{favLabel}</div>
        </div>

        {/* Uit */}
        <div className="flex flex-col items-center flex-1 gap-0.5 min-w-0">
          <img src={match.awayLogo} className="w-9 h-9 object-contain p-0.5 rounded-full bg-slate-800/50" alt=""
            onError={(e) => { (e.target as any).src = `https://ui-avatars.com/api/?name=${match.awayTeamName[0]}&background=1e293b&color=60a5fa&size=36&bold=true`; }} />
          <span className="text-[9px] font-black text-white line-clamp-2 text-center leading-tight px-1">{match.awayTeamName}</span>
          <FormBadge form={(prediction as any).awayForm || (match as any).awayForm || ''} />
          {(prediction as any).awayElo && <span className="text-[7px] text-slate-600">Elo {(prediction as any).awayElo}</span>}
        </div>
      </div>

      {/* ─── Kansen balk ─── */}
      <div className="flex h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
        <div className="bg-green-500 h-full" style={{ width: `${prediction.homeProb * 100}%` }} />
        <div className="bg-slate-500 h-full" style={{ width: `${prediction.drawProb * 100}%` }} />
        <div className="bg-red-500  h-full" style={{ width: `${prediction.awayProb * 100}%` }} />
      </div>

      {/* ─── 1X2 kansen + noteringen ─── */}
      <div className="grid grid-cols-3 gap-1 mb-3">
        {[
          { label: '1 Thuis', prob: prediction.homeProb, odds: homeOdds, color: 'text-green-400' },
          { label: 'X Gelijk', prob: prediction.drawProb, odds: drawOdds, color: 'text-slate-400' },
          { label: '2 Uit',   prob: prediction.awayProb, odds: awayOdds, color: 'text-red-400'   },
        ].map(({ label, prob, odds, color }) => (
          <div key={label} className="bg-slate-900/60 rounded-lg p-1.5 text-center">
            <div className={`text-[7px] font-black ${color} uppercase leading-tight`}>{label}</div>
            <div className="text-[11px] font-black text-white">{(prob * 100).toFixed(0)}%</div>
            <div className="text-[10px] font-bold text-yellow-400 bg-yellow-900/20 rounded px-1">{odds}</div>
          </div>
        ))}
      </div>

      {/* ─── Tabs ─── */}
      <div className="grid grid-cols-4 gap-0.5 mb-2 border-t border-white/5 pt-2">
        {([
          { key: 'analyse', label: '🤖 Analyse' },
          { key: 'h2h',     label: '⚔️ H2H'     },
          { key: 'markten', label: '📊 Markten'  },
          { key: 'stats',   label: '📈 Stats'    },
        ] as const).map(({ key, label }) => (
          <button key={key}
            onClick={() => { setTab(key); if (key === 'analyse') loadAiAnalysis(); }}
            className={`py-1 rounded-lg text-[8px] font-black transition ${tab === key ? 'bg-blue-600 text-white' : 'bg-slate-800/60 text-slate-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ─── Tab: Analyse ─── */}
      {tab === 'analyse' && (
        <div className="space-y-2">
          {/* AI Claude analyse */}
          <div className="bg-gradient-to-br from-blue-950/60 to-purple-950/40 border border-blue-500/20 rounded-xl p-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[7px] font-black text-blue-400 uppercase">Claude AI Analyse</span>
              {aiLoading && <span className="text-[7px] text-slate-500 animate-pulse">laden...</span>}
            </div>
            {aiAnalysis ? (
              <p className="text-[9px] text-blue-100/90 leading-relaxed">{aiAnalysis}</p>
            ) : aiError ? (
              <div>
                <p className="text-[9px] text-slate-500 mb-1">Analyse niet geladen.</p>
                <button onClick={loadAiAnalysis}
                  className="text-[8px] text-blue-400 hover:text-blue-300 underline">Opnieuw proberen</button>
              </div>
            ) : (
              <button onClick={loadAiAnalysis}
                className="w-full py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/20 rounded-lg text-[9px] font-black text-blue-300 transition">
                🤖 Genereer Claude analyse
              </button>
            )}
          </div>

          {/* xG + score matrix */}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="bg-slate-900/60 rounded-lg p-2 text-center">
              <div className="text-[7px] text-slate-500 uppercase">xG Thuis</div>
              <div className="text-base font-black text-blue-400">{prediction.homeXG?.toFixed(2)}</div>
              <div className="text-[7px] text-slate-600">{match.homeTeamName.split(' ')[0]}</div>
            </div>
            <div className="bg-slate-900/60 rounded-lg p-2 text-center">
              <div className="text-[7px] text-slate-500 uppercase">xG Uit</div>
              <div className="text-base font-black text-blue-400">{prediction.awayXG?.toFixed(2)}</div>
              <div className="text-[7px] text-slate-600">{match.awayTeamName.split(' ')[0]}</div>
            </div>
          </div>

          {topScores.length > 0 && (
            <div className="bg-slate-900/60 rounded-xl p-2">
              <div className="text-[7px] text-slate-500 uppercase mb-1.5">Score matrix (Dixon-Coles)</div>
              <div className="flex flex-wrap gap-1">
                {topScores.map(([score, prob]: any) => (
                  <div key={score} className={`px-2 py-0.5 rounded-lg text-[9px] font-black flex items-center gap-1
                    ${score === predictedScore ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}>
                    {score}
                    <span className="opacity-60">{(prob * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Zekerheidsbar */}
          <div className="flex items-center gap-2">
            <span className="text-[7px] text-slate-500 w-14">Zekerheid</span>
            <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${prediction.confidence > 0.6 ? 'bg-green-500' : prediction.confidence > 0.3 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${prediction.confidence * 100}%` }} />
            </div>
            <span className="text-[8px] font-black text-slate-300">{(prediction.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* ─── Tab: H2H ─── */}
      {tab === 'h2h' && (
        <div>
          {h2h ? (
            <div className="space-y-1.5">
              <div className="grid grid-cols-3 gap-1 text-center">
                {[
                  { label: `${match.homeTeamName.split(' ')[0]} wint`, val: h2h.homeWins, color: 'bg-green-900/20 border-green-500/20 text-green-400' },
                  { label: 'Gelijk',                                   val: h2h.draws,    color: 'bg-slate-800/60 text-slate-400'                     },
                  { label: `${match.awayTeamName.split(' ')[0]} wint`, val: h2h.awayWins, color: 'bg-red-900/20 border-red-500/20 text-red-400'        },
                ].map(({ label, val, color }) => (
                  <div key={label} className={`border rounded-lg p-1.5 ${color}`}>
                    <div className="text-[7px] font-black uppercase leading-tight">{label}</div>
                    <div className="text-xl font-black text-white">{val}</div>
                  </div>
                ))}
              </div>
              <div className="bg-slate-900/60 rounded-xl p-2 space-y-1">
                <div className="text-[7px] text-slate-500 uppercase mb-1">Laatste {Math.min(5, h2h.results.length)} ontmoetingen</div>
                {h2h.results.slice(-5).reverse().map((r: any, i: number) => (
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
              <div className="text-2xl mb-2">⚔️</div>
              H2H data nog niet beschikbaar
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Markten ─── */}
      {tab === 'markten' && (
        <div className="space-y-2">
          <div className="bg-slate-900/60 rounded-xl p-2">
            <div className="text-[7px] text-slate-500 uppercase mb-2">Over / Under doelpunten</div>
            <div className="space-y-1.5">
              {[
                { label: 'Over 1.5',  prob: (prediction as any).over15 || 0,           odds: fmt((prediction as any).over15 || 0)  },
                { label: 'Over 2.5',  prob: (prediction as any).over25 || 0,           odds: over25Odds                             },
                { label: 'Under 2.5', prob: 1 - ((prediction as any).over25 || 0),    odds: under25Odds                            },
                { label: 'Over 3.5',  prob: (prediction as any).over35 || 0,           odds: fmt((prediction as any).over35 || 0)  },
              ].map(({ label, prob, odds }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-300 w-20 flex-shrink-0">{label}</span>
                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(prob) * 100}%` }} />
                  </div>
                  <span className="text-[9px] font-black text-white w-8 text-right">{(prob * 100).toFixed(0)}%</span>
                  <span className="text-[9px] text-yellow-400 font-bold w-8 text-right">{odds}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900/60 rounded-xl p-2">
            <div className="text-[7px] text-slate-500 uppercase mb-2">Beide teams scoren (BTTS)</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Ja', prob: (prediction as any).btts || 0, odds: bttsYesOdds, color: 'text-green-400' },
                { label: 'Nee', prob: 1 - ((prediction as any).btts || 0), odds: bttsNoOdds, color: 'text-red-400' },
              ].map(({ label, prob, odds, color }) => (
                <div key={label} className="bg-slate-800/60 rounded-lg p-2 text-center">
                  <div className={`text-[7px] font-black ${color} uppercase`}>BTTS {label}</div>
                  <div className="text-sm font-black text-white">{(prob * 100).toFixed(0)}%</div>
                  <div className="text-[9px] text-yellow-400 font-bold">{odds}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Tab: Stats ─── */}
      {tab === 'stats' && (
        <div className="space-y-2">
          {(homeSeasonStats || awaySeasonStats) ? (
            <>
              {/* Balbezit */}
              {(homeSeasonStats?.possession || awaySeasonStats?.possession) && (
                <div className="bg-slate-900/60 rounded-xl p-2">
                  <div className="text-[7px] text-slate-500 uppercase mb-2">Balbezit (seizoensgemiddelde)</div>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] text-white w-16 truncate">{match.homeTeamName.split(' ')[0]}</span>
                    <div className="flex-1 flex h-3 bg-slate-800 rounded-full overflow-hidden">
                      <div className="bg-blue-500 h-full" style={{ width: `${homeSeasonStats?.possession || 50}%` }} />
                      <div className="bg-red-500 h-full flex-1" />
                    </div>
                    <span className="text-[8px] text-white w-16 truncate text-right">{match.awayTeamName.split(' ')[0]}</span>
                  </div>
                  <div className="flex justify-between text-[8px] font-black mt-0.5">
                    <span className="text-blue-400">{homeSeasonStats?.possession || 50}%</span>
                    <span className="text-red-400">{awaySeasonStats?.possession || 50}%</span>
                  </div>
                </div>
              )}

              {/* Schoten vergelijking */}
              {(homeSeasonStats?.shotsOn || awaySeasonStats?.shotsOn) && (
                <div className="bg-slate-900/60 rounded-xl p-2">
                  <div className="text-[7px] text-slate-500 uppercase mb-2">Gemiddeld per wedstrijd (seizoen)</div>
                  <div className="space-y-1.5">
                    {[
                      { label: 'Schoten op doel', homeVal: homeSeasonStats?.shotsOn, awayVal: awaySeasonStats?.shotsOn, max: 8 },
                      { label: 'Schoten totaal',  homeVal: homeSeasonStats?.shots,   awayVal: awaySeasonStats?.shots,   max: 20 },
                      { label: 'Hoekschoppen',    homeVal: homeSeasonStats?.corners, awayVal: awaySeasonStats?.corners, max: 10 },
                    ].filter(s => s.homeVal || s.awayVal).map(({ label, homeVal, awayVal, max }) => (
                      <div key={label}>
                        <div className="text-[7px] text-slate-500 mb-0.5">{label}</div>
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-black text-blue-400 w-6 text-right">{homeVal?.toFixed(1) || '-'}</span>
                          <div className="flex-1 flex gap-0.5">
                            <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full ml-auto" style={{ width: `${Math.min(100, ((homeVal || 0) / max) * 100)}%` }} />
                            </div>
                            <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                              <div className="h-full bg-red-500 rounded-full" style={{ width: `${Math.min(100, ((awayVal || 0) / max) * 100)}%` }} />
                            </div>
                          </div>
                          <span className="text-[8px] font-black text-red-400 w-6">{awayVal?.toFixed(1) || '-'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-6 text-slate-500 text-[10px]">
              <div className="text-2xl mb-2">📈</div>
              Seizoensstatistieken worden geladen na de volgende worker run
            </div>
          )}

          {/* Elo vergelijking */}
          <div className="bg-slate-900/60 rounded-xl p-2">
            <div className="text-[7px] text-slate-500 uppercase mb-1.5">Elo sterkte</div>
            <div className="flex items-center gap-3">
              <div className="text-center">
                <div className="text-base font-black text-purple-400">{(prediction as any).homeElo || '~'}</div>
                <div className="text-[7px] text-slate-500">{match.homeTeamName.split(' ')[0]}</div>
              </div>
              <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                {(prediction as any).homeElo && (prediction as any).awayElo && (
                  <div className="h-full bg-purple-500 rounded-full"
                    style={{ width: `${((prediction as any).homeElo / ((prediction as any).homeElo + (prediction as any).awayElo)) * 100}%` }} />
                )}
              </div>
              <div className="text-center">
                <div className="text-base font-black text-purple-400">{(prediction as any).awayElo || '~'}</div>
                <div className="text-[7px] text-slate-500">{match.awayTeamName.split(' ')[0]}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MatchCard;
