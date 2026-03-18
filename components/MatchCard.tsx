import React, { useEffect, useMemo, useRef, useState } from "react";
import { Match } from "../types";
import { FavoriteButton } from "./FavoriteTeams";

interface MatchCardProps {
  match: Match;
  prediction?: any;
  onFavoriteChange?: () => void;
}

function parseMinuteValue(minute?: string | number | null, minuteValue?: number | null) {
  if (typeof minuteValue === "number" && Number.isFinite(minuteValue)) return minuteValue;
  if (typeof minute === "number" && Number.isFinite(minute)) return minute;
  if (!minute) return null;
  if (String(minute).toUpperCase() === "HT") return 45;
  const plusMatch = String(minute).match(/(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) return Number(plusMatch[1]) + Number(plusMatch[2]);
  const plainMatch = String(minute).match(/(\d+)/);
  return plainMatch ? Number(plainMatch[1]) : null;
}

function useLiveMinute(match: any) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (String(match?.status || "").toUpperCase() !== "LIVE" && !match?.minute && !match?.minuteValue) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [match?.status, match?.minute, match?.minuteValue, match?.liveUpdatedAt]);

  return useMemo(() => {
    const period = String(match?.period || "").toLowerCase();
    if (period.includes("half time") || period.includes("halftime") || period.includes("break")) return "HT";
    const base = parseMinuteValue(match?.minute, match?.minuteValue);
    if (base == null) return null;
    const updatedAt = Number(match?.liveUpdatedAt || 0) || 0;
    const drift = updatedAt > 0 ? Math.max(0, Math.floor((now - updatedAt) / 60000)) : 0;
    const total = base + drift;
    return total > 90 ? `90+${total - 90}'` : `${total}'`;
  }, [match, now]);
}

function fmt(probability: number) {
  return probability > 0.01 ? (1 / probability).toFixed(2) : "-";
}

function Badge({ label, value, tone = "slate" }: { label: string; value: string; tone?: string }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-800/70 text-slate-200 border-slate-700/40",
    blue: "bg-blue-900/30 text-blue-300 border-blue-500/20",
    green: "bg-green-900/30 text-green-300 border-green-500/20",
    amber: "bg-amber-900/30 text-amber-300 border-amber-500/20",
    red: "bg-red-900/30 text-red-300 border-red-500/20",
  };
  return (
    <div className={`rounded-lg border px-2 py-1 ${tones[tone] || tones.slate}`}>
      <div className="text-[7px] uppercase opacity-70">{label}</div>
      <div className="text-[9px] font-black">{value}</div>
    </div>
  );
}

const MatchCard: React.FC<MatchCardProps> = ({ match, prediction, onFavoriteChange }) => {
  const [tab, setTab] = useState<"analyse" | "h2h" | "markten" | "stats">("analyse");
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const triedRef = useRef(false);
  const liveMinute = useLiveMinute(match as any);

  useEffect(() => {
    if (triedRef.current || !prediction) return;
    triedRef.current = true;
    setAiLoading(true);
    fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match, prediction }),
    })
      .then((r) => r.json())
      .then((d) => { if (d.analysis) setAiAnalysis(d.analysis); })
      .catch(() => {})
      .finally(() => setAiLoading(false));
  }, [match, prediction]);

  if (!prediction) {
    return <div className="glass-card rounded-2xl p-4 border border-white/5 animate-pulse h-64" />;
  }

  const isLive = String(match.status || "").toUpperCase() === "LIVE" || !!liveMinute;
  const isFinished = String(match.status || "").toUpperCase() === "FT";
  const weather = (match as any).weather || prediction.weather;
  const lineupSummary = (match as any).lineupSummary || prediction.lineupSummary;
  const h2h = (match as any).h2h || prediction.h2h;
  const topScores = Object.entries(prediction.scoreMatrix || {}).sort((a: any, b: any) => b[1] - a[1]).slice(0, 4);
  const borderClass = isLive ? "border-red-500/50 bg-red-950/20" : isFinished ? "border-slate-600/30 bg-slate-900/20" : "border-slate-700/30";

  return (
    <div className={`glass-card rounded-2xl p-3 border ${borderClass} transition-all`}>
      <div className="flex justify-between items-center mb-2 gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[8px] font-black text-blue-400 uppercase truncate">{match.league}</div>
          <div className="text-[8px] text-slate-500">{match.kickoff ? new Date(match.kickoff).toLocaleString("nl-NL") : ""}</div>
        </div>
        <div className="flex items-center gap-1">
          {liveMinute && <span className="bg-red-600/90 text-white text-[9px] font-black px-1.5 py-0.5 rounded">{liveMinute}</span>}
          <FavoriteButton teamId={match.homeTeamId || ""} teamName={match.homeTeamName} onChange={onFavoriteChange} />
          <FavoriteButton teamId={match.awayTeamId || ""} teamName={match.awayTeamName} onChange={onFavoriteChange} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex-1 text-center">
          <div className="text-[10px] font-black text-white">{match.homeTeamName}</div>
          <div className="text-[7px] text-slate-500">vorm {match.homeForm || "-"}</div>
        </div>
        <div className="min-w-[80px] text-center">
          <div className="text-xl font-black text-white">{match.score || "vs"}</div>
          <div className="bg-blue-600 px-2 py-0.5 rounded-full text-[10px] font-black text-white">
            {prediction.predHomeGoals}-{prediction.predAwayGoals}
          </div>
        </div>
        <div className="flex-1 text-center">
          <div className="text-[10px] font-black text-white">{match.awayTeamName}</div>
          <div className="text-[7px] text-slate-500">vorm {match.awayForm || "-"}</div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 mb-2">
        <Badge label="Rust" value={match.homeRestDays != null && match.awayRestDays != null ? `${match.homeRestDays}d / ${match.awayRestDays}d` : "?"} tone="blue" />
        <Badge label="Weer" value={weather ? `${weather.temperature ?? "?"}C` : "?"} tone={weather?.riskLevel === "medium" ? "amber" : "slate"} />
        <Badge label="Lineups" value={lineupSummary?.confirmed ? "Bevestigd" : "Open"} tone={lineupSummary?.confirmed ? "green" : "slate"} />
        <Badge label="H2H" value={h2h?.played ? `${h2h.homeWins}-${h2h.draws}-${h2h.awayWins}` : "-"} tone="slate" />
      </div>

      <div className="grid grid-cols-3 gap-1 mb-2">
        {[
          { label: "1", p: prediction.homeProb || 0, odds: fmt(prediction.homeProb || 0), c: "text-green-400" },
          { label: "X", p: prediction.drawProb || 0, odds: fmt(prediction.drawProb || 0), c: "text-slate-400" },
          { label: "2", p: prediction.awayProb || 0, odds: fmt(prediction.awayProb || 0), c: "text-red-400" },
        ].map(({ label, p, odds, c }) => (
          <div key={label} className="bg-slate-900/60 rounded-lg p-1.5 text-center">
            <div className={`text-[7px] font-black ${c}`}>{label}</div>
            <div className="text-[11px] font-black text-white">{(p * 100).toFixed(0)}%</div>
            <div className="text-[9px] text-yellow-400 font-bold">{odds}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-0.5 mb-2 pt-1 border-t border-white/5">
        {[
          { key: "analyse", label: "AI" },
          { key: "h2h", label: "H2H" },
          { key: "markten", label: "Markt" },
          { key: "stats", label: "Stats" },
        ].map((item) => (
          <button key={item.key} onClick={() => setTab(item.key as any)} className={`py-1 rounded-lg text-[8px] font-black transition ${tab === item.key ? "bg-blue-600 text-white" : "bg-slate-800/60 text-slate-400 hover:text-white"}`}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === "analyse" && (
        <div className="space-y-2">
          <div className="bg-gradient-to-br from-blue-950/60 to-purple-950/40 border border-blue-500/20 rounded-xl p-2.5 min-h-[60px]">
            <div className="text-[7px] font-black text-blue-400 uppercase mb-1.5">AI Analyse</div>
            {aiAnalysis ? <p className="text-[9px] text-blue-100/90 leading-relaxed">{aiAnalysis}</p> : <p className="text-[9px] text-slate-500">{aiLoading ? "Analyse laden..." : "Nog geen analyse."}</p>}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Badge label="xG thuis" value={(prediction.homeXG || 0).toFixed(2)} tone="blue" />
            <Badge label="xG uit" value={(prediction.awayXG || 0).toFixed(2)} tone="red" />
          </div>
        </div>
      )}

      {tab === "h2h" && (
        <div className="space-y-1">
          {h2h?.results?.length ? h2h.results.slice(-5).reverse().map((r: any, i: number) => (
            <div key={i} className="flex items-center justify-between text-[9px] py-0.5 border-b border-white/5 last:border-0">
              <span className="text-slate-300 truncate max-w-[90px]">{r.home}</span>
              <span className="font-black text-white mx-1 bg-slate-800 px-1.5 py-0.5 rounded">{r.score}</span>
              <span className="text-slate-300 truncate max-w-[90px] text-right">{r.away}</span>
            </div>
          )) : <div className="text-center py-4 text-slate-500 text-[10px]">H2H nog niet beschikbaar</div>}
        </div>
      )}

      {tab === "markten" && (
        <div className="space-y-2">
          <Badge label="Over 2.5" value={`${((prediction.over25 || 0) * 100).toFixed(0)}%`} tone="blue" />
          <Badge label="BTTS" value={`${((prediction.btts || 0) * 100).toFixed(0)}%`} tone="green" />
        </div>
      )}

      {tab === "stats" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <Badge label="Thuis split" value={match.homeRecent?.splits?.home ? `${match.homeRecent.splits.home.avgScored}-${match.homeRecent.splits.home.avgConceded}` : "-"} tone="blue" />
            <Badge label="Uit split" value={match.awayRecent?.splits?.away ? `${match.awayRecent.splits.away.avgScored}-${match.awayRecent.splits.away.avgConceded}` : "-"} tone="red" />
          </div>
          {topScores.length > 0 && (
            <div className="bg-slate-900/60 rounded-xl p-2">
              <div className="text-[7px] text-slate-500 uppercase mb-1.5">Score matrix</div>
              <div className="flex flex-wrap gap-1">
                {topScores.map(([score, prob]: any) => (
                  <div key={score} className="px-2 py-0.5 rounded-lg text-[9px] font-black bg-slate-800 text-slate-300">
                    {score} <span className="opacity-60">{(prob * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MatchCard;
