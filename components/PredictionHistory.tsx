import React, { useEffect, useMemo, useState } from "react";

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
    const winnerCorrect = typeof item.winnerCorrect === "boolean" ? item.winnerCorrect : predictedOutcome === actualOutcome;
    return {
      ...item,
      predictedOutcome,
      actualOutcome,
      winnerCorrect,
      wasCorrect: String(item.prediction || "").trim() === String(item.actual || "").trim(),
    };
  });
}

const PAGE_SIZE = 60;

const PredictionHistory: React.FC = () => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [filter, setFilter] = useState<"alle" | "score" | "uitkomst" | "fout">("alle");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("footypredict_memory");
      if (!raw) return;
      const parsed = hydrateHistory(JSON.parse(raw)).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
      setHistory(parsed);
    } catch {}
  }, []);

  const clearHistory = () => {
    if (!window.confirm("Weet je zeker dat je alle geschiedenis wilt wissen?")) return;
    localStorage.removeItem("footypredict_memory");
    setHistory([]);
  };

  const stats = useMemo(() => {
    const total = history.length;
    const exactCorrect = history.filter((item) => item.wasCorrect).length;
    const outcomeCorrect = history.filter((item) => item.winnerCorrect).length;
    const avgError = total ? (history.reduce((sum, item) => sum + Number(item.errorMargin || 0), 0) / total).toFixed(2) : "0.00";

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
      history.reduce((acc: Record<string, { exact: number; outcome: number; total: number }>, item) => {
        const league = item.league || "Onbekend";
        if (!acc[league]) acc[league] = { exact: 0, outcome: 0, total: 0 };
        acc[league].total += 1;
        if (item.wasCorrect) acc[league].exact += 1;
        if (item.winnerCorrect) acc[league].outcome += 1;
        return acc;
      }, {})
    )
      .map(([league, value]) => ({
        league,
        total: value.total,
        exact: value.exact,
        outcome: value.outcome,
        exactPct: value.total ? Math.round((value.exact / value.total) * 100) : 0,
        outcomePct: value.total ? Math.round((value.outcome / value.total) * 100) : 0,
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
      if (search) {
        const haystack = `${item.homeTeam || ""} ${item.awayTeam || ""} ${item.league || ""}`.toLowerCase();
        if (!haystack.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [history, filter, search]);

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const groupedByDate = useMemo(() => {
    return paginated.reduce((acc: Record<string, HistoryItem[]>, item) => {
      const label = new Date(item.timestamp).toLocaleDateString("nl-NL", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      if (!acc[label]) acc[label] = [];
      acc[label].push(item);
      return acc;
    }, {});
  }, [paginated]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h2 className="text-2xl font-black text-white uppercase tracking-tight">Voorspellingsgeschiedenis</h2>
          <p className="text-slate-500 text-xs mt-0.5">{stats.total.toLocaleString()} voorspellingen opgeslagen</p>
        </div>
        <button
          onClick={clearHistory}
          className="px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-black uppercase hover:bg-red-500/20 transition"
        >
          Alles wissen
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
            <div className="text-[9px] text-slate-500">sleep horizontaal om alles te zien</div>
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-3 min-w-max">
              {stats.byLeague.map((item) => (
                <div key={item.league} className="w-72 bg-slate-900/60 rounded-xl p-3 border border-white/5">
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
                </div>
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
            { key: "fout", label: `Volledig fout (${history.length - history.filter((item) => item.wasCorrect || item.winnerCorrect).length})` },
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
          <div className="text-4xl mb-3">📭</div>
          <p className="text-slate-500 font-bold">Geen resultaten gevonden</p>
        </div>
      ) : (
        <>
          <div className="space-y-6">
            {Object.entries(groupedByDate).map(([day, items]) => (
              <div key={day}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase">{day}</span>
                  <div className="flex-1 h-px bg-white/5" />
                  <span className="text-[9px] text-slate-600">{items.length} wedstrijden</span>
                </div>
                <div className="space-y-2">
                  {items.map((item, index) => (
                    <div key={`${item.matchId}-${index}`} className="glass-card p-3 rounded-xl border border-white/5">
                      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] font-black text-white truncate">
                            {item.homeTeam && item.awayTeam ? `${item.homeTeam} vs ${item.awayTeam}` : item.matchId}
                          </div>
                          <div className="text-[8px] text-slate-500 truncate">{item.league || "Onbekend"}</div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 xl:min-w-[520px]">
                          <div className="bg-slate-900/60 rounded-xl p-2 text-center">
                            <div className="text-[7px] text-blue-400 font-black uppercase">Voorspeld</div>
                            <div className="text-lg font-black text-white">{item.prediction}</div>
                          </div>
                          <div className="bg-slate-900/60 rounded-xl p-2 text-center">
                            <div className="text-[7px] text-slate-400 font-black uppercase">Werkelijk</div>
                            <div className="text-lg font-black text-white">{item.actual}</div>
                          </div>
                          <div className={`rounded-xl p-2 text-center border ${item.wasCorrect ? "bg-green-900/20 border-green-500/20" : "bg-slate-900/60 border-white/5"}`}>
                            <div className="text-[7px] text-slate-400 font-black uppercase">Score</div>
                            <div className={`text-[11px] font-black ${item.wasCorrect ? "text-green-300" : "text-red-300"}`}>
                              {item.wasCorrect ? "Juist" : "Niet juist"}
                            </div>
                          </div>
                          <div className={`rounded-xl p-2 text-center border ${item.winnerCorrect ? "bg-blue-900/20 border-blue-500/20" : "bg-slate-900/60 border-white/5"}`}>
                            <div className="text-[7px] text-slate-400 font-black uppercase">Winnaar / gelijk</div>
                            <div className={`text-[11px] font-black ${item.winnerCorrect ? "text-blue-300" : "text-red-300"}`}>
                              {item.winnerCorrect ? "Juist" : "Niet juist"}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2">
                        <div className="rounded-xl bg-slate-900/50 px-3 py-2">
                          <div className="text-[7px] text-slate-500 uppercase font-black">Voorspelde uitkomst</div>
                          <div className="text-[10px] font-black text-white">{item.predictedOutcome || "-"}</div>
                        </div>
                        <div className="rounded-xl bg-slate-900/50 px-3 py-2">
                          <div className="text-[7px] text-slate-500 uppercase font-black">Werkelijke uitkomst</div>
                          <div className="text-[10px] font-black text-white">{item.actualOutcome || "-"}</div>
                        </div>
                        <div className="rounded-xl bg-slate-900/50 px-3 py-2">
                          <div className="text-[7px] text-slate-500 uppercase font-black">Foutmarge</div>
                          <div className="text-[10px] font-black text-white">{item.errorMargin}</div>
                        </div>
                        <div className="rounded-xl bg-slate-900/50 px-3 py-2">
                          <div className="text-[7px] text-slate-500 uppercase font-black">Exact score</div>
                          <div className={`text-[10px] font-black ${item.wasCorrect ? "text-green-300" : "text-slate-300"}`}>
                            {item.wasCorrect ? "Goed" : "Fout"}
                          </div>
                        </div>
                        <div className="rounded-xl bg-slate-900/50 px-3 py-2">
                          <div className="text-[7px] text-slate-500 uppercase font-black">Winnaar/gelijk</div>
                          <div className={`text-[10px] font-black ${item.winnerCorrect ? "text-blue-300" : "text-slate-300"}`}>
                            {item.winnerCorrect ? "Goed" : "Fout"}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-[10px] font-black disabled:opacity-30 hover:bg-slate-700 transition"
              >
                ‹ Vorige
              </button>
              <span className="text-[10px] text-slate-500">
                {page + 1} / {totalPages} ({filtered.length} totaal)
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page === totalPages - 1}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-[10px] font-black disabled:opacity-30 hover:bg-slate-700 transition"
              >
                Volgende ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PredictionHistory;
