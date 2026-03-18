import React, { useEffect, useMemo, useState } from "react";

interface StandingRow {
  pos: number;
  team: string;
  teamId: string;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
}

interface StandingMetaZone {
  key: string;
  label: string;
  color: string;
  from: number;
  to: number;
}

interface LeagueStanding {
  label: string;
  rows: StandingRow[];
  updated: number;
  meta?: {
    format?: string;
    zones?: StandingMetaZone[];
    notes?: string[];
  };
}

interface KnockoutItem {
  league: string;
  roundLabel?: string | null;
  stakes?: string | null;
  matchId: string;
  kickoff?: string | null;
  homeTeamName: string;
  awayTeamName: string;
  aggregate?: any;
  score?: string | null;
  status?: string;
}

function zoneClasses(color?: string) {
  if (color === "blue") return "border-l-blue-500 text-blue-400";
  if (color === "amber") return "border-l-amber-500 text-amber-400";
  if (color === "red") return "border-l-red-500 text-red-400";
  return "border-l-slate-600 text-slate-400";
}

const StandingsView: React.FC = () => {
  const [standings, setStandings] = useState<Record<string, LeagueStanding>>({});
  const [knockoutOverview, setKnockoutOverview] = useState<Record<string, KnockoutItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/standings")
      .then((response) => response.json())
      .then((data) => {
        setStandings(data.standings || {});
        setKnockoutOverview(data.knockoutOverview || {});
        const keys = Object.keys(data.standings || {});
        if (keys.length > 0) setSelected(keys[0]);
      })
      .finally(() => setLoading(false));
  }, []);

  const sortedKeys = useMemo(() => {
    return Object.keys(standings).sort((a, b) =>
      String(standings[a]?.label || "").localeCompare(String(standings[b]?.label || ""))
    );
  }, [standings]);

  const knockoutItems = useMemo(() => {
    return Object.values(knockoutOverview)
      .flat()
      .sort((a, b) => String(a.kickoff || "").localeCompare(String(b.kickoff || "")));
  }, [knockoutOverview]);

  const currentStanding = selected ? standings[selected] : null;

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((index) => (
          <div key={index} className="h-12 glass-card rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (sortedKeys.length === 0 && knockoutItems.length === 0) {
    return (
      <div className="text-center py-20 text-slate-500">
        <div className="text-5xl mb-3">Standen</div>
        <div className="font-bold">Standen en knock-out info verschijnen na de volgende worker run.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-black text-white uppercase tracking-tight">Standen & knock-out</h2>
        {currentStanding && (
          <p className="text-slate-500 text-xs mt-1">
            Bijgewerkt: {new Date(currentStanding.updated).toLocaleString("nl-NL")}
          </p>
        )}
      </div>

      {knockoutItems.length > 0 && (
        <section className="glass-card rounded-2xl border border-white/5 p-4">
          <div className="text-sm font-black uppercase text-white mb-3">Knock-out & play-offs</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {knockoutItems.map((item) => (
              <div key={item.matchId} className="rounded-xl border border-white/5 bg-slate-900/50 p-3">
                <div className="text-[10px] uppercase text-amber-400 font-black">{item.league}</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {item.roundLabel || "Knock-out"}{item.stakes ? ` · ${item.stakes}` : ""}
                </div>
                <div className="mt-2 text-sm font-black text-white">
                  {item.homeTeamName} vs {item.awayTeamName}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {item.score || "Nog niet gestart"}
                  {item.aggregate?.active && item.aggregate.aggregateScore
                    ? ` · aggregate ${item.aggregate.aggregateScore}`
                    : ""}
                </div>
                {item.aggregate?.firstLegText && (
                  <div className="text-[11px] text-slate-500 mt-1">
                    Eerste duel: {item.aggregate.firstLegText}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {sortedKeys.length > 0 && (
        <>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
            {sortedKeys.map((key) => {
              const label = standings[key]?.label || key;
              return (
                <button
                  key={key}
                  onClick={() => setSelected(key)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-black transition ${
                    selected === key ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {currentStanding && (
            <div className="glass-card rounded-2xl border border-white/5 overflow-hidden">
              <div className="grid grid-cols-12 gap-1 px-4 py-2 bg-slate-900/60 text-[8px] font-black text-slate-400 uppercase">
                <div className="col-span-1">#</div>
                <div className="col-span-4">Club</div>
                <div className="col-span-1 text-center">W</div>
                <div className="col-span-1 text-center">G</div>
                <div className="col-span-1 text-center">V</div>
                <div className="col-span-1 text-center">+/-</div>
                <div className="col-span-1 text-center">Dg</div>
                <div className="col-span-2 text-right text-white">Pnt</div>
              </div>

              {currentStanding.rows.map((row, index) => {
                const goalDiff = (row.gf || 0) - (row.ga || 0);
                const zone =
                  currentStanding.meta?.zones?.find(
                    (item) => row.pos >= item.from && row.pos <= item.to
                  ) || null;
                return (
                  <div
                    key={row.teamId || index}
                    className={`grid grid-cols-12 gap-1 px-4 py-2.5 border-b border-white/5 last:border-0 text-sm items-center hover:bg-white/3 transition border-l-2 ${zoneClasses(zone?.color)}`}
                  >
                    <div className="col-span-1 text-[11px] font-black">{row.pos}</div>
                    <div className="col-span-4">
                      <div className="flex items-center gap-2">
                        <img
                          src={`https://api.sofascore.app/api/v1/team/${row.teamId}/image`}
                          className="w-5 h-5 object-contain"
                          alt=""
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                        <span className="text-[11px] font-black text-white truncate">{row.team}</span>
                      </div>
                    </div>
                    <div className="col-span-1 text-center text-[11px] text-green-400 font-bold">{row.w}</div>
                    <div className="col-span-1 text-center text-[11px] text-slate-400 font-bold">{row.d}</div>
                    <div className="col-span-1 text-center text-[11px] text-red-400 font-bold">{row.l}</div>
                    <div className={`col-span-1 text-center text-[11px] font-bold ${goalDiff > 0 ? "text-green-400" : goalDiff < 0 ? "text-red-400" : "text-slate-500"}`}>
                      {goalDiff > 0 ? `+${goalDiff}` : goalDiff}
                    </div>
                    <div className="col-span-1 text-center text-[10px] text-slate-500">{row.p}</div>
                    <div className="col-span-2 text-right">
                      <span className="text-sm font-black text-white bg-slate-800 px-2 py-0.5 rounded-lg">{row.pts}</span>
                    </div>
                  </div>
                );
              })}

              <div className="px-4 py-3 bg-slate-900/40 space-y-2">
                <div className="flex flex-wrap gap-3">
                  {(currentStanding.meta?.zones || []).map((zone) => (
                    <div key={zone.key} className="flex items-center gap-1.5">
                      <div className={`w-2 h-3 rounded-sm ${zone.color === "blue" ? "bg-blue-500" : zone.color === "amber" ? "bg-amber-500" : zone.color === "red" ? "bg-red-500" : "bg-slate-500"}`} />
                      <span className="text-[8px] text-slate-400">
                        {zone.label} ({zone.from}-{zone.to})
                      </span>
                    </div>
                  ))}
                </div>
                {(currentStanding.meta?.notes || []).map((note, index) => (
                  <div key={index} className="text-[10px] text-slate-500">
                    {note}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default StandingsView;
