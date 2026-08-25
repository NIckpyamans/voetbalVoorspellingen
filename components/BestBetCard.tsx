import React from "react";
import { BestBet } from "../types";

interface BestBetCardProps {
  bet: BestBet & {
    status?: string;
    score?: string | null;
    bestBetRank?: number | null;
    exactScoreReasons?: string[];
    exactScoreConfidence?: number;
  };
}

const BestBetCard: React.FC<BestBetCardProps> = ({ bet }) => {
  const exactProbability = Number(bet.exactProb || 0);
  const selectionStrength = Number(bet.exactScoreConfidence || 0);
  const confidence = Number(bet.confidence || 0);
  const isFinished = String(bet.status || "").toUpperCase() === "FT";
  const scoreWasExact = isFinished && bet.score === `${bet.predHomeGoals}-${bet.predAwayGoals}`;
  const reasons = Array.isArray(bet.exactScoreReasons) ? bet.exactScoreReasons.slice(0, 2) : [];
  const readiness = bet.wagerReadiness;
  const missingStars = [
    ...(bet.lineupSummary?.starPlayerImpact?.home?.missing || []),
    ...(bet.lineupSummary?.starPlayerImpact?.away?.missing || []),
  ].slice(0, 2);
  const readinessStyle = readiness?.status === "eligible"
    ? "bg-green-500/15 text-green-300 border-green-400/20"
    : readiness?.status === "watch"
      ? "bg-amber-500/15 text-amber-200 border-amber-400/20"
      : "bg-slate-700/60 text-slate-300 border-white/10";

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 border border-yellow-500/25 rounded-2xl p-4 shadow-xl hover:border-yellow-400/60 transition-all group">
      <div className="absolute -right-8 -top-8 h-20 w-20 rounded-full bg-yellow-500/10 blur-xl" />
      <div className="relative flex justify-between items-start mb-2">
        <span className="text-[8px] font-black text-yellow-400 uppercase tracking-widest line-clamp-1">{bet.league}</span>
        <div className="flex items-center gap-1">
          {bet.bestBetRank && (
            <span className="rounded-full bg-yellow-500 text-slate-950 px-2 py-0.5 text-[9px] font-black">#{bet.bestBetRank}</span>
          )}
          <div className="w-6 h-6 rounded-full bg-yellow-500/10 flex items-center justify-center">
            <i className="fas fa-bullseye text-yellow-400 text-[8px]" />
          </div>
        </div>
      </div>

      <div className="relative text-center mb-3">
        <div className="text-[10px] font-bold text-slate-400 line-clamp-1 mb-1">{bet.homeTeam} v {bet.awayTeam}</div>
        <div className="text-2xl font-black text-white tracking-tighter">{bet.predHomeGoals}-{bet.predAwayGoals}</div>
        {isFinished && (
          <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[8px] font-black ${scoreWasExact ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300"}`}>
            Uitslag {bet.score || "-"} - {scoreWasExact ? "exact goed" : "niet exact"}
          </div>
        )}
      </div>

      <div className="relative grid grid-cols-3 gap-2 pt-2 border-t border-white/5">
        <div>
          <span className="text-[7px] text-slate-500 font-bold uppercase">Exact-score kans</span>
          <span className="block text-xs font-black text-yellow-300">{Math.round(exactProbability * 100)}%</span>
        </div>
        <div>
          <span className="text-[7px] text-slate-500 font-bold uppercase">Vertrouwen</span>
          <span className="block text-xs font-black text-blue-400">{Math.round(confidence * 100)}%</span>
        </div>
        <div>
          <span className="text-[7px] text-slate-500 font-bold uppercase">Selectiesterkte</span>
          <span className="block text-xs font-black text-emerald-300">{Math.round(selectionStrength * 100)}%</span>
        </div>
      </div>

      {readiness && (
        <div className="relative mt-2 space-y-1.5">
          <div className={`rounded-lg border px-2 py-1 text-[8px] font-black ${readinessStyle}`}>
            {readiness.label}
          </div>
          <div className="flex items-center justify-between text-[8px] font-bold text-slate-400">
            <span>1X2: <strong className="text-white">{readiness.recommendedOutcome}</strong></span>
            <span>model <strong className="text-blue-300">{Math.round(readiness.modelProbability * 100)}%</strong></span>
            <span>odd <strong className="text-yellow-200">{readiness.marketOdds?.toFixed(2) || "-"}</strong></span>
          </div>
          {readiness.blockers.length > 0 && (
            <div className="text-[8px] leading-snug text-slate-500 line-clamp-2" title={readiness.blockers.join("; ")}>
              Nog nodig: {readiness.blockers.slice(0, 2).join("; ")}
            </div>
          )}
        </div>
      )}

      {bet.lineupSummary?.confirmed && missingStars.length > 0 && (
        <div className="relative mt-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-2 py-1 text-[8px] font-bold text-rose-200">
          Sterspeler niet in wedstrijdselectie: {missingStars.map((player) => player.name).join(", ")}
        </div>
      )}

      {reasons.length > 0 && (
        <div className="relative mt-2 flex flex-wrap gap-1">
          {reasons.map((reason) => (
            <span key={reason} className="rounded-full bg-slate-700/70 px-2 py-0.5 text-[8px] font-bold text-slate-300">
              {reason}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default BestBetCard;
