import React, { useEffect, useMemo, useState } from "react";
import { Match } from "../types";
import { getLiveMinuteLabel } from "../shared/minute.js";

interface LivePanelProps {
  open: boolean;
  onClose: () => void;
  liveMatches: Match[];
  onJumpToLeague: (league: string) => void;
}

const LivePanel: React.FC<LivePanelProps> = ({ open, onClose, liveMatches, onJumpToLeague }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
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
                        <div className="text-[11px] text-slate-400 flex gap-2 items-center">
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-900/35 border border-red-500/25 px-2 py-0.5 text-red-200 font-black">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                            {getLiveMinuteLabel(match, now)}
                          </span>
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
