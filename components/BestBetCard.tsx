
import React from 'react';
import { BestBet } from '../types';

interface BestBetCardProps {
  bet: BestBet;
}

const BestBetCard: React.FC<BestBetCardProps> = ({ bet }) => {
  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-yellow-500/20 rounded-2xl p-4 shadow-xl hover:border-yellow-500/50 transition-all group">
      <div className="flex justify-between items-start mb-2">
        <span className="text-[8px] font-black text-yellow-500 uppercase tracking-widest">{bet.league}</span>
        <div className="w-6 h-6 rounded-full bg-yellow-500/10 flex items-center justify-center">
          <i className="fas fa-star text-yellow-500 text-[8px]"></i>
        </div>
      </div>
      
      <div className="text-center mb-3">
        <div className="text-[10px] font-bold text-slate-400 line-clamp-1 mb-1">{bet.homeTeam} v {bet.awayTeam}</div>
        <div className="text-2xl font-black text-white tracking-tighter">{bet.predHomeGoals}-{bet.predAwayGoals}</div>
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
        <div className="flex flex-col">
          <span className="text-[7px] text-slate-500 font-bold uppercase">Confidence</span>
          <span className="text-xs font-black text-blue-400">{(bet.confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="w-8 h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-yellow-500" style={{ width: `${bet.confidence * 100}%` }}></div>
        </div>
      </div>
    </div>
  );
};

export default BestBetCard;
