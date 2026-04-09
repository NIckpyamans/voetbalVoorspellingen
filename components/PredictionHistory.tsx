import React, { useEffect, useMemo, useRef, useState } from "react";

interface HistoryItem {
  matchId: string;
  prediction: string;
  actual: string;
  wasCorrect: boolean;
  errorMargin: number;
  timestamp: number;
  homeTeam?: string | null;
  awayTeam?: string | null;
  league?: string | null;
  winnerCorrect?: boolean;
  predictedOutcome?: string | null;
  actualOutcome?: string | null;
  topChanceCorrect?: boolean;
  phaseBucket?: string | null;
  confidence?: number;
}

function outcomeFromScore(score?: string | null) {
  const [home, away] = String(score || "").split("-").map(Number);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (home > away) return "Thuis";
  if (away > home) return "Uit";
  return "Gelijk";
}

function hydrateHistory(items: HistoryItem[]) {
  return items.map((item) => {
    const predictedOutcome = item.predictedOutcome || outcomeFromScore(item.prediction);
    const actualOutcome = item.actualOutcome || outcomeFromScore(item.actual);
    const winnerCorrect =
      typeof item.winnerCorrect === "boolean" ? item.winnerCorrect : predictedOutcome === actualOutcome;
    return {
      ...item,
      predictedOutcome,
      actualOutcome,
      winnerCorrect,
      wasCorrect: String(item.prediction || "").trim() === String(item.actual || "").trim(),
    };
  });
}

const PAGE_SIZE = 80;

function mergeHistory(localItems: HistoryItem[], serverItems: HistoryItem[]) {
  const merged = new Map<string, HistoryItem>();
  for (const item of [...serverItems, ...localItems]) {
    if (!item?.matchId) continue;
    const current = merged.get(item.matchId);
    if (!current || Number(item.timestamp || 0) >= Number(current.timestamp || 0)) {
      merged.set(item.matchId, item);
    }
  }
  return [...merged.values()].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

const PredictionHistory: React.FC = () => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [filter, setFilter] = useState<"alle" | "score" | "uitkomst" | "fout">("alle");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [activeLeague, setActiveLeague] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    let cancelled = false;

    const readLocal = () => {
      try {
        const raw = localStorage.getItem("footypredict_memory");
        return raw ? hydrateHistory(JSON.parse(raw)) : [];
      } catch {
        return [];
      }
    };

    const boot = async () => {
      const localItems = readLocal();
      try {
        const response = await fetch("/api/history");
        const data = await response.json();
        const serverItems = Array.isArray(data.items) ? hydrateHistory(data.items) : [];
        if (!cancelled) setHistory(mergeHistory(localItems, serverItems));
      } catch {
        if (!cancelled) setHistory(localItems.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)));
      }
    };

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearHistory = () => {
    if (!window.confirm("Weet je zeker dat je alle lokale geschiedenis wilt wissen? Worker-reviews blijven wel in de serverhistorie.")) {
      return;
    }
    localStorage.removeItem("footypredict_memory");
    setHistory((current) => current.filter((item) => !String(item.matchId || "").startsWith("ss-")));
  };

  const stats = useMemo(() => {
    const total = history.length;
    const exactCorrect = history.filter((item) => item.wasCorrect).length;
    const outcomeCorrect = history.filter((item) => item.winnerCorrect).length;
    const avgError = total
      ? (history.reduce((sum, item) => sum + Number(item.errorMargin || 0), 0) / total).toFixed(2)
      : "0.00";

    let streak = 0;
    let bestStreak = 0;
    for (const item of [...history].reverse()) {
      if (item.winnerCorrect) {
        streak += 1;
        bestStreak = Math.max(bestStreak, streak);
      } else {
        streak = 0;
      }
    }

    const byLeague = Object.entries(
      history.reduce((acc: Record<string, { exact: number; outcome: number; total: number; topChance: number }>, item) => {
        const league = item.league || "Onbekend";
        if (!acc[league]) acc[league] = { exact: 0, outcome: 0, total: 0, topChance: 0 };
        acc[league].total += 1;
        if (item.wasCorrect) acc[league].exact += 1;
        if (item.winnerCorrect) acc[league].outcome += 1;
        if (item.topChanceCorrect) acc[league].topChance += 1;
        return acc;
      }, {})
    )
      .map(([league, value]) => ({
        league,
        total: value.total,
        exact: value.exact,
        outcome: value.outcome,
        topChance: value.topChance,
        exactPct: value.total ? Math.round((value.exact / value.total) * 100) : 0,
        outcomePct: value.total ? Math.round((value.outcome / value.total) * 100) : 0,
        topChancePct: value.total ? Math.round((value.topChance / value.total) * 100) : 0,
      }))
      .filter((item) => item.league !== "Onbekend")
      .sort((a, b) => b.exactPct - a.exactPct || b.outcomePct - a.outcomePct || b.total - a.total);

    return {
      total,
      exactCorrect,
      outcomeCorrect,
      exactPct: total ? ((exactCorrect / total) * 100).toFixed(1) : "0.0",
      outcomePct: total ? ((outcomeCorrect / total) * 100).toFixed(1) : "0.0",
      avgError,
      bestStreak,
      byLeague,
    };
  }, [history]);

  const filtered = useMemo(() => {
    return history.filter((item) => {
      if (filter === "score" && !item.wasCorrect) return false;
      if (filter === "uitkomst" && !item.winnerCorrect) return false;
      if (filter === "fout" && (item.wasCorrect || item.winnerCorrect)) return false;
      if (activeLeague && item.league !== activeLeague) return false;
      if (search) {
        const haystack = `${item.homeTeam || ""} ${item.awayTeam || ""} ${item.league || ""}`.toLowerCase();
        if (!haystack.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [history, filter, search, activeLeague]);

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const groupedByLeague = useMemo(() => {
    return paginated.reduce((acc: Record<string, HistoryItem[]>, item) => {
      const league = item.league || "Onbekend";
      if (!acc[league]) acc[league] = [];
      acc[league].push(item);
      return acc;
    }, {});
  }, [paginated]);

  const leagueOrder = useMemo(
    () => Object.keys(groupedByLeague).sort((a, b) => {
      const aStats = stats.byLeague.find((item) => item.league === a);
      const bStats = stats.byLeague.find((item) => item.league === b);
      return (bStats?.exactPct || 0) - (aStats?.exactPct || 0) || (bStats?.outcomePct || 0) - (aStats?.outcomePct || 0);
    }),
    [groupedByLeague, stats.byLeague]
  );

  const filteredWrongCount = useMemo(
    () => history.filter((item) => !item.wasCorrect && !item.winnerCorrect).length,
    [history]
  );

  const jumpToLeague = (league: string) => {
    setActiveLeague((current) => (current === league ? null : league));
    setPage(0);
    requestAnimationFrame(() => {
      sectionRefs.current[league]?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h2 className="text-2xl font-black text-white uppercase tracking-tight">Voorspellingsgeschiedenis</h2>
          <p className="text-slate-500 text-xs mt-0.5">{stats.total.toLocaleString()} voorspellingen en reviews zichtbaar</p>
        </div>
        <button
          onClick={clearHistory}
          className="px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-black uppercase hover:bg-red-500/20 transition"
        >
          Lokale cache wissen
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Totaal", value: stats.total.toLocaleString(), color: "text-blue-400" },
          { label: "Juiste score", value: `${stats.exactPct}%`, color: "text-green-400" },
          { label: "Juiste winnaar/gelijk", value: `${stats.outcomePct}%`, color: "text-emerald-400" },
          { label: "Gem. foutmarge", value: stats.avgError, color: "text-purple-400" },
          { label: "Beste reeks", value: `${stats.bestStreak}`, color: "text-yellow-400" },
        ].map((item) => (
          <div key={item.label} className="glass-card p-4 rounded-2xl border border-white/5">
            <div className={`text-[9px] font-black uppercase mb-1 ${item.color}`}>{item.label}</div>
            <div className="text-2xl font-black text-white">{item.value}</div>
          </div>
        ))}
      </div>

      {stats.byLeague.length > 0 && (
        <div className="glass-card p-4 rounded-2xl border border-white/5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-[10px] font-black text-slate-400 uppercase">Competities gerangschikt op juiste score</div>
            <div className="text-[9px] text-slate-500">klik op een competitie om alle wedstrijden eronder te openen</div>
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-3 min-w-max">
              {stats.byLeague.map((item) => (
                <button
                  key={item.league}
                  onClick={() => jumpToLeague(item.league)}
                  className={`w-72 text-left bg-slate-900/60 rounded-xl p-3 border transition ${
                    activeLeague === item.league ? "border-blue-500/40 shadow-[0_0_0_1px_rgba(59,130,246,.25)]" : "border-white/5 hover:border-white/10"
                  }`}
                >
                  <div className="text-[10px] font-black text-white truncate">{item.league}</div>
                  <div className="text-[8px] text-slate-500 mt-0.5">{item.total} wedstrijden</div>
                  <div className="mt-3 space-y-2">
                    <div>
                      <div className="flex justify-between text-[8px] text-slate-400">
                        <span>Juiste score</span>
                        <span className="font-black text-white">{item.exactPct}%</span>
                      </div>
                      <div className="mt-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${item.exactPct}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[8px] text-slate-400">
                        <span>Juiste winnaar/gelijk</span>
                        <span className="font-black text-white">{item.outcomePct}%</span>
                      </div>
                      <div className="mt-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${item.outcomePct}%` }} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 text-[8px] text-slate-500">
                    Score goed {item.exact}/{item.total} · Uitkomst goed {item.outcome}/{item.total}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-2">
        <div className="flex gap-1 flex-wrap">
          {[
            { key: "alle", label: `Alle (${history.length})` },
            { key: "score", label: `Juiste score (${stats.exactCorrect})` },
            { key: "uitkomst", label: `Juiste winnaar/gelijk (${stats.outcomeCorrect})` },
            { key: "fout", label: `Volledig fout (${filteredWrongCount})` },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setFilter(item.key as any);
                setPage(0);
              }}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition ${
                filter === item.key ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
          {activeLeague && (
            <button
              onClick={() => setActiveLeague(null)}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-slate-900 text-slate-300 border border-white/10 hover:text-white"
            >
              Reset competitie
            </button>
          )}
        </div>
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          placeholder="Zoek op teamnaam, competitie..."
          className="flex-1 bg-slate-900/60 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 outline-none focus:border-blue-500/40"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="glass-card p-12 rounded-2xl text-center border border-dashed border-white/10">
          <div className="text-4xl mb-3">Geen resultaten</div>
          <p className="text-slate-500 font-bold">Geen wedstrijden gevonden voor deze selectie</p>
        </div>
      ) : (
        <>
          <div className="space-y-6">
            {leagueOrder.map((league) => {
              const items = groupedByLeague[league] || [];
              const leagueStats = stats.byLeague.find((item) => item.league === league);
              return (
                <div
                  key={league}
                  ref={(node) => {
                    sectionRefs.current[league] = node;
                  }}
                  className="space-y-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black text-slate-400 uppercase">{league}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {items.length} wedstrijden op deze pagina · Score {leagueStats?.exactPct ?? 0}% · Uitkomst {leagueStats?.outcomePct ?? 0}%
                      </div>
                    </div>
                    {activeLeague !== league && (
                      <button
                        onClick={() => jumpToLeague(league)}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 text-[10px] font-black hover:text-white"
                      >
                        Toon alles van deze competitie
                      </button>
                    )}
                  </div>

                  <div className="space-y-3">
                    {items.map((item) => (
                      <div
                        key={item.matchId}
                        className={`glass-card rounded-2xl border p-4 ${
                          item.wasCorrect
                            ? "border-green-500/20"
                            : item.winnerCorrect
                              ? "border-blue-500/20"
                              : "border-white/5"
                        }`}
                      >
                        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-[15px] font-black text-white truncate">
                              {item.homeTeam} vs {item.awayTeam}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {item.league} · {new Date(item.timestamp).toLocaleString("nl-NL")}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 xl:min-w-[720px]">
                            <div className="rounded-xl bg-slate-900/40 border border-white/5 px-3 py-2">
                              <div className="text-[8px] font-black text-slate-500 uppercase">Voorspeld</div>
                              <div className="text-3xl font-black text-white mt-1">{item.prediction}</div>
                            </div>
                            <div className="rounded-xl bg-slate-900/40 border border-white/5 px-3 py-2">
                              <div className="text-[8px] font-black text-slate-500 uppercase">Werkelijk</div>
                              <div className="text-3xl font-black text-white mt-1">{item.actual}</div>
                            </div>
                            <div className={`rounded-xl border px-3 py-2 ${item.wasCorrect ? "border-green-500/30 bg-green-950/20" : "border-red-500/20 bg-red-950/10"}`}>
                              <div className="text-[8px] font-black text-slate-500 uppercase">Score</div>
                              <div className={`text-[14px] font-black mt-2 ${item.wasCorrect ? "text-green-300" : "text-red-300"}`}>
                                {item.wasCorrect ? "Juist" : "Niet juist"}
                              </div>
                            </div>
                            <div className={`rounded-xl border px-3 py-2 ${item.winnerCorrect ? "border-blue-500/30 bg-blue-950/20" : "border-amber-500/20 bg-amber-950/10"}`}>
                              <div className="text-[8px] font-black text-slate-500 uppercase">Winnaar/gelijk</div>
                              <div className={`text-[14px] font-black mt-2 ${item.winnerCorrect ? "text-blue-300" : "text-amber-300"}`}>
                                {item.winnerCorrect ? "Juist" : "Niet juist"}
                              </div>
                            </div>
                            <div className="rounded-xl bg-slate-900/40 border border-white/5 px-3 py-2">
                              <div className="text-[8px] font-black text-slate-500 uppercase">Uitkomst</div>
                              <div className="text-[13px] font-black text-white mt-2">
                                {item.predictedOutcome} → {item.actualOutcome}
                              </div>
                            </div>
                            <div className="rounded-xl bg-slate-900/40 border border-white/5 px-3 py-2">
                              <div className="text-[8px] font-black text-slate-500 uppercase">Foutmarge</div>
                              <div className="text-[22px] font-black text-white mt-1">{item.errorMargin}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-[10px] font-black disabled:opacity-40"
              >
                Vorige
              </button>
              <div className="text-[10px] text-slate-500">
                Pagina {page + 1} van {totalPages}
              </div>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-[10px] font-black disabled:opacity-40"
              >
                Volgende
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PredictionHistory;
