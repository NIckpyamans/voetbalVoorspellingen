import React, { useEffect, useMemo, useState } from "react";
import { Match } from "../types";

interface LivePanelProps {
  open: boolean;
  onClose: () => void;
  liveMatches: Match[];
  onJumpToLeague: (league: string) => void;
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

function getLiveMinuteLabel(match: any, now: number) {
  const period = String(match?.period || "").toLowerCase();
  if (period.includes("half time") || period.includes("halftime") || period.includes("break")) return "HT";
  const base = parseMinuteValue(match?.minute, match?.minuteValue);
  if (base == null) return "LIVE";
  const updatedAt = Number(match?.liveUpdatedAt || 0) || 0;
  const drift = updatedAt > 0 ? Math.max(0, Math.floor((now - updatedAt) / 60000)) : 0;
  const total = base + drift;
  if (total > 90) return `90+${total - 90}'`;
  return `${total}'`;
}

const LivePanel: React.FC<LivePanelProps> = ({ open, onClose, liveMatches, onJumpToLeague }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [open]);

  const entries = useMemo(() => {
    const grouped = liveMatches.reduce((acc: Record<string, Match[]>, match) => {
      const key = match.league || "Unknown";
      acc[key] = acc[key] || [];
      acc[key].push(match);
      return acc;
    }, {});
    return Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0])) as [string, Match[]][];
  }, [liveMatches]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="z-70 max-w-5xl w-full bg-[#071023] border border-white/5 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black text-white">Live wedstrijden</h3>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-white px-3 py-1 rounded">
            Sluiten
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="text-slate-500">Geen live wedstrijden momenteel.</div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-auto pr-2">
            {entries.map(([league, matches]) => (
              <div key={league} className="border-b border-white/5 pb-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold text-sm text-white">{league}</div>
                  <button onClick={() => onJumpToLeague(league)} className="text-xs text-blue-400 hover:underline">
                    Ga naar competitie
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {matches.map((match: any) => (
                    <div key={match.id} className="glass-card p-3 rounded-lg border border-white/5 flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-black text-white truncate">
                          {match.homeTeamName} vs {match.awayTeamName}
                        </div>
                        <div className="text-[11px] text-slate-400 flex gap-2">
                          <span>{getLiveMinuteLabel(match, now)}</span>
                          {match.weather?.riskLevel && match.weather.riskLevel !== "low" && <span>weer: {match.weather.riskLevel}</span>}
                        </div>
                      </div>
                      <div className="text-white font-black">{match.score && match.score !== "v" ? match.score : "vs"}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default LivePanel;
