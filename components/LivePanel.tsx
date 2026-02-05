import React from 'react';
import { Match } from '../types';

interface LivePanelProps {
  open: boolean;
  onClose: () => void;
  liveMatches: Match[];
  onJumpToLeague: (league: string) => void;
}

const LivePanel: React.FC<LivePanelProps> = ({ open, onClose, liveMatches, onJumpToLeague }) => {
  if (!open) return null;

  const grouped = liveMatches.reduce((acc: Record<string, Match[]>, m) => {
    const key = m.league || 'Unknown';
    acc[key] = acc[key] || [];
    acc[key].push(m);
    return acc;
  }, {});

  const entries = Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0])) as [string, Match[]][];

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="z-70 max-w-5xl w-full bg-[#071023] border border-white/5 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black text-white">Live wedstrijden</h3>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-sm text-slate-400 hover:text-white px-3 py-1 rounded">Sluiten</button>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="text-slate-500">Geen live wedstrijden momenteel.</div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-auto pr-2">
            {entries.map(([league, ms]) => (
              <div key={league} className="border-b border-white/5 pb-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold text-sm text-white">{league}</div>
                  <button
                    onClick={() => onJumpToLeague(league)}
                    className="text-xs text-blue-400 hover:underline"
                  >
                    Ga naar competitie
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {ms.map((m) => (
                    <div key={m.id} className="glass-card p-3 rounded-lg border border-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="text-sm font-black text-white">{m.homeTeamName} vs {m.awayTeamName}</div>
                        <div className="text-[11px] text-slate-400">{m.minute ? `${m.minute}` : ''}</div>
                      </div>
                      <div className="text-white font-black">{m.score && m.score !== 'v' ? m.score : 'vs'}</div>
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
