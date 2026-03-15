import React, { useState } from 'react';
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

function ProbBar({ home, draw, away }: { home: number, draw: number, away: number }) {
  return (
    <div className="flex h-1.5 bg-slate-800 rounded-full overflow-hidden">
      <div className="bg-green-500 h-full" style={{ width: `${home * 100}%` }} />
      <div className="bg-slate-500 h-full" style={{ width: `${draw * 100}%` }} />
      <div className="bg-red-500 h-full" style={{ width: `${away * 100}%` }} />
    </div>
  );
}

const MatchCard: React.FC<MatchCardProps> = ({ match, prediction }) => {
  const [tab, setTab] = useState<'pred' | 'h2h' | 'stats'>('pred');

  if (!prediction) {
    return (
      <div className="glass-card rounded-2xl p-4 border border-white/5 animate-pulse">
        <div className="h-3 bg-slate-800 rounded w-1/2 mb-4" />
        <div className="flex justify-between gap-2 mb-3">
          <div className="flex-1 flex flex-col items-center gap-2">
            <div className="w-10 h-10 bg-slate-800 rounded-full" />
            <div className="h-2 bg-slate-800 rounded w-16" />
          </div>
          <div className="w-14 h-8 bg-slate-800 rounded" />
          <div className="flex-1 flex flex-col items-center gap-2">
            <div className="w-10 h-10 bg-slate-800 rounded-full" />
            <div className="h-2 bg-slate-800 rounded w-16" />
          </div>
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

  // Noteringen vanuit kansen
  const homeOdds = prediction.homeProb > 0.01 ? (1 / prediction.homeProb).toFixed(2) : '-';
  const drawOdds = prediction.drawProb > 0.01 ? (1 / prediction.drawProb).toFixed(2) : '-';
  const awayOdds = prediction.awayProb > 0.01 ? (1 / prediction.awayProb).toFixed(2) : '-';
  const over25Odds = (prediction as any).over25 > 0.01 ? (1 / (prediction as any).over25).toFixed(2) : '-';
  const under25Odds = (prediction as any).over25 > 0.01 ? (1 / (1 - (prediction as any).over25)).toFixed(2) : '-';
  const bttsOdds = (prediction as any).btts > 0.01 ? (1 / (prediction as any).btts).toFixed(2) : '-';

  const statusTone = isCorrect
    ? 'border-green-400/60 bg-green-900/15'
    : isLiveMatch ? 'border-red-500/40 bg-red-900/10'
    : isFinishedMatch ? 'border-slate-500/30 bg-slate-900/40'
    : 'border-blue-500/20 bg-blue-900/5';

  // H2H data
  const h2h = (match as any).h2h;

  // Top scores uit matrix
  const scoreMatrix = (prediction as any).scoreMatrix || {};
  const topScores = Object.entries(scoreMatrix)
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className={`glass-card rounded-2xl p-3 border transition-all ${statusTone}`}>
      {/* Header */}
      <div className="flex justify-between items-center mb-2">
        <span className="text-[8px] font-black text-blue-400 uppercase truncate max-w-[55%]">
          {match.league?.split(' ').slice(1).join(' ')}
        </span>
        <div className="flex items-center gap-1">
          {isCorrect && <span className="bg-green-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded">✓</span>}
          {isLiveMatch && <span className="bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded animate-pulse">● {match.minute}</span>}
          {!isLiveMatch && kickoffTime && !isFinishedMatch && <span className="text-[8px] text-slate-400">{kickoffTime}</span>}
          {isFinishedMatch && !isLiveMatch && <span className="bg-slate-700 text-slate-300 text-[7px] font-black px-1.5 py-0.5 rounded">FT</span>}
        </div>
      </div>

      {/* Teams + score */}
      <div className="flex items-center justify-between gap-1 mb-2">
        <div className="flex flex-col items-center flex-1 gap-0.5">
          <img src={match.homeLogo} className="w-9 h-9 object-contain p-0.5 rounded-full bg-slate-800/50"
            onError={(e) => { (e.target as any).src = `https://ui-avatars.com/api/?name=${match.homeTeamName[0]}&background=1e293b&color=60a5fa&size=36&bold=true`; }} alt="" />
          <span className="text-[9px] font-black text-white line-clamp-2 text-center leading-tight">{match.homeTeamName}</span>
          <FormBadge form={(prediction as any).homeForm || (match as any).homeForm || ''} />
          {(prediction as any).homeElo && <span className="text-[7px] text-slate-600">Elo {(prediction as any).homeElo}</span>}
        </div>

        <div className="flex flex-col items-center min-w-[70px] gap-0.5">
          <div className="text-lg font-black">
            {hasResult ? <span className={isLiveMatch ? 'text-red-300' : 'text-white'}>{match.score}</span>
                       : <span className="text-slate-600 text-sm">vs</span>}
          </div>
          <div className="bg-blue-600 px-2 py-0.5 rounded-full flex flex-col items-center">
            <span className="text-white text-[10px] font-black">{prediction.predHomeGoals}-{prediction.predAwayGoals}</span>
            <span className="text-[6px] text-blue-200 font-bold -mt-0.5">AI tip</span>
          </div>
        </div>

        <div className="flex flex-col items-center flex-1 gap-0.5">
          <img src={match.awayLogo} className="w-9 h-9 object-contain p-0.5 rounded-full bg-slate-800/50"
            onError={(e) => { (e.target as any).src = `https://ui-avatars.com/api/?name=${match.awayTeamName[0]}&background=1e293b&color=60a5fa&size=36&bold=true`; }} alt="" />
          <span className="text-[9px] font-black text-white line-clamp-2 text-center leading-tight">{match.awayTeamName}</span>
          <FormBadge form={(prediction as any).awayForm || (match as any).awayForm || ''} />
          {(prediction as any).awayElo && <span className="text-[7px] text-slate-600">Elo {(prediction as any).awayElo}</span>}
        </div>
      </div>

      {/* Kansen balk */}
      <ProbBar home={prediction.homeProb} draw={prediction.drawProb} away={prediction.awayProb} />

      {/* 1X2 kansen + noteringen */}
      <div className="grid grid-cols-3 gap-1 text-center my-2">
        {[
          { label: '1', prob: prediction.homeProb, odds: homeOdds, color: 'text-green-400' },
          { label: 'X', prob: prediction.drawProb, odds: drawOdds, color: 'text-slate-400' },
          { label: '2', prob: prediction.awayProb, odds: awayOdds, color: 'text-red-400' },
        ].map(({ label, prob, odds, color }) => (
          <div key={label} className="bg-slate-900/60 rounded-lg p-1.5">
            <div className={`text-[8px] font-black ${color} uppercase`}>{label}</div>
            <div className="text-[10px] font-black text-white">{(prob * 100).toFixed(0)}%</div>
            <div className="text-[9px] font-bold text-yellow-400">{odds}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-2 border-t border-white/5 pt-2">
        {[
          { key: 'pred', label: 'Analyse' },
          { key: 'h2h', label: 'H2H' },
          { key: 'stats', label: 'Markten' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key as any)}
            className={`flex-1 py-1 rounded-lg text-[9px] font-black transition ${tab === key ? 'bg-blue-600 text-white' : 'bg-slate-800/60 text-slate-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Tab inhoud */}
      {tab === 'pred' && (
        <div className="space-y-1.5">
          {/* xG */}
          <div className="grid grid-cols-2 gap-1">
            <div className="bg-slate-900/60 rounded-lg p-2 text-center">
              <div className="text-[7px] text-slate-500 uppercase">xG Thuis</div>
              <div className="text-sm font-black text-blue-400">{prediction.homeXG?.toFixed(2)}</div>
            </div>
            <div className="bg-slate-900/60 rounded-lg p-2 text-center">
              <div className="text-[7px] text-slate-500 uppercase">xG Uit</div>
              <div className="text-sm font-black text-blue-400">{prediction.awayXG?.toFixed(2)}</div>
            </div>
          </div>

          {/* Top score kansen */}
          {topScores.length > 0 && (
            <div className="bg-slate-900/60 rounded-lg p-2">
              <div className="text-[7px] text-slate-500 uppercase mb-1.5">Meest waarschijnlijke scores</div>
              <div className="flex flex-wrap gap-1">
                {topScores.map(([score, prob]: any) => (
                  <div key={score} className={`px-2 py-0.5 rounded text-[9px] font-black ${score === predictedScore ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}>
                    {score} <span className="opacity-70">{(prob * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confidence */}
          <div className="flex items-center gap-2">
            <span className="text-[7px] text-slate-500 font-bold w-14">Zekerheid</span>
            <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${prediction.confidence > 0.6 ? 'bg-green-500' : prediction.confidence > 0.3 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${prediction.confidence * 100}%` }} />
            </div>
            <span className="text-[8px] font-black text-slate-300">{(prediction.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {tab === 'h2h' && (
        <div>
          {h2h ? (
            <div className="space-y-1.5">
              <div className="grid grid-cols-3 gap-1 text-center">
                <div className="bg-green-900/20 border border-green-500/20 rounded-lg p-1.5">
                  <div className="text-[7px] text-green-400 uppercase">Thuis wins</div>
                  <div className="text-lg font-black text-white">{h2h.homeWins}</div>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-1.5">
                  <div className="text-[7px] text-slate-400 uppercase">Gelijk</div>
                  <div className="text-lg font-black text-white">{h2h.draws}</div>
                </div>
                <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-1.5">
                  <div className="text-[7px] text-red-400 uppercase">Uit wins</div>
                  <div className="text-lg font-black text-white">{h2h.awayWins}</div>
                </div>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-2 space-y-1">
                <div className="text-[7px] text-slate-500 uppercase mb-1">Laatste ontmoetingen</div>
                {h2h.results.slice(-5).reverse().map((r: any, i: number) => (
                  <div key={i} className="flex justify-between items-center text-[9px]">
                    <span className="text-slate-400 truncate max-w-[100px]">{r.home}</span>
                    <span className="font-black text-white mx-1">{r.score}</span>
                    <span className="text-slate-400 truncate max-w-[100px] text-right">{r.away}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-4 text-slate-500 text-[10px]">H2H data nog niet beschikbaar</div>
          )}
        </div>
      )}

      {tab === 'stats' && (
        <div className="space-y-1.5">
          {/* Over/Under */}
          <div className="bg-slate-900/60 rounded-lg p-2">
            <div className="text-[7px] text-slate-500 uppercase mb-1.5">Over/Under doelpunten</div>
            <div className="space-y-1">
              {[
                { label: 'Over 1.5', prob: (prediction as any).over15, odds: (prediction as any).over15 > 0 ? (1/(prediction as any).over15).toFixed(2) : '-' },
                { label: 'Over 2.5', prob: (prediction as any).over25, odds: over25Odds },
                { label: 'Under 2.5', prob: 1 - ((prediction as any).over25 || 0), odds: under25Odds },
                { label: 'Over 3.5', prob: (prediction as any).over35, odds: (prediction as any).over35 > 0 ? (1/(prediction as any).over35).toFixed(2) : '-' },
              ].map(({ label, prob, odds }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-300 w-20">{label}</span>
                  <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(prob || 0) * 100}%` }} />
                  </div>
                  <span className="text-[9px] font-black text-white w-10 text-right">{((prob || 0) * 100).toFixed(0)}%</span>
                  <span className="text-[9px] text-yellow-400 w-8 text-right">{odds}</span>
                </div>
              ))}
            </div>
          </div>

          {/* BTTS */}
          <div className="bg-slate-900/60 rounded-lg p-2">
            <div className="text-[7px] text-slate-500 uppercase mb-1.5">Beide teams scoren (BTTS)</div>
            <div className="flex justify-between items-center">
              <div className="text-center">
                <div className="text-[7px] text-green-400">Ja</div>
                <div className="text-sm font-black text-white">{((prediction as any).btts * 100 || 0).toFixed(0)}%</div>
                <div className="text-[9px] text-yellow-400">{bttsOdds}</div>
              </div>
              <div className="flex-1 mx-3 h-1 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full" style={{ width: `${((prediction as any).btts || 0) * 100}%` }} />
              </div>
              <div className="text-center">
                <div className="text-[7px] text-red-400">Nee</div>
                <div className="text-sm font-black text-white">{(100 - ((prediction as any).btts || 0) * 100).toFixed(0)}%</div>
                <div className="text-[9px] text-yellow-400">{(1 - ((prediction as any).btts || 0)) > 0 ? (1 / (1 - ((prediction as any).btts || 0))).toFixed(2) : '-'}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MatchCard;
