import React from "react";
import { Match } from "../types";
import { isMatchFinished, isMatchLive } from "../shared/matchStatus.js";

interface CompactMatchRowProps {
  match: Match;
  prediction?: any;
  expanded?: boolean;
  onToggle: () => void;
}

function formatKickoff(match: Match) {
  const raw = match.kickoff || match.date;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "--:--";
  return parsed.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

function pct(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "0%";
  return `${Math.round(number * 100)}%`;
}

function sourcePct(match: Match) {
  const coverage = match.freeSourceCoverage || match.sourceCoverage;
  const value = Number(coverage?.percent ?? coverage?.score ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value <= 1 ? Math.round(value * 100) : Math.round(value);
}

const CompactMatchRow: React.FC<CompactMatchRowProps> = ({ match, prediction, expanded, onToggle }) => {
  const live = isMatchLive(match);
  const finished = isMatchFinished(match);
  const predictedScore = prediction ? `${prediction.predHomeGoals ?? 0}-${prediction.predAwayGoals ?? 0}` : "-";
  const confidence = Number(prediction?.confidence || Math.max(prediction?.homeProb || 0, prediction?.drawProb || 0, prediction?.awayProb || 0));
  const exactConfidence = Number(prediction?.exactScoreConfidence || prediction?.exactProb || 0);
  const lineupConfirmed = Boolean(match.lineupSummary?.confirmed || prediction?.lineupSummary?.confirmed);
  const hasOdds = Boolean(prediction?.odds || prediction?.oddsAtPrediction || match.dbFeatureContext?.historicalOdds?.samples);
  const h2hPlayed = Number(match.h2h?.played || prediction?.h2h?.played || 0);
  const coverage = sourcePct(match);

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
        expanded
          ? "border-cyan-400/45 bg-cyan-500/10"
          : "border-white/10 bg-slate-950/45 hover:border-cyan-400/25 hover:bg-slate-900/70"
      }`}
    >
      <div className="grid grid-cols-[54px_minmax(0,1fr)_74px_92px] items-center gap-3 md:grid-cols-[66px_minmax(0,1fr)_90px_110px_110px]">
        <div className="text-center">
          <div className={`text-xs font-black ${live ? "text-red-300" : finished ? "text-slate-300" : "text-blue-200"}`}>
            {live ? match.minute || "LIVE" : finished ? "FT" : formatKickoff(match)}
          </div>
          <div className="mt-1 text-[8px] font-black uppercase text-slate-500">{match.status || "NS"}</div>
        </div>

        <div className="min-w-0">
          <div className="mb-1 truncate text-[10px] font-black uppercase tracking-wide text-slate-500">{match.league}</div>
          <div className="grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] items-center gap-2">
            <div className="flex min-w-0 items-center justify-end gap-2">
              {match.homeLogo && <img src={match.homeLogo} alt="" className="h-5 w-5 rounded-full object-contain" />}
              <span className="truncate text-sm font-black text-white">{match.homeTeamName}</span>
            </div>
            <div className="text-center text-[10px] font-black text-slate-500">vs</div>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-black text-white">{match.awayTeamName}</span>
              {match.awayLogo && <img src={match.awayLogo} alt="" className="h-5 w-5 rounded-full object-contain" />}
            </div>
          </div>
        </div>

        <div className="text-center">
          <div className="text-[8px] font-black uppercase text-slate-500">Voorspeld</div>
          <div className="text-2xl font-black text-yellow-300">{predictedScore}</div>
          {finished && <div className="text-[9px] font-bold text-slate-400">uitslag {match.score || "-"}</div>}
        </div>

        <div className="hidden text-center md:block">
          <div className="text-[8px] font-black uppercase text-slate-500">Zekerheid</div>
          <div className="text-sm font-black text-cyan-200">{pct(confidence)}</div>
          <div className="text-[9px] text-slate-500">exact {pct(exactConfidence)}</div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[8px] font-black ${lineupConfirmed ? "bg-green-500/15 text-green-300" : "bg-slate-700/70 text-slate-300"}`}>
            {lineupConfirmed ? "opstelling" : "lineup open"}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[8px] font-black ${hasOdds ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700/70 text-slate-300"}`}>
            {hasOdds ? "odds" : "geen odds"}
          </span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[8px] font-black text-slate-300">
            H2H {h2hPlayed} · bron {coverage}%
          </span>
        </div>
      </div>
    </button>
  );
};

export default CompactMatchRow;
