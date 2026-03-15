import React, { useState } from 'react';
import { Match, Prediction } from '../types';

interface MatchCardProps {
  match: Match;
  prediction?: Prediction;
}

const MatchCard: React.FC<MatchCardProps> = ({ match, prediction }) => {
  const [showDetails, setShowDetails] = useState(false);

  if (!prediction) {
    // Toon skeleton card terwijl voorspelling laadt
    return (
      <div className="glass-card rounded-2xl p-4 border border-white/5 animate-pulse">
        <div className="h-3 bg-slate-800 rounded w-1/2 mb-4"></div>
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex-1 flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-slate-800 rounded-full"></div>
            <div className="h-2 bg-slate-800 rounded w-16"></div>
          </div>
          <div className="w-16 h-8 bg-slate-800 rounded"></div>
          <div className="flex-1 flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-slate-800 rounded-full"></div>
            <div className="h-2 bg-slate-800 rounded w-16"></div>
          </div>
        </div>
      </div>
    );
  }

  const isFinished = match.status === 'FT' || match.status?.toLowerCase().includes('finish');
  const isLive = match.status === 'LIVE' || match.status?.toLowerCase().includes('live') || !!match.minute;
  const hasResult = !!match.score && match.score !== "" && match.score !== "v";
  const predictedScore = `${prediction.predHomeGoals}-${prediction.predAwayGoals}`;
  const isCorrect = isFinished && hasResult && match.score?.trim() === predictedScore.trim();

  // Kickoff tijd
  const kickoffTime = match.kickoff
    ? new Date(match.kickoff).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    : null;

  const statusTone = isCorrect
    ? 'border-green-400/60 bg-green-900/15'
    : isLive ? 'border-red-500/40 bg-red-900/10'
    : isFinished ? 'border-slate-500/30 bg-slate-900/40'
    : 'border-blue-500/25 bg-blue-900/10';

  // Odds berekend vanuit kansen (gesimuleerd als echte odds niet beschikbaar)
  const homeOdds = prediction.homeProb > 0.01 ? (1 / prediction.homeProb).toFixed(2) : '-';
  const drawOdds = prediction.drawProb > 0.01 ? (1 / prediction.drawProb).toFixed(2) : '-';
  const awayOdds = prediction.awayProb > 0.01 ? (1 / prediction.awayProb).toFixed(2) : '-';

  return (
    <div className={`glass-card rounded-2xl p-4 transition-all duration-300 border shadow-xl ${statusTone}`}>
      {/* Header */}
      <div className="flex justify-between items-center mb-3">
        <span className="text-[9px] font-black text-blue-400 uppercase tracking-tighter truncate max-w-[60%]">
          {match.league?.split(' — ')[1] || match.league}
        </span>
        <div className="flex items-center gap-1.5">
          {isCorrect && (
            <span className="bg-green-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded">✓ CORRECT</span>
          )}
          {isLive && (
            <span className="flex items-center gap-1 bg-red-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded animate-pulse">
              ● LIVE {match.minute}
            </span>
          )}
          {!isLive && kickoffTime && !isFinished && (
            <span className="text-[9px] font-black text-slate-400">🕐 {kickoffTime}</span>
          )}
          {isFinished && (
            <span className="bg-slate-700 text-slate-300 text-[8px] font-black px-1.5 py-0.5 rounded">FT</span>
          )}
        </div>
      </div>

      {/* Teams + Score */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex flex-col items-center flex-1 text-center">
          <img
            src={match.homeLogo}
            className="w-10 h-10 object-contain mb-1 p-1 rounded-full bg-slate-800/50"
            alt=""
            onError={(e) => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(match.homeTeamName)}&background=1e293b&color=fff&size=40`; }}
          />
          <span className="text-[10px] font-black text-white line-clamp-2 leading-tight">{match.homeTeamName}</span>
        </div>

        <div className="flex flex-col items-center justify-center min-w-[90px]">
          {/* Live/eindstand */}
          <div className="text-2xl font-black text-white tracking-tight mb-1">
            {hasResult ? (
              <span className={isLive ? "text-red-300" : ""}>{match.score}</span>
            ) : (
              <span className="text-slate-600 text-base">vs</span>
            )}
          </div>
          {/* AI Voorspelling */}
          <div className="bg-blue-600 shadow-lg shadow-blue-600/20 px-2.5 py-1 rounded-full flex flex-col items-center">
            <span className="text-white text-xs font-black">{prediction.predHomeGoals} - {prediction.predAwayGoals}</span>
            <span className="text-[7px] text-blue-100 font-bold uppercase -mt-0.5">AI tip</span>
          </div>
        </div>

        <div className="flex flex-col items-center flex-1 text-center">
          <img
            src={match.awayLogo}
            className="w-10 h-10 object-contain mb-1 p-1 rounded-full bg-slate-800/50"
            alt=""
            onError={(e) => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(match.awayTeamName)}&background=1e293b&color=fff&size=40`; }}
          />
          <span className="text-[10px] font-black text-white line-clamp-2 leading-tight">{match.awayTeamName}</span>
        </div>
      </div>

      {/* Kansen balk */}
      <div className="flex h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
        <div className="bg-green-500 h-full transition-all" style={{ width: `${prediction.homeProb * 100}%` }}></div>
        <div className="bg-slate-600 h-full transition-all" style={{ width: `${prediction.drawProb * 100}%` }}></div>
        <div className="bg-red-500 h-full transition-all" style={{ width: `${prediction.awayProb * 100}%` }}></div>
      </div>

      {/* Kansen % + Noteringen */}
      <div className="grid grid-cols-3 gap-1 text-center mb-3">
        <div>
          <div className="text-[8px] font-black text-green-400 uppercase">Thuis</div>
          <div className="text-[10px] font-black text-white">{(prediction.homeProb * 100).toFixed(0)}%</div>
          <div className="text-[9px] font-bold text-yellow-400">{homeOdds}</div>
        </div>
        <div>
          <div className="text-[8px] font-black text-slate-400 uppercase">Gelijk</div>
          <div className="text-[10px] font-black text-white">{(prediction.drawProb * 100).toFixed(0)}%</div>
          <div className="text-[9px] font-bold text-yellow-400">{drawOdds}</div>
        </div>
        <div>
          <div className="text-[8px] font-black text-red-400 uppercase">Uit</div>
          <div className="text-[10px] font-black text-white">{(prediction.awayProb * 100).toFixed(0)}%</div>
          <div className="text-[9px] font-bold text-yellow-400">{awayOdds}</div>
        </div>
      </div>

      {/* Details toggle */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full py-1.5 flex items-center justify-center gap-2 text-[9px] font-black text-slate-500 hover:text-white transition border-t border-white/5"
      >
        <i className={`fas fa-microchip ${showDetails ? 'text-blue-500' : ''}`}></i>
        {showDetails ? 'INKLAPPEN' : 'DETAILS'}
        <i className={`fas fa-chevron-${showDetails ? 'up' : 'down'} text-[7px]`}></i>
      </button>

      {showDetails && (
        <div className="mt-3 space-y-2 animate-in fade-in duration-200">
          {/* xG stats */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 bg-slate-900/80 rounded-lg border border-white/5 text-center">
              <div className="text-[7px] text-slate-500 font-bold uppercase">xG Thuis</div>
              <div className="text-sm font-black text-blue-400">{prediction.homeXG?.toFixed(2) || '-'}</div>
            </div>
            <div className="p-2 bg-slate-900/80 rounded-lg border border-white/5 text-center">
              <div className="text-[7px] text-slate-500 font-bold uppercase">xG Uit</div>
              <div className="text-sm font-black text-blue-400">{prediction.awayXG?.toFixed(2) || '-'}</div>
            </div>
          </div>

          {/* AI analyse */}
          <div className="p-2.5 bg-blue-600/10 border border-blue-500/20 rounded-lg">
            <div className="text-[7px] font-black text-blue-400 uppercase mb-1">AI Analyse</div>
            <p className="text-[9px] text-blue-100/80 leading-relaxed">
              {prediction.analysis || `AI voorspelt ${prediction.predHomeGoals}-${prediction.predAwayGoals}. Confidence: ${(prediction.confidence * 100).toFixed(0)}%. Berekend op basis van Elo ratings en Poisson model.`}
            </p>
          </div>

          {/* Confidence */}
          <div className="flex items-center justify-between px-1">
            <span className="text-[8px] text-slate-500 font-bold uppercase">Confidence</span>
            <div className="flex items-center gap-2">
              <div className="w-20 h-1 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${prediction.confidence * 100}%` }}></div>
              </div>
              <span className="text-[9px] font-black text-blue-400">{(prediction.confidence * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MatchCard;
