import React, { useEffect, useMemo, useRef, useState } from "react";
import { parseScoreline } from "../shared/scoreOutcome.js";
import { normalizeDedupeText } from "../shared/matchNormalization.js";

interface HistoryItem {
  matchId: string;
  predictionId?: string | null;
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
  exactScoreConfidence?: number;
  bestBetRank?: number | null;
  topConfidencePick?: boolean;
  topExactScorePick?: boolean;
  topExactReasons?: string[];
  brierScore?: number | null;
  logLoss?: number | null;
  roi?: number | null;
  roiStatus?: string | null;
  clv?: number | null;
  clvStatus?: string | null;
  generatedAt?: string | null;
  cutoffAt?: string | null;
  modelVersion?: string | null;
  featureSchemaVersion?: string | null;
  evaluationSource?: string | null;
  leakageRisk?: string | null;
  leakageGuard?: {
    cutoffBeforeKickoff?: boolean | null;
    snapshotBacked?: boolean | null;
    risk?: string | null;
    note?: string | null;
  } | null;
  oddsStatus?: string | null;
  oddsMissingReason?: string | null;
}

type LeagueHistoryStats = {
  exact: number;
  outcome: number;
  total: number;
  topChance: number;
};

// Clubdossier: alle beoordeelde wedstrijden van één club uit de volledige
// serverhistorie, niet alleen uit de pagina die al geladen is.
type ClubDossierMatch = {
  matchId: string;
  date: string;
  league: string | null;
  homeTeam: string;
  awayTeam: string;
  venue: "home" | "away";
  opponent: string;
  result: "W" | "D" | "L" | null;
  predictedScore: string | null;
  actualScore: string | null;
  predictedOutcome: string | null;
  probabilityOutcome: string | null;
  actualOutcome: string | null;
  outcomeHit: boolean | null;
  topPickHit: boolean | null;
  exactHit: boolean | null;
  goalError: number | null;
  confidence: number | null;
  exactScoreConfidence: number | null;
  brierScore: number | null;
  logLoss: number | null;
  oddsStatus: string | null;
  modelVersion: string | null;
};

type ClubDossierSummary = {
  matches: number;
  available: number;
  outcomeHits: number;
  outcomeEvaluated: number;
  outcomePct: number;
  exactHits: number;
  exactEvaluated: number;
  exactPct: number;
  topPickHits: number;
  topPickEvaluated: number;
  topPickPct: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  avgGoalError: number | null;
  firstDate: string | null;
  lastDate: string | null;
  leagues: Array<{ league: string; matches: number }>;
};

type ClubDossier = {
  ok: boolean;
  team?: string;
  league?: string | null;
  matches?: ClubDossierMatch[];
  summary?: ClubDossierSummary | null;
};

function outcomeLabel(value?: string | null) {
  const code = String(value || "").trim().toUpperCase();
  if (code === "H" || code === "THUIS") return "thuis";
  if (code === "D" || code === "GELIJK") return "gelijk";
  if (code === "A" || code === "UIT") return "uit";
  return "-";
}

function hitBadge(hit?: boolean | null) {
  if (hit === true) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (hit === false) return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  return "border-slate-700 bg-slate-800/70 text-slate-400";
}

function dossierTone(value?: number | null) {
  const pct = Number(value || 0);
  if (pct >= 60) return "text-emerald-300";
  if (pct >= 40) return "text-amber-300";
  return "text-rose-300";
}

function outcomeFromScore(score?: string | null) {
  const parsed = parseScoreline(score);
  if (!parsed) return null;
  if (parsed.home > parsed.away) return "Thuis";
  if (parsed.away > parsed.home) return "Uit";
  return "Gelijk";
}

function hydrateHistory(items: HistoryItem[]) {
  return items.map((item) => {
    const predictedOutcome = item.predictedOutcome || outcomeFromScore(item.prediction);
    const actualOutcome = item.actualOutcome || outcomeFromScore(item.actual);
    const hasValidScores = Boolean(parseScoreline(item.prediction) && parseScoreline(item.actual));
    const winnerCorrect = hasValidScores && (typeof item.winnerCorrect === "boolean" ? item.winnerCorrect : predictedOutcome !== null && predictedOutcome === actualOutcome);
    return {
      ...item,
      predictedOutcome,
      actualOutcome,
      winnerCorrect,
      wasCorrect: hasValidScores && String(item.prediction).trim() === String(item.actual).trim(),
    };
  });
}

const PAGE_SIZE = 80;

type SnapshotSummary = {
  total: number;
  evaluated: number;
  pending: number;
  withSnapshotHash?: number;
  withOdds?: number;
  latestGeneratedAt?: string | null;
  estimatedFeatureBytes?: number;
};

type HistorySummaryBucket = {
  key: string;
  total: number;
  exactPct: number;
  outcomePct: number;
  avgGoalError: number;
  biasSummary?: string;
};

type ClubRecentBucket = {
  key: string;
  total: number;
  exact: number;
  outcome: number;
  exactPct: number;
  outcomePct: number;
  avgGoalError: number;
};

type HistoryServerSummary = {
  total: number;
  exactPct: number;
  outcomePct: number;
  oddsCoveragePct: number;
  snapshotCoveragePct: number;
  avgBrier?: number | null;
  avgLogLoss?: number | null;
  byModel?: HistorySummaryBucket[];
  byDataQuality?: HistorySummaryBucket[];
  byTeam?: HistorySummaryBucket[];
  byClubRecent?: ClubRecentBucket[];
  recommendations?: string[];
  oddsDiagnostics?: {
    predictionSnapshots: number;
    predictionOdds: number;
    missingPredictionOdds: number;
    predictionOddsCoveragePct: number;
    prematchOdds?: number | null;
    closingOdds?: number | null;
    nextAction?: string;
  };
  generatedAt?: string;
};

function formatRoi(item: HistoryItem) {
  if (item.roi != null && Number.isFinite(Number(item.roi))) return `${(Number(item.roi) * 100).toFixed(1)}%`;
  if (item.roiStatus === "odds_missing" || item.oddsStatus === "missing" || item.oddsStatus === "historical_market_profile_only") return "geen odds";
  return "-";
}

function formatOddsStatus(item: HistoryItem) {
  if (item.oddsStatus === "available") return "aanwezig";
  if (item.oddsStatus === "partial") return "deels";
  if (item.oddsStatus === "historical_market_profile_only") return "historisch";
  if (item.oddsStatus === "missing") return "mist";
  return item.roi == null ? "geen odds" : "aanwezig";
}

function formatSnapshotStatus(item: HistoryItem) {
  if (item.evaluationSource === "prediction_snapshot") {
    return item.leakageGuard?.cutoffBeforeKickoff === false ? "cutoff fout" : "snapshot";
  }
  return item.predictionId ? "vastgelegd" : "fallback";
}

// De ranglijst komt server-side uit de volledige historie (laatste 10 duels per
// club). Valt die weg, dan gebruiken we de lokale telling van de geladen pagina.
type ClubRankRow = {
  team: string;
  total: number;
  exact: number;
  outcome: number;
  exactPct: number;
  outcomePct: number;
};

function rankClubs(
  serverSummary: HistoryServerSummary | null,
  fallback: Array<ClubRankRow & { avgError?: number }>,
): ClubRankRow[] {
  if (serverSummary?.byClubRecent?.length) {
    return serverSummary.byClubRecent.map((club) => ({
      team: club.key,
      total: club.total,
      exact: club.exact,
      outcome: club.outcome,
      exactPct: club.exactPct,
      outcomePct: club.outcomePct,
    }));
  }
  return fallback.map((club) => ({
    team: club.team,
    total: club.total,
    exact: club.exact,
    outcome: club.outcome,
    exactPct: club.exactPct,
    outcomePct: club.outcomePct,
  }));
}

function mergeHistory(localItems: HistoryItem[], serverItems: HistoryItem[]) {
  const merged = new Map<string, HistoryItem>();
  for (const item of [...serverItems, ...localItems]) {
    if (!item?.matchId) continue;
    const key = String(item.predictionId || item.matchId);
    const current = merged.get(key);
    if (!current || Number(item.timestamp || 0) >= Number(current.timestamp || 0)) {
      merged.set(key, item);
    }
  }
  return [...merged.values()].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

const PredictionHistory: React.FC = () => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [snapshotSummary, setSnapshotSummary] = useState<SnapshotSummary | null>(null);
  const [serverSummary, setServerSummary] = useState<HistoryServerSummary | null>(null);
  const [filter, setFilter] = useState<"alle" | "score" | "uitkomst" | "fout">("alle");
  const [search, setSearch] = useState("");
  const [dossierQuery, setDossierQuery] = useState("");
  const [dossier, setDossier] = useState<ClubDossier | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierError, setDossierError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);
  const [serverTotal, setServerTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
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
        const initialLimit = 100;
        const [historyResponse, snapshotResponse] = await Promise.all([
          fetch(`/api/history?summary=1&includeItems=1&limit=${initialLimit}&offset=0`),
          fetch("/api/prediction-snapshots?summary=1"),
        ]);
        const data = await historyResponse.json();
        const snapshotData = await snapshotResponse.json().catch(() => null);
        const serverItems = Array.isArray(data.items) ? hydrateHistory(data.items) : [];
        if (snapshotData?.summary && !cancelled) setSnapshotSummary(snapshotData.summary);
        if (data?.summary && !cancelled) setServerSummary(data.summary);
        if (!cancelled) {
          setServerTotal(Number(data.total || serverItems.length || 0));
          setServerOffset(serverItems.length);
          setHistory(mergeHistory(localItems, serverItems));
        }
      } catch {
        if (!cancelled) setHistory(localItems.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)));
      }
    };

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  // Kleine vertraging zodat niet elke toetsaanslag een verzoek doet.
  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) {
      setDossierQuery("");
      return;
    }
    const timer = setTimeout(() => setDossierQuery(query), 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Zoekterm -> clubnaam: pak de meest voorkomende volledige clubnaam uit de
  // geladen geschiedenis die bij de zoekterm past ("PSV" -> "PSV Eindhoven"),
  // en haal daarna alle wedstrijden van die club op uit de serverhistorie.
  useEffect(() => {
    if (!dossierQuery) {
      setDossier(null);
      setDossierError(null);
      setDossierLoading(false);
      return;
    }
    const normalizedQuery = normalizeDedupeText(dossierQuery);
    if (!normalizedQuery) {
      setDossier(null);
      setDossierLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const nameCounts = new Map<string, number>();
    for (const item of history) {
      for (const rawName of [item.homeTeam, item.awayTeam]) {
        const name = String(rawName || "").trim();
        if (!name || !normalizeDedupeText(name).includes(normalizedQuery)) continue;
        nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
      }
    }
    const bestName =
      [...nameCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || dossierQuery;
    setDossier(null);
    setDossierLoading(true);
    setDossierError(null);
    fetch(`/api/history?team=${encodeURIComponent(bestName)}&limit=all`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
          throw new Error(data.error || `Clubgegevens ophalen mislukt (${response.status})`);
        }
        return data as ClubDossier;
      })
      .then((data) => {
        // Alleen een dossier tonen als er echt beoordeelde wedstrijden zijn;
        // bij een competitienaam in het zoekveld blijft het paneel weg.
        if (!cancelled) setDossier((data.matches?.length || 0) > 0 ? data : null);
      })
      .catch((error) => {
        if (!cancelled && error?.name !== "AbortError") {
          setDossier(null);
          setDossierError(error?.message || "Clubgegevens ophalen mislukt");
        }
      })
      .finally(() => {
        if (!cancelled) setDossierLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dossierQuery, history]);

  const loadMoreHistory = async () => {
    if (loadingMore || (serverTotal > 0 && serverOffset >= serverTotal)) return;
    setLoadingMore(true);
    try {
      const limit = 100;
      const response = await fetch(`/api/history?includeItems=1&limit=${limit}&offset=${serverOffset}`);
      const data = await response.json();
      const serverItems = Array.isArray(data.items) ? hydrateHistory(data.items) : [];
      setServerTotal(Number(data.total || serverTotal || serverItems.length));
      setServerOffset((value) => value + serverItems.length);
      setHistory((current) => mergeHistory(current, serverItems));
    } finally {
      setLoadingMore(false);
    }
  };

  const clearHistory = () => {
    if (!window.confirm("Weet je zeker dat je alle lokale geschiedenis wilt wissen? Worker-reviews blijven wel in de serverhistorie.")) {
      return;
    }
    localStorage.removeItem("footypredict_memory");
    setHistory((current) => current.filter((item) => !String(item.matchId || "").startsWith("ss-")));
  };

  const stats = useMemo(() => {
    const evaluatedHistory = history.filter((item) => parseScoreline(item.prediction) && parseScoreline(item.actual));
    const total = evaluatedHistory.length;
    const exactCorrect = evaluatedHistory.filter((item) => item.wasCorrect).length;
    const outcomeCorrect = evaluatedHistory.filter((item) => item.winnerCorrect).length;
    const goalErrors = evaluatedHistory.filter((item) => item.errorMargin != null && Number.isFinite(Number(item.errorMargin)));
    const avgError = goalErrors.length
      ? (goalErrors.reduce((sum, item) => sum + Number(item.errorMargin), 0) / goalErrors.length).toFixed(2)
      : "-";
    const withBrier = evaluatedHistory.filter((item) => item.brierScore != null && Number.isFinite(Number(item.brierScore)));
    const avgBrier = withBrier.length
      ? (withBrier.reduce((sum, item) => sum + Number(item.brierScore || 0), 0) / withBrier.length).toFixed(3)
      : "-";
    const withLogLoss = evaluatedHistory.filter((item) => item.logLoss != null && Number.isFinite(Number(item.logLoss)));
    const avgLogLoss = withLogLoss.length
      ? (withLogLoss.reduce((sum, item) => sum + Number(item.logLoss || 0), 0) / withLogLoss.length).toFixed(3)
      : "-";
    const withRoi = evaluatedHistory.filter((item) => item.roi != null && Number.isFinite(Number(item.roi)));
    const roiTotal = withRoi.length
      ? `${(withRoi.reduce((sum, item) => sum + Number(item.roi || 0), 0) * 100).toFixed(1)}%`
      : "geen odds";
    const oddsCoverage = total
      ? `${((evaluatedHistory.filter((item) => item.oddsStatus === "available" || item.oddsStatus === "partial" || (item.roi != null && Number.isFinite(Number(item.roi)))).length / total) * 100).toFixed(0)}%`
      : "0%";
    const snapshotCoverage = total
      ? `${((history.filter((item) => item.predictionId && item.evaluationSource === "prediction_snapshot").length / total) * 100).toFixed(0)}%`
      : "0%";

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

    const byLeague = (Object.entries(
      evaluatedHistory.reduce((acc: Record<string, { exact: number; outcome: number; total: number; topChance: number }>, item) => {
        const league = item.league || "Onbekend";
        if (!acc[league]) acc[league] = { exact: 0, outcome: 0, total: 0, topChance: 0 };
        acc[league].total += 1;
        if (item.wasCorrect) acc[league].exact += 1;
        if (item.winnerCorrect) acc[league].outcome += 1;
        if (item.topChanceCorrect) acc[league].topChance += 1;
        return acc;
      }, {})
    ) as Array<[string, LeagueHistoryStats]>)
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

    const topFiveItems = evaluatedHistory.filter((item) => item.topExactScorePick || (Number(item.bestBetRank || 0) > 0 && Number(item.bestBetRank || 0) <= 5));
    const topFiveTotal = topFiveItems.length;
    const topFiveExact = topFiveItems.filter((item) => item.wasCorrect).length;
    const topFiveOutcome = topFiveItems.filter((item) => item.winnerCorrect).length;
    const topFiveGoalErrors = topFiveItems.filter((item) => item.errorMargin != null && Number.isFinite(Number(item.errorMargin)));
    const topFiveAvgError = topFiveGoalErrors.length
      ? (topFiveGoalErrors.reduce((sum, item) => sum + Number(item.errorMargin), 0) / topFiveGoalErrors.length).toFixed(2)
      : "-";

    const clubMap = new Map<string, { team: string; total: number; exact: number; outcome: number; avgError: number }>();
    for (const item of evaluatedHistory) {
      for (const team of [item.homeTeam, item.awayTeam]) {
        const name = String(team || "").trim();
        if (!name) continue;
        const current = clubMap.get(name) || { team: name, total: 0, exact: 0, outcome: 0, avgError: 0 };
        current.total += 1;
        if (item.wasCorrect) current.exact += 1;
        if (item.winnerCorrect) current.outcome += 1;
        current.avgError += Number(item.errorMargin || 0);
        clubMap.set(name, current);
      }
    }
    const topClubs = [...clubMap.values()]
      .filter((item) => item.total >= 2)
      .map((item) => ({
        ...item,
        exactPct: Math.round((item.exact / item.total) * 100),
        outcomePct: Math.round((item.outcome / item.total) * 100),
        avgError: Number((item.avgError / item.total).toFixed(2)),
      }))
      .sort((a, b) => b.exactPct - a.exactPct || b.exact - a.exact || b.outcomePct - a.outcomePct || b.total - a.total)
      .slice(0, 10);

    return {
      total,
      exactCorrect,
      outcomeCorrect,
      exactPct: total ? ((exactCorrect / total) * 100).toFixed(1) : "0.0",
      outcomePct: total ? ((outcomeCorrect / total) * 100).toFixed(1) : "0.0",
      avgError,
      avgBrier,
      avgLogLoss,
      roiTotal,
      oddsCoverage,
      snapshotCoverage,
      bestStreak,
      byLeague,
      topFive: {
        total: topFiveTotal,
        exact: topFiveExact,
        outcome: topFiveOutcome,
        exactPct: topFiveTotal ? ((topFiveExact / topFiveTotal) * 100).toFixed(1) : "0.0",
        outcomePct: topFiveTotal ? ((topFiveOutcome / topFiveTotal) * 100).toFixed(1) : "0.0",
        avgError: topFiveAvgError,
      },
      topClubs,
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
    () => history.filter((item) => parseScoreline(item.prediction) && parseScoreline(item.actual) && !item.wasCorrect && !item.winnerCorrect).length,
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
          <p className="text-slate-500 text-xs mt-0.5">
            {stats.total.toLocaleString()} reviews zichtbaar
            {snapshotSummary ? ` - ${snapshotSummary.total.toLocaleString()} opgeslagen voorspelling-snapshots` : ""}
            {serverTotal > stats.total ? ` - ${serverTotal.toLocaleString()} serverreviews doorzoekbaar` : ""}
          </p>
        </div>
        <button
          onClick={clearHistory}
          className="px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-black uppercase hover:bg-red-500/20 transition"
        >
          Lokale cache wissen
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        {[
          { label: "Totaal", value: stats.total.toLocaleString(), color: "text-blue-400" },
          { label: "Opgeslagen", value: snapshotSummary ? snapshotSummary.total.toLocaleString() : "-", color: "text-indigo-300" },
          { label: "Nog te beoordelen", value: snapshotSummary ? snapshotSummary.pending.toLocaleString() : "-", color: "text-amber-300" },
          { label: "Juiste score", value: `${stats.exactPct}%`, color: "text-green-400" },
          { label: "Juiste winnaar/gelijk", value: `${stats.outcomePct}%`, color: "text-emerald-400" },
          { label: "Gem. foutmarge", value: stats.avgError, color: "text-purple-400" },
          { label: "Brier", value: stats.avgBrier, color: "text-cyan-400" },
          { label: "Log loss", value: stats.avgLogLoss, color: "text-orange-300" },
          { label: "ROI", value: stats.roiTotal, color: "text-lime-300" },
          { label: "Odds", value: stats.oddsCoverage, color: "text-teal-300" },
          { label: "Snapshots", value: stats.snapshotCoverage, color: "text-sky-300" },
          { label: "Beste reeks", value: `${stats.bestStreak}`, color: "text-yellow-400" },
        ].map((item) => (
          <div key={item.label} className="glass-card p-4 rounded-2xl border border-white/5">
            <div className={`text-[9px] font-black uppercase mb-1 ${item.color}`}>{item.label}</div>
            <div className={`${String(item.value).length > 7 ? "text-lg" : "text-2xl"} font-black text-white truncate`}>{item.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="glass-card p-4 rounded-2xl border border-emerald-500/15 bg-emerald-500/5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="text-[10px] font-black text-emerald-300 uppercase">Model-feedback uit opgeslagen voorspellingen</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Compacte aggregatie uit {serverSummary?.total?.toLocaleString() || stats.total.toLocaleString()} reviews; details blijven gepagineerd.
              </div>
            </div>
            <div className="rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] font-black text-emerald-200">
              {serverSummary?.snapshotCoveragePct ?? Number(stats.snapshotCoverage.replace("%", ""))}% snapshots
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <div className="rounded-xl bg-slate-950/40 border border-white/5 p-3">
              <div className="text-[8px] font-black text-slate-500 uppercase">Exact</div>
              <div className="text-2xl font-black text-white mt-1">{serverSummary?.exactPct ?? stats.exactPct}%</div>
            </div>
            <div className="rounded-xl bg-slate-950/40 border border-white/5 p-3">
              <div className="text-[8px] font-black text-slate-500 uppercase">1X2</div>
              <div className="text-2xl font-black text-white mt-1">{serverSummary?.outcomePct ?? stats.outcomePct}%</div>
            </div>
            <div className="rounded-xl bg-slate-950/40 border border-white/5 p-3">
              <div className="text-[8px] font-black text-slate-500 uppercase">Oddsdekking</div>
              <div className="text-2xl font-black text-white mt-1">{serverSummary?.oddsDiagnostics?.predictionOddsCoveragePct ?? serverSummary?.oddsCoveragePct ?? Number(stats.oddsCoverage.replace("%", ""))}%</div>
              {serverSummary?.oddsDiagnostics && (
                <div className="text-[8px] text-slate-500">
                  {serverSummary.oddsDiagnostics.predictionOdds}/{serverSummary.oddsDiagnostics.predictionSnapshots} snapshots
                </div>
              )}
            </div>
            <div className="rounded-xl bg-slate-950/40 border border-white/5 p-3">
              <div className="text-[8px] font-black text-slate-500 uppercase">Brier</div>
              <div className="text-2xl font-black text-white mt-1">{serverSummary?.avgBrier ?? stats.avgBrier}</div>
            </div>
          </div>
          {!!serverSummary?.recommendations?.length && (
            <div className="mb-3 rounded-xl border border-amber-400/20 bg-amber-950/20 p-3">
              <div className="mb-1 text-[8px] font-black uppercase text-amber-200">Automatische verbeteracties</div>
              <div className="space-y-1">
                {serverSummary.recommendations.slice(0, 4).map((item) => (
                  <div key={item} className="text-[9px] font-bold text-amber-50/90">{item}</div>
                ))}
              </div>
            </div>
          )}
          {serverSummary?.oddsDiagnostics?.nextAction && (
            <div className="mb-3 rounded-xl border border-teal-400/15 bg-teal-950/15 p-3 text-[9px] text-teal-50/90">
              <span className="font-black text-teal-200">Odds actie:</span> {serverSummary.oddsDiagnostics.nextAction}
            </div>
          )}
          <div className="space-y-2">
            {(serverSummary?.byModel || []).slice(0, 4).map((model) => (
              <div key={model.key} className="rounded-xl bg-slate-950/35 border border-white/5 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[10px] font-black text-white">{model.key}</div>
                    <div className="text-[8px] text-slate-500">{model.total} reviews - {model.biasSummary || "bias onbekend"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[12px] font-black text-emerald-200">{model.outcomePct}% 1X2</div>
                    <div className="text-[8px] text-slate-500">exact {model.exactPct}%</div>
                  </div>
                </div>
              </div>
            ))}
            {!(serverSummary?.byModel || []).length && (
              <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/30 p-3 text-[11px] font-bold text-slate-500">
                Nog geen modelaggregatie beschikbaar vanuit de serverhistorie.
              </div>
            )}
          </div>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-yellow-500/15 bg-yellow-500/5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="text-[10px] font-black text-yellow-300 uppercase">Top 5 exacte-score tips monitor</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Alle dagelijkse top-5 keuzes achteraf gecontroleerd</div>
            </div>
            <div className="rounded-full bg-yellow-500/15 px-3 py-1 text-[10px] font-black text-yellow-200">
              {stats.topFive.total} reviews
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-slate-950/40 border border-white/5 p-3">
              <div className="text-[8px] font-black text-slate-500 uppercase">Juiste score</div>
              <div className="text-2xl font-black text-white mt-1">{stats.topFive.exactPct}%</div>
              <div className="text-[9px] text-slate-500">{stats.topFive.exact}/{stats.topFive.total}</div>
            </div>
            <div className="rounded-xl bg-slate-950/40 border border-white/5 p-3">
              <div className="text-[8px] font-black text-slate-500 uppercase">Winnaar/gelijk</div>
              <div className="text-2xl font-black text-white mt-1">{stats.topFive.outcomePct}%</div>
              <div className="text-[9px] text-slate-500">{stats.topFive.outcome}/{stats.topFive.total}</div>
            </div>
            <div className="rounded-xl bg-slate-950/40 border border-white/5 p-3">
              <div className="text-[8px] font-black text-slate-500 uppercase">Foutmarge</div>
              <div className="text-2xl font-black text-white mt-1">{stats.topFive.avgError}</div>
              <div className="text-[9px] text-slate-500">lager is beter</div>
            </div>
          </div>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-cyan-500/15 bg-cyan-500/5">
          <div className="mb-3">
            <div className="text-[10px] font-black text-cyan-300 uppercase">Datakwaliteit versus resultaat</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Laat zien waar voorspellingen betrouwbaarder of juist riskant zijn.</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(serverSummary?.byDataQuality || []).map((bucket) => (
              <div key={bucket.key} className="rounded-xl bg-slate-950/40 border border-white/5 p-3">
                <div className="text-[8px] font-black text-slate-500 uppercase">Data {bucket.key}</div>
                <div className="mt-1 text-xl font-black text-white">{bucket.outcomePct}%</div>
                <div className="text-[9px] text-slate-500">{bucket.total} reviews - foutmarge {bucket.avgGoalError}</div>
                <div className="mt-1 text-[8px] text-slate-400">{bucket.biasSummary}</div>
              </div>
            ))}
            {!(serverSummary?.byDataQuality || []).length && (
              <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/30 p-3 text-[11px] font-bold text-slate-500 sm:col-span-3">
                Datakwaliteit wordt gevuld zodra reviews sourceReliability/qualityGate meenemen.
              </div>
            )}
          </div>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-blue-500/15 bg-blue-500/5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="text-[10px] font-black text-blue-300 uppercase">Top 10 clubs op winnaar/gelijk · laatste 10 duels</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Volledige historie per club, gesorteerd op hoogste 1X2-score</div>
            </div>
          </div>
          {rankClubs(serverSummary, stats.topClubs).length === 0 ? (
            <div className="text-[12px] text-slate-500 font-bold py-6">Nog te weinig clubdata om patronen betrouwbaar te tonen.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {rankClubs(serverSummary, stats.topClubs).map((club, index) => (
                <div key={club.team} className="rounded-xl bg-slate-950/40 border border-white/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black text-white truncate">#{index + 1} {club.team}</div>
                      <div className="text-[8px] text-slate-500">{club.outcome}/{club.total} winnaar ? uitkomst {club.outcomePct}%</div>
                    </div>
                    <div className="text-sm font-black text-green-300">{club.outcomePct}%</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
                    Score goed {item.exact}/{item.total} - Uitkomst goed {item.outcome}/{item.total}
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
          placeholder="Zoek op clubnaam of competitie..."
          className="flex-1 bg-slate-900/60 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 outline-none focus:border-blue-500/40"
        />
      </div>

      {dossierLoading && search.trim().length >= 2 && (
        <div className="text-[10px] font-bold text-slate-500">Clubgeschiedenis laden...</div>
      )}

      {dossierError && search.trim().length >= 2 && (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-[11px] font-bold text-rose-200">
          Clubgegevens laden mislukt: {dossierError}
        </div>
      )}

      {dossier && (dossier.matches || []).length > 0 && (
        <div className="glass-card rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase text-cyan-300">Clubdossier uit de geschiedenis</div>
              <div className="truncate text-lg font-black text-white">{dossier.team || search.trim()}</div>
              <div className="text-[10px] text-slate-500">
                Alle opgeslagen wedstrijden van deze club met voorspelling, uitslag en beoordeling.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSearch("")}
              className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-[10px] font-black text-slate-200 hover:bg-slate-700"
            >
              Sluiten
            </button>
          </div>

          {dossier.summary && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  {
                    label: "1X2 goed",
                    value: `${Math.round(dossier.summary.outcomePct)}%`,
                    detail: `${dossier.summary.outcomeHits}/${dossier.summary.outcomeEvaluated}`,
                    tone: dossierTone(dossier.summary.outcomePct),
                  },
                  {
                    label: "Exact goed",
                    value: `${Math.round(dossier.summary.exactPct)}%`,
                    detail: `${dossier.summary.exactHits}/${dossier.summary.exactEvaluated}`,
                    tone: dossierTone(dossier.summary.exactPct),
                  },
                  {
                    label: "Winst-gelijk-verlies",
                    value: `${dossier.summary.wins}-${dossier.summary.draws}-${dossier.summary.losses}`,
                    detail: `${dossier.summary.matches} wedstrijden`,
                    tone: "text-white",
                  },
                  {
                    label: "Doelpunten",
                    value: `${dossier.summary.goalsFor}-${dossier.summary.goalsAgainst}`,
                    detail: "voor-tegen",
                    tone: "text-white",
                  },
                  {
                    label: "Foutmarge",
                    value: dossier.summary.avgGoalError != null ? String(dossier.summary.avgGoalError) : "-",
                    detail: "lager is beter",
                    tone: "text-amber-200",
                  },
                  {
                    label: "Top pick goed",
                    value: `${Math.round(dossier.summary.topPickPct)}%`,
                    detail: `${dossier.summary.topPickHits}/${dossier.summary.topPickEvaluated}`,
                    tone: dossierTone(dossier.summary.topPickPct),
                  },
                ].map((card) => (
                  <div key={card.label} className="rounded-xl border border-white/5 bg-slate-950/40 px-3 py-2">
                    <div className="text-[8px] font-black uppercase text-slate-500">{card.label}</div>
                    <div className={`text-xl font-black ${card.tone}`}>{card.value}</div>
                    <div className="text-[8px] text-slate-500">{card.detail}</div>
                  </div>
                ))}
              </div>

              {dossier.summary.leagues.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {dossier.summary.leagues.map((entry) => (
                    <span
                      key={entry.league}
                      className="rounded-full border border-white/10 bg-slate-950/50 px-2 py-0.5 text-[8px] font-black text-slate-300"
                    >
                      {entry.league} · {entry.matches}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {(dossier.matches || []).map((match) => (
                  <div
                    key={`${match.matchId}-${match.date}`}
                    className="rounded-xl border border-white/5 bg-slate-950/40 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[9px] font-bold text-slate-500">
                          {match.date} · {match.league || "onbekende competitie"}
                        </div>
                        <div className="text-[11px] font-black text-white">
                          <span className={match.venue === "home" ? "text-cyan-200" : ""}>{match.homeTeam}</span>
                          <span className="mx-1 text-slate-500">-</span>
                          <span className={match.venue === "away" ? "text-cyan-200" : ""}>{match.awayTeam}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[10px] font-black">
                        <span className="text-slate-400">uitslag</span>
                        <span className="text-white">{match.actualScore || "-"}</span>
                        <span className="text-slate-600">·</span>
                        <span className="text-slate-400">voorspeld</span>
                        <span className="text-yellow-300">{match.predictedScore || "-"}</span>
                        <span className={`rounded-full border px-1.5 py-0.5 text-[8px] ${hitBadge(match.outcomeHit)}`}>
                          {match.outcomeHit === true ? "1X2 goed" : match.outcomeHit === false ? "1X2 fout" : "1X2 -"}
                        </span>
                        <span className={`rounded-full border px-1.5 py-0.5 text-[8px] ${hitBadge(match.exactHit)}`}>
                          {match.exactHit === true ? "exact goed" : match.exactHit === false ? "exact fout" : "exact -"}
                        </span>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[8px] font-bold text-slate-500">
                      <span>tegen {match.opponent}</span>
                      <span>{match.venue === "home" ? "thuis" : "uit"}</span>
                      <span>resultaat {match.result || "-"}</span>
                      <span>
                        1X2 voorspeld {outcomeLabel(match.predictedOutcome)} / werkelijk {outcomeLabel(match.actualOutcome)}
                      </span>
                      {match.probabilityOutcome && <span>kans-1X2 {outcomeLabel(match.probabilityOutcome)}</span>}
                      {match.topPickHit != null && <span>top pick {match.topPickHit ? "goed" : "fout"}</span>}
                      {match.goalError != null && <span>doelpuntfout {match.goalError}</span>}
                      {match.confidence != null && <span>confidence {Math.round(Number(match.confidence) * 100)}%</span>}
                      {match.exactScoreConfidence != null && (
                        <span>exact-confidence {Math.round(Number(match.exactScoreConfidence) * 100)}%</span>
                      )}
                      {match.brierScore != null && <span>brier {Number(match.brierScore).toFixed(3)}</span>}
                      {match.logLoss != null && <span>log loss {Number(match.logLoss).toFixed(3)}</span>}
                      {match.oddsStatus && <span>odds {match.oddsStatus}</span>}
                      {match.modelVersion && <span>model {match.modelVersion}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {serverTotal > history.length && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-500/15 bg-blue-500/5 px-4 py-3">
          <div>
            <div className="text-[10px] font-black uppercase text-blue-200">Meer evaluaties beschikbaar</div>
            <div className="text-[11px] text-slate-500">
              {history.length.toLocaleString()} geladen van {serverTotal.toLocaleString()} serverreviews. Filteren werkt op geladen data; het clubdossier zoekt in de volledige historie.
            </div>
          </div>
          <button
            type="button"
            onClick={loadMoreHistory}
            disabled={loadingMore}
            className="rounded-xl bg-blue-600 px-3 py-2 text-[10px] font-black text-white disabled:opacity-50"
          >
            {loadingMore ? "Laden..." : "Meer laden"}
          </button>
        </div>
      )}

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
              {items.length} wedstrijden op deze pagina - Score {leagueStats?.exactPct ?? 0}% - Uitkomst {leagueStats?.outcomePct ?? 0}%
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
                        key={item.predictionId || item.matchId}
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
                    {item.league} - {new Date(item.timestamp).toLocaleString("nl-NL")}
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
                    {item.predictedOutcome} {"->"} {item.actualOutcome}
                              </div>
                            </div>
                            <div className="rounded-xl bg-slate-900/40 border border-white/5 px-3 py-2">
                              <div className="text-[8px] font-black text-slate-500 uppercase">Foutmarge</div>
                              <div className="text-[22px] font-black text-white mt-1">{item.errorMargin}</div>
                            </div>
                          </div>
                        </div>
                        {(item.brierScore != null || item.logLoss != null || item.predictionId || item.oddsStatus) && (
                          <div className="mt-3 grid grid-cols-2 md:grid-cols-6 gap-2">
                            <div className="rounded-xl bg-slate-950/35 border border-white/5 px-3 py-2">
                              <div className="text-[8px] font-black text-slate-500 uppercase">Brier</div>
                              <div className="text-[13px] font-black text-cyan-200 mt-1">{item.brierScore ?? "-"}</div>
                            </div>
                            <div className="rounded-xl bg-slate-950/35 border border-white/5 px-3 py-2">
                              <div className="text-[8px] font-black text-slate-500 uppercase">Log loss</div>
                              <div className="text-[13px] font-black text-orange-200 mt-1">{item.logLoss ?? "-"}</div>
                            </div>
                            <div className="rounded-xl bg-slate-950/35 border border-white/5 px-3 py-2">
                              <div className="text-[8px] font-black text-slate-500 uppercase">ROI</div>
                              <div className="text-[13px] font-black text-lime-200 mt-1">
                                {formatRoi(item)}
                              </div>
                            </div>
                            <div className="rounded-xl bg-slate-950/35 border border-white/5 px-3 py-2">
                              <div className="text-[8px] font-black text-slate-500 uppercase">Odds</div>
                              <div className="text-[11px] font-black text-teal-200 mt-1 truncate" title={item.oddsMissingReason || undefined}>
                                {formatOddsStatus(item)}
                              </div>
                            </div>
                            <div className="rounded-xl bg-slate-950/35 border border-white/5 px-3 py-2">
                              <div className="text-[8px] font-black text-slate-500 uppercase">Snapshot</div>
                              <div className="text-[11px] font-black text-sky-200 mt-1 truncate">
                                {formatSnapshotStatus(item)}
                              </div>
                            </div>
                            <div className="rounded-xl bg-slate-950/35 border border-white/5 px-3 py-2">
                              <div className="text-[8px] font-black text-slate-500 uppercase">Cutoff</div>
                              <div className="text-[11px] font-black text-white mt-1 truncate">
                                {item.cutoffAt ? new Date(item.cutoffAt).toLocaleString("nl-NL") : "-"}
                              </div>
                            </div>
                          </div>
                        )}
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
