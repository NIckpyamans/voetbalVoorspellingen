import React, { useState } from 'react';
import { Match, Prediction } from '../types';

interface MatchCardProps {
  match: Match;
  prediction?: Prediction;
}

// Vorm badges W/D/L
function FormBadge({ form }: { form: string }) {
  if (!form) return null;
  const letters = form.slice(-5).split('');
  return (
    <div className="flex gap-0.5">
      {letters.map((l, i) => (
        <span key={i} className={`w-4 h-4 rounded text-[8px] font-black flex items-center justify-center
          ${l === 'W' ? 'bg-green-500 text-white' : l === 'D' ? 'bg-yellow-500 text-black' : 'bg-red-500 text-white'}`}>
          {l}
        </span>
      ))}
    </div>
  );
}

const MatchCard: React.FC<MatchCardProps> = ({ match, prediction }) => {
  const [showDetails, setShowDetails] = useState(false);

  if (!prediction) {
    return (
      <div className="glass-card rounded-2xl p-4 border border-white/5 animate-pulse">
        <div className="h-3 bg-slate-800 rounded w-1/2 mb-4"></div>
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex-1 flex flex-col items-center gap-2">
            <div className="w-10 h-10 bg-slate-800 rounded-full"></div>
            <div className="h-2 bg-slate-800 rounded w-16"></div>
          </div>
          <div className="w-16 h-8 bg-slate-800 rounded"></div>
          <div className="flex-1 flex flex-col items-center gap-2">
            <div className="w-10 h-10 bg-slate-800 rounded-full"></div>
            <div className="h-2 bg-slate-800 rounded w-16"></div>
          </div>
        </div>
      </div>
    );
  }

  const isFinishedMatch = match.status === 'FT' || (match.status || '').toLowerCase().includes('finish');
  const isLiveMatch = match.status === 'LIVE' || !!(match.minute);
  const hasResult = !!match.score && match.score !== "" && match.score !== "v";
  const predictedScore = `${prediction.predHomeGoals}-${prediction.predAwayGoals}`;
  const isCorrect = isFinishedMatch && hasResult && match.score?.trim() === predictedScore.trim();

  const kickoffTime = match.kickoff
    ? new Date(match.kickoff).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    : null;

  // Odds berekend vanuit kansen
  const homeOdds = prediction.homeProb > 0.01 ? (1 / prediction.homeProb).toFixed(2) : '-';
  const drawOdds = prediction.drawProb > 0.01 ? (1 / prediction.drawProb).toFixed(2) : '-';
  const awayOdds = prediction.awayProb > 0.01 ? (1 / prediction.awayProb).toFixed(2) : '-';

  // Favoriete uitkomst
  const maxProb = Math.max(prediction.homeProb, prediction.drawProb, prediction.awayProb);
  const favoriteTip = maxProb === prediction.homeProb ? `Thuis wint` :
                      maxProb === prediction.drawProb ? `Gelijkspel` : `Uit wint`;

  const statusTone = isCorrect        ? 'border-green-400/60 bg-green-900/15'
                   : isLiveMatch      ? 'border-red-500/40 bg-red-900/10'
                   : isFinishedMatch  ? 'border-slate-500/30 bg-slate-900/40'
                   :                   'border-blue-500/20 bg-blue-900/5';

  return (
    <div className={`glass-card rounded-2xl p-4 transition-all border shadow-lg ${statusTone}`}>
      {/* Header: competitie + status */}
      <div className="flex justify-between items-center mb-3">
        <span className="text-[9px] font-black text-blue-400 uppercase tracking-tighter truncate max-w-[55%]">
          {match.league?.split(' ').slice(1).join(' ')}
        </span>
        <div className="flex items-center gap-1.5">
          {isCorrect && <span className="bg-green-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded">✓ CORRECT</span>}
          {isLiveMatch && (
            <span className="flex items-center gap-0.5 bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded animate-pulse">
              ● LIVE {match.minute}
            </span>
          )}
          {!isLiveMatch && kickoffTime && !isFinishedMatch && (
            <span className="text-[9px] text-slate-400">🕐 {kickoffTime}</span>
          )}
          {isFinishedMatch && !isLiveMatch && (
            <span className="bg-slate-700 text-slate-300 text-[7px] font-black px-1.5 py-0.5 rounded">FT</span>
          )}
        </div>
      </div>

      {/* Teams + scores */}
      <div className="flex items-center justify-between gap-2 mb-3">
        {/* Thuis */}
        <div className="flex flex-col items-center flex-1 text-center gap-1">
          <img
            src={match.homeLogo}
            className="w-10 h-10 object-contain p-1 rounded-full bg-slate-800/50"
            alt=""
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                `https://ui-avatars.com/api/?name=${encodeURIComponent(match.homeTeamName[0])}&background=1e293b&color=60a5fa&size=40&bold=true`;
            }}
          />
          <span className="text-[10px] font-black text-white line-clamp-2 leading-tight">{match.homeTeamName}</span>
          {(prediction as any).homeForm && <FormBadge form={(prediction as any).homeForm} />}
          {(prediction as any).homeElo && (
            <span className="text-[7px] text-slate-500">Elo {(prediction as any).homeElo}</span>
          )}
        </div>

        {/* Score */}
        <div className="flex flex-col items-center justify-center min-w-[80px] gap-1">
          <div className="text-xl font-black tracking-tight">
            {hasResult
              ? <span className={isLiveMatch ? "text-red-300" : "text-white"}>{match.score}</span>
              : <span className="text-slate-600 text-base">vs</span>
            }
          </div>
          <div className="bg-blue-600 px-2.5 py-1 rounded-full flex flex-col items-center shadow-lg shadow-blue-600/20">
            <span className="text-white text-xs font-black">{prediction.predHomeGoals} - {prediction.predAwayGoals}</span>
            <span className="text-[6px] text-blue-200 font-bold uppercase -mt-0.5">AI tip</span>
          </div>
          <span className="text-[8px] text-yellow-400 font-bold">{favoriteTip}</span>
        </div>

        {/* Uit */}
        <div className="flex flex-col items-center flex-1 text-center gap-1">
          <img
            src={match.awayLogo}
            className="w-10 h-10 object-contain p-1 rounded-full bg-slate-800/50"
            alt=""
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                `https://ui-avatars.com/api/?name=${encodeURIComponent(match.awayTeamName[0])}&background=1e293b&color=60a5fa&size=40&bold=true`;
            }}
          />
          <span className="text-[10px] font-black text-white line-clamp-2 leading-tight">{match.awayTeamName}</span>
          {(prediction as any).awayForm && <FormBadge form={(prediction as any).awayForm} />}
          {(prediction as any).awayElo && (
            <span className="text-[7px] text-slate-500">Elo {(prediction as any).awayElo}</span>
          )}
        </div>
      </div>

      {/* Kansen balk */}
      <div className="flex h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
        <div className="bg-green-500 h-full transition-all duration-500" style={{ width: `${prediction.homeProb * 100}%` }}></div>
        <div className="bg-slate-500 h-full transition-all duration-500" style={{ width: `${prediction.drawProb * 100}%` }}></div>
        <div className="bg-red-500 h-full transition-all duration-500" style={{ width: `${prediction.awayProb * 100}%` }}></div>
      </div>

      {/* Kansen % + noteringen */}
      <div className="grid grid-cols-3 gap-1 text-center mb-3">
        <div>
          <div className="text-[7px] font-black text-green-400 uppercase">Thuis</div>
          <div className="text-[11px] font-black text-white">{(prediction.homeProb * 100).toFixed(0)}%</div>
          <div className="text-[10px] font-bold text-yellow-400 bg-yellow-900/10 rounded px-1">{homeOdds}</div>
        </div>
        <div>
          <div className="text-[7px] font-black text-slate-400 uppercase">Gelijk</div>
          <div className="text-[11px] font-black text-white">{(prediction.drawProb * 100).toFixed(0)}%</div>
          <div className="text-[10px] font-bold text-yellow-400 bg-yellow-900/10 rounded px-1">{drawOdds}</div>
        </div>
        <div>
          <div className="text-[7px] font-black text-red-400 uppercase">Uit</div>
          <div className="text-[11px] font-black text-white">{(prediction.awayProb * 100).toFixed(0)}%</div>
          <div className="text-[10px] font-bold text-yellow-400 bg-yellow-900/10 rounded px-1">{awayOdds}</div>
        </div>
      </div>

      {/* Details toggle */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full py-1.5 flex items-center justify-center gap-1.5 text-[9px] font-black text-slate-500 hover:text-slate-300 transition border-t border-white/5"
      >
        {showDetails ? '▲ INKLAPPEN' : '▼ DETAILS & ANALYSE'}
      </button>

      {showDetails && (
        <div className="mt-3 space-y-2">
          {/* xG + Elo */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-900/80 rounded-xl p-2.5 border border-white/5">
              <div className="text-[7px] text-slate-500 font-bold uppercase mb-1">Verwachte doelpunten (xG)</div>
              <div className="flex justify-between">
                <div className="text-center">
                  <div className="text-[8px] text-slate-400">{match.homeTeamName.split(' ')[0]}</div>
                  <div className="text-sm font-black text-blue-400">{prediction.homeXG?.toFixed(2)}</div>
                </div>
                <div className="text-slate-600 font-black">vs</div>
                <div className="text-center">
                  <div className="text-[8px] text-slate-400">{match.awayTeamName.split(' ')[0]}</div>
                  <div className="text-sm font-black text-blue-400">{prediction.awayXG?.toFixed(2)}</div>
                </div>
              </div>
            </div>
            <div className="bg-slate-900/80 rounded-xl p-2.5 border border-white/5">
              <div className="text-[7px] text-slate-500 font-bold uppercase mb-1">Elo sterkte</div>
              <div className="flex justify-between">
                <div className="text-center">
                  <div className="text-[8px] text-slate-400">{match.homeTeamName.split(' ')[0]}</div>
                  <div className="text-sm font-black text-purple-400">{(prediction as any).homeElo || '~'}</div>
                </div>
                <div className="text-slate-600 font-black">vs</div>
                <div className="text-center">
                  <div className="text-[8px] text-slate-400">{match.awayTeamName.split(' ')[0]}</div>
                  <div className="text-sm font-black text-purple-400">{(prediction as any).awayElo || '~'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Vorm */}
          {((prediction as any).homeForm || (prediction as any).awayForm) && (
            <div className="bg-slate-900/80 rounded-xl p-2.5 border border-white/5">
              <div className="text-[7px] text-slate-500 font-bold uppercase mb-2">Recente vorm (laatste 5)</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[8px] text-slate-400 mb-1">{match.homeTeamName}</div>
                  <FormBadge form={(prediction as any).homeForm || ''} />
                </div>
                <div>
                  <div className="text-[8px] text-slate-400 mb-1">{match.awayTeamName}</div>
                  <FormBadge form={(prediction as any).awayForm || ''} />
                </div>
              </div>
            </div>
          )}

          {/* AI analyse */}
          <div className="bg-blue-600/10 border border-blue-500/20 rounded-xl p-2.5">
            <div className="text-[7px] font-black text-blue-400 uppercase mb-1">AI Analyse</div>
            <p className="text-[9px] text-blue-100/80 leading-relaxed">
              {prediction.analysis ||
                `${match.homeTeamName} (Elo: ${(prediction as any).homeElo || '~'}) vs ${match.awayTeamName} (Elo: ${(prediction as any).awayElo || '~'}). ` +
                `Verwachte doelpunten: ${prediction.homeXG?.toFixed(1)}-${prediction.awayXG?.toFixed(1)}. ` +
                `AI voorspelt ${prediction.predHomeGoals}-${prediction.predAwayGoals} ` +
                `met ${(prediction.confidence * 100).toFixed(0)}% zekerheid.`
              }
            </p>
          </div>

          {/* Confidence meter */}
          <div className="flex items-center gap-2 px-1">
            <span className="text-[8px] text-slate-500 font-bold w-16">Zekerheid</span>
            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${prediction.confidence > 0.6 ? 'bg-green-500' : prediction.confidence > 0.3 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${prediction.confidence * 100}%` }}></div>
            </div>
            <span className="text-[9px] font-black text-slate-300">{(prediction.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default MatchCard;
