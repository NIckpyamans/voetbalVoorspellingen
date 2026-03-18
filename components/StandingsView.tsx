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

interface CupSheet {
  league: string;
  rounds: Record<string, KnockoutItem[]>;
}

function zoneClasses(color?: string) {
  if (color === "blue") return "border-l-blue-500 text-blue-400";
  if (color === "amber") return "border-l-amber-500 text-amber-400";
  if (color === "red") return "border-l-red-500 text-red-400";
  return "border-l-slate-600 text-slate-400";
}

function scoreLoser(item: KnockoutItem) {
  const aggregate = item.aggregate;
  if (!aggregate?.active || !aggregate.aggregateScore) return null;
  if (!aggregate.leader) return null;
  return aggregate.leader === item.homeTeamName ? item.awayTeamName : item.homeTeamName;
}

function roundWeight(round: string) {
  const text = String(round || "").toLowerCase();
  if (text.includes("final")) return 90;
  if (text.includes("semi")) return 80;
  if (text.includes("quarter")) return 70;
  if (text.includes("acht")) return 60;
  if (text.includes("round of 16")) return 60;
  if (text.includes("laatste 16")) return 60;
  if (text.includes("play-off")) return 50;
  if (text.includes("32")) return 40;
  return 10;
}

function buildRouteHint(items: KnockoutItem[], index: number) {
  if (items.length < 2) return null;
  const pairStart = Math.floor(index / 2) * 2;
  const siblingIndex = index % 2 === 0 ? pairStart + 1 : pairStart;
  const sibling = items[siblingIndex];
  if (!sibling || sibling.matchId === items[index].matchId) return null;
  return `Bij winst tegen winnaar van ${sibling.homeTeamName} vs ${sibling.awayTeamName}`;
}

function nextRoundLabel(rounds: string[], currentIndex: number) {
  if (currentIndex >= rounds.length - 1) return null;
  return rounds[currentIndex + 1];
}

const StandingsView: React.FC = () => {
  const [standings, setStandings] = useState<Record<string, LeagueStanding>>({});
  const [cupSheets, setCupSheets] = useState<Record<string, CupSheet>>({});
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"league" | "cup">("league");
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [selectedCup, setSelectedCup] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/standings")
      .then((response) => response.json())
      .then((data) => {
        const nextStandings = data.standings || {};
        const nextCupSheets = data.cupSheets || {};
        setStandings(nextStandings);
        setCupSheets(nextCupSheets);

        const standingKeys = Object.keys(nextStandings);
        const cupKeys = Object.keys(nextCupSheets);
        if (standingKeys.length > 0) setSelectedLeague(standingKeys[0]);
        if (cupKeys.length > 0) setSelectedCup(cupKeys[0]);
        if (standingKeys.length === 0 && cupKeys.length > 0) setMode("cup");
      })
      .finally(() => setLoading(false));
  }, []);

  const sortedLeagueKeys = useMemo(() => {
    return Object.keys(standings).sort((a, b) =>
      String(standings[a]?.label || "").localeCompare(String(standings[b]?.label || ""))
    );
  }, [standings]);

  const sortedCupKeys = useMemo(() => {
    return Object.keys(cupSheets).sort((a, b) => a.localeCompare(b));
  }, [cupSheets]);

  const currentStanding = selectedLeague ? standings[selectedLeague] : null;
  const currentCup = selectedCup ? cupSheets[selectedCup] : null;

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((index) => (
          <div key={index} className="h-12 glass-card rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (sortedLeagueKeys.length === 0 && sortedCupKeys.length === 0) {
    return (
      <div className="text-center py-20 text-slate-500">
        <div className="text-5xl mb-3">Standen</div>
        <div className="font-bold">Standen en bekerschema verschijnen na de volgende worker run.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-black text-white uppercase tracking-tight">Standen & bekerschema</h2>
        <p className="text-slate-500 text-xs mt-1">
          Competities en bekerwedstrijden staan nu apart, per toernooi en ronde.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setMode("league")}
          className={`px-4 py-2 rounded-xl text-xs font-black ${
            mode === "league" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"
          }`}
        >
          Standen
        </button>
        <button
          onClick={() => setMode("cup")}
          className={`px-4 py-2 rounded-xl text-xs font-black ${
            mode === "cup" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"
          }`}
        >
          Bekerschema
        </button>
      </div>

      {mode === "league" && sortedLeagueKeys.length > 0 && (
        <>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
            {sortedLeagueKeys.map((key) => {
              const label = standings[key]?.label || key;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedLeague(key)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-black transition ${
                    selectedLeague === key ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
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

      {mode === "cup" && sortedCupKeys.length > 0 && (
        <>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
            {sortedCupKeys.map((key) => (
              <button
                key={key}
                onClick={() => setSelectedCup(key)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-black transition ${
                  selectedCup === key ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {key}
              </button>
            ))}
          </div>

          {currentCup && (
            <div className="glass-card rounded-2xl border border-white/5 p-4">
              <div className="text-sm font-black uppercase text-white mb-3">{currentCup.league}</div>
              <div className="overflow-x-auto scrollbar-hide pb-2">
                <div className="flex gap-4 min-w-max">
                  {Object.entries(currentCup.rounds)
                    .map(([round, items]) => [round, items.filter((item) => item.league === selectedCup)] as const)
                    .filter(([, items]) => items.length > 0)
                    .sort((a, b) => roundWeight(a[0]) - roundWeight(b[0]))
                    .map(([round], _, arr) => round)
                    .map((round, roundIndex, roundLabels) => {
                      const items = (currentCup.rounds[round] || [])
                        .filter((item) => item.league === selectedCup)
                        .sort((a, b) => String(a.kickoff || "").localeCompare(String(b.kickoff || "")));
                      const nextRound = nextRoundLabel(roundLabels, roundIndex);

                      return (
                        <section key={round} className="w-[320px] flex-shrink-0">
                          <div className="text-sm font-black uppercase text-white mb-3">{round}</div>
                          <div className="space-y-3">
                            {items.map((item, index) => {
                              const loser = scoreLoser(item);
                              const routeHint = buildRouteHint(items, index);
                              return (
                                <div key={item.matchId} className="rounded-xl border border-white/5 bg-slate-900/50 p-3">
                                  <div className="text-[11px] text-slate-400">
                                    {item.stakes || "Knock-out"}
                                  </div>
                                  <div className="mt-2 space-y-1">
                                    <div className={`text-sm font-black ${loser === item.homeTeamName ? "text-slate-500 line-through" : "text-white"}`}>
                                      {item.homeTeamName}
                                    </div>
                                    <div className={`text-sm font-black ${loser === item.awayTeamName ? "text-slate-500 line-through" : "text-white"}`}>
                                      {item.awayTeamName}
                                    </div>
                                  </div>
                                  <div className="text-[11px] text-slate-300 mt-2">
                                    Duel: {item.score || "Nog niet gestart"}
                                  </div>
                                  {item.aggregate?.active && (
                                    <>
                                      <div className="text-[11px] text-amber-300 mt-1">
                                        Eerste duel: {item.aggregate.firstLegText || item.aggregate.firstLegScore || "onbekend"}
                                      </div>
                                      <div className="text-[11px] text-amber-300">
                                        Aggregate: {item.aggregate.aggregateScore || "-"}
                                        {item.aggregate.leader ? ` · ${item.aggregate.leader} door` : ""}
                                      </div>
                                    </>
                                  )}
                                  {routeHint && nextRound && (
                                    <div className="text-[11px] text-slate-500 mt-2">
                                      Naar {nextRound}: {routeHint}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default StandingsView;
