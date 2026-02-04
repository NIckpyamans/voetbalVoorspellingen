
import React, { useState } from 'react';
import { Match, Prediction } from '../types';

interface MatchCardProps {
  match: Match;
  prediction?: Prediction;
}

const MatchCard: React.FC<MatchCardProps> = ({ match, prediction }) => {
  const [showDetails, setShowDetails] = useState(false);

  if (!prediction) return null;

  const isFinished = match.status?.toLowerCase().includes('finish') || match.status?.toLowerCase().includes('end') || match.status?.toLowerCase().includes('ft');
  const isLive = match.status?.toLowerCase().includes('live') || !!match.minute;
  const hasResult = !!match.score && match.score !== "" && match.score !== "v";

  const predictedScore = `${prediction.predHomeGoals}-${prediction.predAwayGoals}`;
  const isCorrect = isFinished && hasResult && match.score?.trim() === predictedScore.trim();

  const statusTone = isCorrect
    ? 'border-green-400/60 bg-green-900/15'
    : isLive
      ? 'border-red-500/40 bg-red-900/10'
      : isFinished
        ? 'border-slate-500/30 bg-slate-900/40'
        : 'border-blue-500/25 bg-blue-900/10';

  // Safely get home and away lineup slices
  const homeLineup = match.lineups?.home || [];
  const awayLineup = match.lineups?.away || [];

  return (
    <div className={`glass-card rounded-2xl p-4 md:p-5 transition-all duration-300 relative border shadow-2xl ${statusTone}`}>
      {/* Header Info */}
      <div className="flex justify-between items-center mb-4">
        <span className="text-[10px] font-black text-blue-400 uppercase tracking-tighter">{match.league}</span>
        <div className="flex items-center gap-2">
          {isCorrect && (
            <span className="flex items-center gap-1 bg-green-600 text-white text-[9px] font-black px-2 py-0.5 rounded">
              <i className="fas fa-check"></i> CORRECT
            </span>
          )}
          {isLive && (
            <span className="flex items-center gap-1 bg-red-600 text-white text-[9px] font-black px-2 py-0.5 rounded animate-pulse">
              <span className="w-1 h-1 bg-white rounded-full"></span> LIVE {match.minute}
            </span>
          )}
          <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${isFinished ? 'bg-slate-700 text-slate-300' : isLive ? 'bg-red-900/40 text-red-400' : 'bg-slate-800 text-slate-500'}`}>
            {match.status || 'Scheduled'}
          </span>
        </div>
      </div>

      {/* Main Score Comparison Area */}
      <div className="flex items-center justify-between gap-2 mb-6">
        {/* Home Team */}
        <div className="flex flex-col items-center flex-1 text-center group">
          <img src={match.homeLogo} className="w-12 h-12 md:w-16 md:h-16 object-contain mb-2 p-1 rounded-full bg-slate-800/50 border border-white/5 group-hover:scale-110 transition-transform" alt="" />
          <span className="text-[11px] md:text-sm font-black text-white line-clamp-1">{match.homeTeamName}</span>
        </div>

        {/* Scores Display */}
        <div className="flex flex-col items-center justify-center min-w-[110px]">
          {/* Actual Live Score */}
          <div className="text-3xl md:text-4xl font-black text-white tracking-tight mb-1 flex items-center gap-2">
            {hasResult ? match.score : <span className="text-slate-700">vs</span>}
            {isCorrect && (
              <span className="text-[10px] font-black text-green-300 bg-green-700/40 border border-green-400/30 px-2 py-1 rounded-full">
                ✅ Correct
              </span>
            )}
          </div>
          
          {/* AI Prediction Bubble */}
          <div className="bg-blue-600 shadow-lg shadow-blue-600/20 px-3 py-1 rounded-full flex flex-col items-center">
            <span className="text-white text-xs md:text-sm font-black">{prediction.predHomeGoals} - {prediction.predAwayGoals}</span>
            <span className="text-[7px] text-blue-100 font-bold uppercase -mt-0.5 tracking-widest">AI Tip</span>
          </div>
        </div>

        {/* Away Team */}
        <div className="flex flex-col items-center flex-1 text-center group">
          <img src={match.awayLogo} className="w-12 h-12 md:w-16 md:h-16 object-contain mb-2 p-1 rounded-full bg-slate-800/50 border border-white/5 group-hover:scale-110 transition-transform" alt="" />
          <span className="text-[11px] md:text-sm font-black text-white line-clamp-1">{match.awayTeamName}</span>
        </div>
      </div>

      {/* Win Probabilities Bar */}
      <div className="flex h-2 bg-slate-800 rounded-full overflow-hidden mb-5">
        <div className="bg-green-500 h-full" style={{ width: `${prediction.homeProb * 100}%` }}></div>
        <div className="bg-slate-600 h-full" style={{ width: `${prediction.drawProb * 100}%` }}></div>
        <div className="bg-red-500 h-full" style={{ width: `${prediction.awayProb * 100}%` }}></div>
      </div>

      {/* Probability Legend */}
      <div className="grid grid-cols-3 gap-1 text-[9px] font-black uppercase tracking-tighter mb-4 text-center">
        <div className="text-green-400">H: {(prediction.homeProb * 100).toFixed(0)}%</div>
        <div className="text-slate-400">D: {(prediction.drawProb * 100).toFixed(0)}%</div>
        <div className="text-red-400">A: {(prediction.awayProb * 100).toFixed(0)}%</div>
      </div>

      {/* Expand Button */}
      <button 
        onClick={() => setShowDetails(!showDetails)}
        className="w-full py-2 flex items-center justify-center gap-2 text-[10px] font-black text-slate-500 hover:text-white transition-colors border-t border-white/5"
      >
        <i className={`fas fa-microchip ${showDetails ? 'text-blue-500' : ''}`}></i>
        {showDetails ? 'BEKNOPT' : 'ANALYSE & LINEUPS'}
        <i className={`fas fa-chevron-${showDetails ? 'up' : 'down'} text-[8px]`}></i>
      </button>

      {showDetails && (
        <div className="mt-3 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
          {/* Detailed Info Cards (Injuries & Top Scorers) */}
          <div className="grid grid-cols-1 gap-2">
            {(match.keyInjuries || match.topScorers) && (
              <div className="grid grid-cols-2 gap-2">
                {match.keyInjuries && (
                  <div className="p-2 bg-red-900/10 rounded-lg border border-red-500/10">
                    <span className="text-[8px] text-red-400 font-black uppercase block mb-1 flex items-center gap-1">
                      <i className="fas fa-medkit"></i> Key Injuries
                    </span>
                    <p className="text-[9px] text-slate-300 leading-tight">{match.keyInjuries}</p>
                  </div>
                )}
                {match.topScorers && (
                  <div className="p-2 bg-yellow-900/10 rounded-lg border border-yellow-500/10">
                    <span className="text-[8px] text-yellow-500 font-black uppercase block mb-1 flex items-center gap-1">
                      <i className="fas fa-fire"></i> Top Scorers
                    </span>
                    <p className="text-[9px] text-slate-300 leading-tight">{match.topScorers}</p>
                  </div>
                )}
              </div>
            )}
            
            <div className="p-2 bg-slate-900/80 rounded-lg border border-white/5">
              <span className="text-[8px] text-slate-500 font-bold uppercase block mb-1">Forza Insight</span>
              <p className="text-[9px] text-slate-300 line-clamp-2">{match.context || 'Standard conditions'}</p>
            </div>
          </div>

          {/* Lineups */}
          {match.lineups && (
            <div className="p-3 bg-slate-900/80 rounded-lg border border-white/5">
              <span className="text-[8px] text-slate-500 font-bold uppercase block mb-2">Opstellingen</span>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-[9px] text-slate-400 leading-tight">
                  <span className="text-white font-bold block mb-1 uppercase tracking-tighter">Home XI</span>
                  {homeLineup.length > 0 ? `${homeLineup.slice(0, 4).join(', ')}...` : 'Nog onbekend'}
                </div>
                <div className="text-[9px] text-slate-400 leading-tight">
                  <span className="text-white font-bold block mb-1 uppercase tracking-tighter">Away XI</span>
                  {awayLineup.length > 0 ? `${awayLineup.slice(0, 4).join(', ')}...` : 'Nog onbekend'}
                </div>
              </div>
            </div>
          )}

          {/* AI Reasoning */}
          <div className="p-3 bg-blue-600/10 border border-blue-500/20 rounded-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 p-1 opacity-20">
              <i className="fas fa-robot text-2xl"></i>
            </div>
            <span className="text-[8px] font-black text-blue-400 uppercase block mb-1">Strategische Analyse</span>
            <p className="text-[10px] text-blue-100/90 leading-relaxed italic">{prediction.analysis}</p>
          </div>
        </div>
      )}

      {/* Footer Info */}
      <div className="mt-4 pt-3 border-t border-white/5 flex justify-between items-center">
        <div className="flex items-center gap-2">
           <i className="fas fa-shield-halved text-blue-500 text-[10px]"></i>
           <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Confidence: {(prediction.confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="text-[10px] font-black text-blue-400 uppercase tracking-tighter">
          Match ID: #{match.id ? match.id.slice(-4) : 'N/A'}
        </div>
      </div>
    </div>
  );
};

export default MatchCard;
