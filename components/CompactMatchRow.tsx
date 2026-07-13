import React from "react";
import { Match } from "../types";
import { isMatchFinished, isMatchLive } from "../shared/matchStatus.js";
import { isGeneratedLogoUrl } from "../shared/clubLogos.js";

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

function RowLogo({ logo, name }: { logo?: string; name: string }) {
  const [attempt, setAttempt] = React.useState(0);
  const directLogo = logo && !isGeneratedLogoUrl(logo) ? logo : null;
  const nameLogo = name ? `/api/logo?name=${encodeURIComponent(name)}` : null;
  const fallback = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#172033" stroke="#38bdf8" stroke-width="2"/><text x="24" y="30" text-anchor="middle" font-family="Arial" font-size="15" font-weight="800" fill="#e0f2fe">${String(name || "?").trim().slice(0, 2).toUpperCase()}</text></svg>`
  )}`;
  const sources = [directLogo, nameLogo, fallback].filter(Boolean) as string[];
  return (
    <img
      src={sources[Math.min(attempt, sources.length - 1)]}
      alt=""
      referrerPolicy="no-referrer"
      crossOrigin="anonymous"
      className="h-5 w-5 shrink-0 rounded-full bg-slate-900/60 object-contain p-0.5"
      onError={() => setAttempt((value) => Math.min(value + 1, sources.length - 1))}
    />
  );
}

const CompactMatchRow: React.FC<CompactMatchRowProps> = ({ match, prediction, expanded, onToggle }) => {
  const live = isMatchLive(match);
  const finished = isMatchFinished(match);
  const predictedScore = prediction ? `${prediction.predHomeGoals ?? 0}-${prediction.predAwayGoals ?? 0}` : "-";
  const confidence = Number(prediction?.confidence || Math.max(prediction?.homeProb || 0, prediction?.drawProb || 0, prediction?.awayProb || 0));
  const exactProbability = Number(prediction?.exactProb || 0);
  const lineupConfirmed = Boolean((match as any).lineupConfirmed || match.lineupSummary?.confirmed || prediction?.lineupSummary?.confirmed);
  const hasOdds = Boolean((match as any).hasOdds || prediction?.odds || prediction?.oddsAtPrediction || match.dbFeatureContext?.historicalOdds?.samples);
  const h2hPlayed = Number((match as any).h2hPlayed || match.h2h?.played || prediction?.h2h?.played || 0);
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
              <RowLogo logo={match.homeLogo} name={match.homeTeamName} />
              <span className="truncate text-sm font-black text-white">{match.homeTeamName}</span>
            </div>
            <div className="text-center text-[10px] font-black text-slate-500">vs</div>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-black text-white">{match.awayTeamName}</span>
              <RowLogo logo={match.awayLogo} name={match.awayTeamName} />
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
          <div className="text-[9px] text-slate-500">exact {pct(exactProbability)}</div>
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
