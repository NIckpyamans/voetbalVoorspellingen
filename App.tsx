import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header";
import BestBetCard from "./components/BestBetCard";
import CompactMatchRow from "./components/CompactMatchRow";
import DateNavigation from "./components/DateNavigation"; // NIEUW IMPORT
import { getFavorites } from "./components/FavoriteTeams";
import { Match } from "./types";
import { velocityEngine } from "./services/velocityEngine";
import { getOrCreateTeam, saveToMemory, updateTeamModelsFromResult } from "./services/geminiService";
import { todayAmsterdamKey } from "./shared/date.js";
import { logClientWarning } from "./shared/clientLogger";
import { isMatchFinished, isMatchLive } from "./shared/matchStatus.js";
import {
  DashboardHistoryItem,
  LEAGUE_ORDER,
  belongsToSelectedDate,
  buildLeaguePerformance,
  buildWagerReadiness,
  formatDateLabel,
  hydrateDashboardHistory,
  isoDate,
  mergeDashboardHistory,
  pct,
  shortLeague,
} from "./shared/dashboard.js";
import { filterVisibleMatches, filterVisiblePredictionMap } from "./shared/competitionVisibility.js";

type View = "dashboard" | "knowledge" | "history" | "standings" | "modelops" | "integrity" | "providers" | "settings";
type FilterMode = "alle" | "favorieten" | "live" | "gepland" | "gespeeld" | "brondekking" | "odds" | "xg" | "weer" | "mistdata";

const MATCH_RENDER_BATCH = 80;

const PredictionHistory = lazy(() => import("./components/PredictionHistory"));
const MatchCard = lazy(() => import("./components/MatchCard"));
const StandingsView = lazy(() => import("./components/StandingsView"));
const SettingsView = lazy(() => import("./components/SettingsView"));
const ModelOpsView = lazy(() => import("./components/ModelOpsView"));
const DataIntegrityView = lazy(() => import("./components/DataIntegrityView"));
const ProviderControlView = lazy(() => import("./components/ProviderControlView"));
const KnowledgeView = lazy(() => import("./components/KnowledgeView"));

function ViewFallback() {
  return <div className="glass-card rounded-2xl p-8 text-center text-sm font-bold text-slate-400">Onderdeel laden...</div>;
}

function isLive(match: Match) {
  return isMatchLive(match);
}

function isFinished(match: Match) {
  return isMatchFinished(match);
}

const DASHBOARD_TEAM_ALIASES: Record<string, string> = {
  "sc freiburg": "freiburg",
  "sport club freiburg": "freiburg",
  freiburg: "freiburg",
  "aston villa fc": "aston villa",
  "aston villa": "aston villa",
  "man city": "manchester city",
  "manchester city fc": "manchester city",
  "manchester city": "manchester city",
  psg: "paris saint-germain",
  "paris saint germain": "paris saint-germain",
  "paris saint-germain": "paris saint-germain",
  barca: "barcelona",
  "fc barcelona": "barcelona",
  barcelona: "barcelona",
  "athletic bilbao": "athletic club",
  "athletic club": "athletic club",
  "crystal palace fc": "crystal palace",
  "crystal palace": "crystal palace",
};

function normalizeDashboardDedupeText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(fc|cf|sc|afc|club|voetbalclub)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function canonicalDashboardTeam(value: unknown) {
  const normalized = normalizeDashboardDedupeText(value);
  return DASHBOARD_TEAM_ALIASES[normalized] || normalized;
}

function canonicalDashboardLeague(value: unknown) {
  const normalized = normalizeDashboardDedupeText(value)
    .replace(/\buefa\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const aliases: Record<string, string> = {
    "europe europa league": "europe europa league",
    "europa league": "europe europa league",
    "europe champions league": "europe champions league",
    "champions league": "europe champions league",
    "europe conference league": "europe conference league",
    "conference league": "europe conference league",
  };

  return aliases[normalized] || normalized;
}

function dashboardDateKey(value: unknown) {
  const raw = String(value || "");
  const direct = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

function buildDashboardMatchKey(match: Pick<Match, "date" | "kickoff" | "league" | "homeTeamName" | "awayTeamName">) {
  return [
    dashboardDateKey(match.kickoff || match.date),
    canonicalDashboardLeague(match.league),
    canonicalDashboardTeam(match.homeTeamName),
    canonicalDashboardTeam(match.awayTeamName),
  ].join("|");
}

function dashboardMatchQuality(match: Match) {
  let score = 0;
  if (match.score && match.score !== "VS") score += 50;
  if (isFinished(match)) score += 40;
  if (isLive(match)) score += 30;
  if (match.homeLogo && !match.homeLogo.startsWith("data:")) score += 5;
  if (match.awayLogo && !match.awayLogo.startsWith("data:")) score += 5;
  if (match.h2h?.results?.length || match.h2h?.lastMatches?.length) score += 10;
  if ((match as any).dataCompletenessScore) score += Number((match as any).dataCompletenessScore);
  return score;
}

function freeSourceCoveragePercent(match: Match) {
  const coverage = match.freeSourceCoverage || match.sourceCoverage || (match as any).sourceCoverage;
  if (coverage?.percent != null || coverage?.score != null) {
    return Number(coverage?.percent ?? coverage.score * 100);
  }
  const observed = [
    Boolean(match.id && match.homeTeamName && match.awayTeamName && (match.kickoff || match.date)),
    Boolean(match.score || match.homeScore != null || match.awayScore != null),
    Boolean(match.h2h?.played || match.h2h?.results?.length || match.h2h?.lastMatches?.length),
    Boolean(match.homeForm || match.awayForm || match.homeRecent?.recentMatches?.length || match.awayRecent?.recentMatches?.length),
    Boolean((match as any).homePos != null || (match as any).awayPos != null),
    hasWeatherData(match),
    hasXgData(match),
    hasOddsData(match),
  ];
  return Math.round((observed.filter(Boolean).length / observed.length) * 100);
}

function hasCoverageEntry(match: Match, key: string) {
  const coverage = match.freeSourceCoverage || match.sourceCoverage || (match as any).sourceCoverage;
  const entries = Array.isArray(coverage?.entries) ? coverage.entries : [];
  return entries.some((entry: any) => entry.key === key && entry.available);
}

function hasOddsData(match: Match) {
  return Boolean((match as any).hasOdds) || hasCoverageEntry(match, "odds") || Number((match as any).dbFeatureContext?.historicalOdds?.samples || 0) > 0;
}

function hasXgData(match: Match) {
  const stats = (match as any).dbFeatureContext?.matchStats || {};
  return Boolean((match as any).hasXg) || hasCoverageEntry(match, "xg_style") || stats.homeXg != null || stats.awayXg != null || Number(stats.homeShots || 0) > 0 || Number(stats.awayShots || 0) > 0;
}

function hasWeatherData(match: Match) {
  return Boolean((match as any).hasWeather) || hasCoverageEntry(match, "weather") || Boolean(match.weather?.conditions || match.weather?.temperature != null);
}

function dedupeDashboardMatches(items: Match[]) {
  const byFixture = new Map<string, Match>();
  for (const match of items) {
    const key = buildDashboardMatchKey(match);
    const current = byFixture.get(key);
    if (!current || dashboardMatchQuality(match) > dashboardMatchQuality(current)) {
      byFixture.set(key, match);
    }
  }
  return Array.from(byFixture.values());
}

function buildDashboardBetKey(bet: { date?: string; league?: string; homeTeam?: string; awayTeam?: string }) {
  return [
    dashboardDateKey(bet.date),
    canonicalDashboardLeague(bet.league),
    canonicalDashboardTeam(bet.homeTeam),
    canonicalDashboardTeam(bet.awayTeam),
  ].join("|");
}

function dashboardBetQuality(bet: any) {
  const rank = Number(bet.bestBetRank || 0);
  const rankScore = rank > 0 ? 1000 - rank : 0;
  return rankScore + Number(bet.exactScoreConfidence || 0) * 100 + Number(bet.confidence || 0) * 20;
}

function dedupeDashboardBets<T extends { date?: string; league?: string; homeTeam?: string; awayTeam?: string }>(items: T[]) {
  const byFixture = new Map<string, T>();
  for (const bet of items) {
    const key = buildDashboardBetKey(bet);
    const current = byFixture.get(key);
    if (!current || dashboardBetQuality(bet) > dashboardBetQuality(current)) {
      byFixture.set(key, bet);
    }
  }
  return Array.from(byFixture.values());
}

const App: React.FC = () => {
  const [view, setView] = useState<View>("dashboard");
  const [glassTransparency, setGlassTransparency] = useState<number>(() => {
    try {
      return Math.min(80, Math.max(15, Number(localStorage.getItem("footyai_glass_transparency") || 46)));
    } catch {
      return 46;
    }
  });
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return isoDate(new Date());
  });
  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Record<string, any>>({});
  const [standings, setStandings] = useState<Record<string, any>>({});
  const [historyItems, setHistoryItems] = useState<DashboardHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<"laden" | "klaar" | "fout">("laden");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [workerNeeded, setWorkerNeeded] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterMode>("alle");
  const [selectedLeague, setSelectedLeague] = useState<string>("alle");
  const [expandedTopClub, setExpandedTopClub] = useState<string | null>(null);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [visibleMatchLimit, setVisibleMatchLimit] = useState(MATCH_RENDER_BATCH);
  const [favRefresh, setFavRefresh] = useState(0);
  const learnedRef = useRef<Set<string>>(new Set());

  const refreshStandings = useCallback(() => {
    return fetch(`/api/standings?t=${Date.now()}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
          throw new Error(data.error || `Standen ophalen mislukt (${response.status})`);
        }
        setStandings(data.standings || {});
        setSyncMessage(null);
      })
      .catch((error) => {
        logClientWarning("standings_refresh_failed", { error });
        setSyncMessage("Standen konden niet worden ververst. De laatst bekende data blijft zichtbaar.");
      });
  }, []);

  useEffect(() => {
    const updateTransparency = () => {
      try {
        setGlassTransparency(Math.min(80, Math.max(15, Number(localStorage.getItem("footyai_glass_transparency") || 46))));
      } catch {
        setGlassTransparency(46);
      }
    };

    window.addEventListener("storage", updateTransparency);
    window.addEventListener("footyai-glass-change", updateTransparency);
    return () => {
      window.removeEventListener("storage", updateTransparency);
      window.removeEventListener("footyai-glass-change", updateTransparency);
    };
  }, []);

  useEffect(() => {
    refreshStandings();
    const timer = window.setInterval(refreshStandings, selectedDate === todayAmsterdamKey() ? 60_000 : 10 * 60_000);
    return () => window.clearInterval(timer);
  }, [refreshStandings, selectedDate]);

  useEffect(() => {
    let cancelled = false;

    const readLocal = () => {
      try {
        const raw = localStorage.getItem("footypredict_memory");
        return raw ? hydrateDashboardHistory(JSON.parse(raw)) : [];
      } catch {
        return [];
      }
    };

    fetch("/api/history?limit=750", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.error || `Historie ophalen mislukt (${response.status})`);
        return data;
      })
      .then((data) => {
        const serverItems = Array.isArray(data.items) ? hydrateDashboardHistory(data.items) : [];
        const localItems = readLocal();
        if (!cancelled) setHistoryItems(mergeDashboardHistory(localItems, serverItems));
      })
      .catch((error) => {
        logClientWarning("history_fetch_failed_local_fallback", { error });
        if (!cancelled) setHistoryItems(readLocal());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    setSyncStatus("laden");
    setSyncMessage(null);
    setWorkerNeeded(false);
    setMatches([]);
    setPredictions({});
    setExpandedMatchId(null);
    learnedRef.current.clear();

    const unsubscribe = velocityEngine.subscribe(({ matches: nextMatches, predictions: nextPredictions, lastRun: nextLastRun, workerNeeded: nextWorkerNeeded }) => {
      const visibleMatches = filterVisibleMatches(nextMatches);
      setMatches(visibleMatches);
      setPredictions(filterVisiblePredictionMap(nextPredictions, visibleMatches));
      setLoading(false);
      setSyncStatus("klaar");
      setWorkerNeeded(!!nextWorkerNeeded);
      setSyncMessage(nextWorkerNeeded ? "Workerdata is nog niet compleet voor deze datum." : null);
      if (nextLastRun) setLastRun(nextLastRun);
      if (nextMatches.some((match) => isLive(match) || isFinished(match))) {
        refreshStandings();
      }

      for (const match of nextMatches) {
        if (!isFinished(match) || !match.score?.includes("-") || learnedRef.current.has(match.id)) continue;
        const prediction = nextPredictions[match.id];
        if (!prediction) continue;

        saveToMemory(match.id, `${prediction.predHomeGoals}-${prediction.predAwayGoals}`, match.score, match, prediction);
        const home = getOrCreateTeam({
          id: match.homeTeamId,
          name: match.homeTeamName,
          league: match.league,
          logo: match.homeLogo,
        });
        const away = getOrCreateTeam({
          id: match.awayTeamId,
          name: match.awayTeamName,
          league: match.league,
          logo: match.awayLogo,
        });

        updateTeamModelsFromResult(match, home, away);
        learnedRef.current.add(match.id);
      }
    });

    velocityEngine.startPulse(selectedDate);

    return () => {
      unsubscribe();
      velocityEngine.stopPulse();
    };
  }, [selectedDate]);

  const standingsMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const table of Object.values(standings) as any[]) {
      for (const row of table.rows || []) {
        if (row.teamId) map[row.teamId] = row.pos;
      }
    }
    return map;
  }, [standings]);

  const enrichMatch = useCallback(
    (match: Match) => ({
      ...match,
      homePos: standingsMap[(match as any).homeTeamId] || (match as any).homePos || null,
      awayPos: standingsMap[(match as any).awayTeamId] || (match as any).awayPos || null,
    }),
    [standingsMap]
  );

  const favoriteTeams = useMemo(() => getFavorites(), [favRefresh]);

  const dayMatches = useMemo(
    () => dedupeDashboardMatches(matches.filter((match) => belongsToSelectedDate(match, selectedDate))),
    [matches, selectedDate]
  );

  const filteredMatches = useMemo(() => {
    const leagueScoped =
      selectedLeague === "alle"
        ? dayMatches
        : dayMatches.filter((match) => match.league === selectedLeague);

    if (activeFilter === "live") return leagueScoped.filter(isLive);
    if (activeFilter === "gepland") return leagueScoped.filter((match) => !isLive(match) && !isFinished(match));
    if (activeFilter === "gespeeld") return leagueScoped.filter(isFinished);
    if (activeFilter === "brondekking") return leagueScoped.filter((match) => freeSourceCoveragePercent(match) >= 60);
    if (activeFilter === "odds") return leagueScoped.filter(hasOddsData);
    if (activeFilter === "xg") return leagueScoped.filter(hasXgData);
    if (activeFilter === "weer") return leagueScoped.filter(hasWeatherData);
    if (activeFilter === "mistdata") {
      return leagueScoped.filter((match) => freeSourceCoveragePercent(match) < 60 || !hasOddsData(match) || !hasXgData(match) || !hasWeatherData(match));
    }

    if (activeFilter === "favorieten") {
      return leagueScoped.filter((match) => {
        const homeKey = (match as any).homeTeamId || match.homeTeamName.toLowerCase();
        const awayKey = (match as any).awayTeamId || match.awayTeamName.toLowerCase();
        return favoriteTeams.includes(homeKey) || favoriteTeams.includes(awayKey);
      });
    }

    return leagueScoped;
  }, [dayMatches, activeFilter, selectedLeague, favoriteTeams]);

  const sortedMatches = useMemo(() => {
    return [...filteredMatches].sort((a, b) => {
      if (["brondekking", "odds", "xg", "weer", "mistdata"].includes(activeFilter)) return freeSourceCoveragePercent(b) - freeSourceCoveragePercent(a);
      const aIdx = LEAGUE_ORDER.indexOf(a.league);
      const bIdx = LEAGUE_ORDER.indexOf(b.league);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.league.localeCompare(b.league);
    });
  }, [filteredMatches, activeFilter]);

  useEffect(() => {
    setVisibleMatchLimit(MATCH_RENDER_BATCH);
  }, [selectedDate, selectedLeague, activeFilter]);

  const visibleSortedMatches = useMemo(
    () => sortedMatches.slice(0, visibleMatchLimit),
    [sortedMatches, visibleMatchLimit]
  );

  const allLeagues = useMemo(() => {
    const uniqueLeagues = Array.from(new Set(dayMatches.map((match) => match.league))) as string[];
    return uniqueLeagues.sort((a, b) => {
      const aIdx = LEAGUE_ORDER.indexOf(a);
      const bIdx = LEAGUE_ORDER.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [dayMatches]);

  const leagueSummaries = useMemo(() => {
    const byLeague = new Map<string, {
      total: number;
      live: number;
      planned: number;
      finished: number;
      coverage: number;
      coverageTotal: number;
      odds: number;
      xg: number;
      weather: number;
      missing: number;
      providerSet: Set<string>;
      providers: string[];
    }>();

    for (const match of dayMatches) {
      const league = match.league;
      const current = byLeague.get(league) || {
        total: 0,
        live: 0,
        planned: 0,
        finished: 0,
        coverage: 0,
        coverageTotal: 0,
        odds: 0,
        xg: 0,
        weather: 0,
        missing: 0,
        providerSet: new Set<string>(),
        providers: [],
      };
      const coveragePercent = freeSourceCoveragePercent(match);
      const hasOdds = hasOddsData(match);
      const hasXg = hasXgData(match);
      const hasWeather = hasWeatherData(match);
      const live = isLive(match);
      const finished = isFinished(match);
      const coverage = (match as any).freeSourceCoverage || (match as any).sourceCoverage || {};
      const sources = [
        ...(Array.isArray(coverage.sources) ? coverage.sources : []),
        ...(Array.isArray(coverage.providers) ? coverage.providers : []),
        ...(Array.isArray(coverage.backupSources) ? coverage.backupSources : []),
      ];
      sources.filter(Boolean).slice(0, 6).forEach((source: string) => current.providerSet.add(String(source)));

      current.total += 1;
      current.live += live ? 1 : 0;
      current.planned += !live && !finished ? 1 : 0;
      current.finished += finished ? 1 : 0;
      current.coverageTotal += coveragePercent;
      current.odds += hasOdds ? 1 : 0;
      current.xg += hasXg ? 1 : 0;
      current.weather += hasWeather ? 1 : 0;
      current.missing += coveragePercent < 60 || !hasOdds || !hasXg || !hasWeather ? 1 : 0;

      byLeague.set(league, current);
    }

    for (const [league, summary] of byLeague.entries()) {
      byLeague.set(league, {
        ...summary,
        coverage: summary.total ? Math.round(summary.coverageTotal / summary.total) : 0,
        providers: Array.from(summary.providerSet).slice(0, 5),
      });
    }

    for (const league of allLeagues) {
      if (byLeague.has(league)) continue;
      const providerNames = new Set<string>();
      byLeague.set(league, {
        total: 0,
        live: 0,
        planned: 0,
        finished: 0,
        coverage: 0,
        coverageTotal: 0,
        odds: 0,
        xg: 0,
        weather: 0,
        missing: 0,
        providerSet: providerNames,
        providers: Array.from(providerNames).slice(0, 5),
      });
    }

    return byLeague;
  }, [allLeagues, dayMatches]);

  const selectedLeagueSummary = selectedLeague === "alle" ? null : leagueSummaries.get(selectedLeague) || null;

  const favoriteMatches = useMemo(() => {
    return dayMatches.filter((match) => {
      const homeKey = (match as any).homeTeamId || match.homeTeamName.toLowerCase();
      const awayKey = (match as any).awayTeamId || match.awayTeamName.toLowerCase();
      return favoriteTeams.includes(homeKey) || favoriteTeams.includes(awayKey);
    });
  }, [dayMatches, favoriteTeams]);

  const liveMatches = useMemo(() => sortedMatches.filter(isLive), [sortedMatches]);
  const plannedMatches = useMemo(() => sortedMatches.filter((match) => !isLive(match) && !isFinished(match)), [sortedMatches]);
  const finishedMatches = useMemo(() => sortedMatches.filter(isFinished), [sortedMatches]);

  const favoriteCount = favoriteMatches.length;
  const matchGridClass = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2.5";
  const liveCount = dayMatches.filter(isLive).length;
  const plannedCount = dayMatches.filter((match) => !isLive(match) && !isFinished(match)).length;
  const finishedCount = dayMatches.filter(isFinished).length;
  const sourceCoverageCount = dayMatches.filter((match) => freeSourceCoveragePercent(match) >= 60).length;
  const oddsCoverageCount = dayMatches.filter(hasOddsData).length;
  const xgCoverageCount = dayMatches.filter(hasXgData).length;
  const weatherCoverageCount = dayMatches.filter(hasWeatherData).length;
  const missingCoverageCount = dayMatches.filter((match) => freeSourceCoveragePercent(match) < 60 || !hasOddsData(match) || !hasXgData(match) || !hasWeatherData(match)).length;
  const leaguePerformance = useMemo(() => buildLeaguePerformance(historyItems), [historyItems]);

  const bestBets = useMemo(() => {
    const matchById = new Map<string, Match>();
    for (const match of dayMatches) matchById.set(match.id, match);
    const candidates = Object.entries(predictions as Record<string, any>)
      .filter(([matchId]) => {
        const match = matchById.get(matchId);
        return !!match;
      })
      .map(([matchId, pred]) => {
        const match = matchById.get(matchId);
        if (!match) return null;

        const homeProb = pred.homeProb || 0;
        const drawProb = pred.drawProb || 0;
        const awayProb = pred.awayProb || 0;
        const maxProb = Math.max(homeProb, drawProb, awayProb);
        const exactScoreConfidence = Number((pred as any).exactScoreConfidence || (match as any).exactScoreConfidence || pred.exactProb || 0);
        const rank = Number((pred as any).bestBetRank || (match as any).bestBetRank || 0) || null;

        return {
          matchId,
          date: match.kickoff || match.date,
          homeTeam: match.homeTeamName,
          awayTeam: match.awayTeamName,
          league: match.league,
          predHomeGoals: pred.predHomeGoals || 0,
          predAwayGoals: pred.predAwayGoals || 0,
          homeProb,
          drawProb,
          awayProb,
          confidence: pred.confidence || maxProb,
          exactProb: pred.exactProb,
          exactScoreConfidence,
          bestBetRank: rank,
          exactScoreReasons: (pred as any).exactScoreReasons || (match as any).exactScoreReasons || [],
          odds: (pred as any).odds || (match as any).odds || null,
          dataCompleteness: (pred as any).dataCompleteness || (match as any).dataCompleteness || null,
          dataCompletenessScore: (pred as any).dataCompletenessScore || (match as any).dataCompletenessScore || 0,
          qualityGate: (pred as any).qualityGate || (match as any).qualityGate || null,
          lineupSummary: (pred as any).lineupSummary || (match as any).lineupSummary || null,
          status: match.status,
          score: match.score,
        };
      })
      .filter((bet): bet is NonNullable<typeof bet> => bet !== null);

    return dedupeDashboardBets(candidates)
      .sort((a, b) => {
        if (a.bestBetRank && b.bestBetRank) return a.bestBetRank - b.bestBetRank;
        if (a.bestBetRank) return -1;
        if (b.bestBetRank) return 1;
        return (b.exactScoreConfidence || 0) - (a.exactScoreConfidence || 0) || (b.confidence || 0) - (a.confidence || 0);
      })
      .slice(0, 5)
      .map((bet) => ({
        ...bet,
        wagerReadiness: buildWagerReadiness(
          bet,
          leaguePerformance.rows.find((row) => row.league === bet.league) || null
        ),
      }));
  }, [predictions, dayMatches, leaguePerformance]);

  const dashboardInsights = useMemo(() => {
    const topFiveReviews = historyItems.filter((item) => item.topExactScorePick || (Number(item.bestBetRank || 0) > 0 && Number(item.bestBetRank || 0) <= 5));
    const otherReviews = historyItems.filter((item) => !(item.topExactScorePick || (Number(item.bestBetRank || 0) > 0 && Number(item.bestBetRank || 0) <= 5)));
    const topExact = topFiveReviews.filter((item) => item.wasCorrect).length;
    const topOutcome = topFiveReviews.filter((item) => item.winnerCorrect).length;
    const otherExact = otherReviews.filter((item) => item.wasCorrect).length;
    const topAvgError = topFiveReviews.length
      ? (topFiveReviews.reduce((sum, item) => sum + Number(item.errorMargin || 0), 0) / topFiveReviews.length).toFixed(2)
      : "0.00";
    const otherExactPct = pct(otherExact, otherReviews.length);
    const topExactPct = pct(topExact, topFiveReviews.length);
    const clubMap = new Map<string, {
      team: string;
      total: number;
      exact: number;
      outcome: number;
      avgError: number;
      exactMatches: DashboardHistoryItem[];
    }>();
    for (const item of historyItems) {
      for (const team of [item.homeTeam, item.awayTeam]) {
        const name = String(team || "").trim();
        if (!name) continue;
        const current = clubMap.get(name) || { team: name, total: 0, exact: 0, outcome: 0, avgError: 0, exactMatches: [] };
        current.total += 1;
        if (item.wasCorrect) {
          current.exact += 1;
          current.exactMatches.push(item);
        }
        if (item.winnerCorrect) current.outcome += 1;
        current.avgError += Number(item.errorMargin || 0);
        clubMap.set(name, current);
      }
    }
    const topClubs = [...clubMap.values()]
      .filter((item) => item.total >= 2)
      .map((item) => ({
        ...item,
        exactPct: pct(item.exact, item.total),
        outcomePct: pct(item.outcome, item.total),
        avgError: Number((item.avgError / Math.max(item.total, 1)).toFixed(2)),
      }))
      .sort((a, b) => b.exactPct - a.exactPct || b.exact - a.exact || b.outcomePct - a.outcomePct || b.total - a.total)
      .slice(0, 10);
    return {
      topFiveTotal: topFiveReviews.length,
      topFiveExact: topExact,
      topFiveOutcome: topOutcome,
      topFiveExactPct: topExactPct,
      topFiveOutcomePct: pct(topOutcome, topFiveReviews.length),
      topFiveAvgError: topAvgError,
      otherExactPct,
      otherExactCount: otherExact,
      otherTotal: otherReviews.length,
      topSelectionIsBetter: topExactPct >= otherExactPct,
      topClubs,
      leaguePerformance,
    };
  }, [historyItems, leaguePerformance]);

  return (
    <div
      className="footyai-glass-scope relative min-h-screen overflow-hidden bg-[#020817]"
      style={
        {
          "--footyai-card-alpha": String((100 - glassTransparency) / 100),
          "--footyai-card-blur": `${Math.round(10 + glassTransparency / 4)}px`,
        } as React.CSSProperties
      }
    >
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-[url('/footyai-stadium-bg.jpeg')] bg-[length:min(99vw,1260px)_auto] bg-[position:center_-72px] md:bg-[position:center_-150px] xl:bg-[position:center_-190px] bg-no-repeat opacity-[0.78] contrast-105 saturate-105 brightness-90"
      />
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,transparent_34%,rgba(20,184,166,0.18)_42%,rgba(2,8,23,0.46)_73%,rgba(1,5,16,0.92)_100%)]"
      />
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-gradient-to-r from-[#020817]/88 via-slate-950/12 to-[#020817]/88"
      />
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-gradient-to-b from-slate-950/18 via-slate-950/52 to-slate-950/92"
      />
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-[radial-gradient(circle_at_51%_57%,rgba(103,232,249,0.28),transparent_20%),radial-gradient(circle_at_75%_50%,rgba(45,212,191,0.22),transparent_24%),radial-gradient(circle_at_38%_62%,rgba(34,211,238,0.16),transparent_22%)] mix-blend-screen blur-[1px]"
      />
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.035),transparent_22%,transparent_70%,rgba(20,184,166,0.08))]"
      />
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-[radial-gradient(circle_at_50%_58%,transparent_0,transparent_18%,rgba(2,8,23,0.18)_38%,rgba(2,8,23,0.54)_100%)]"
      />
      <div className="relative z-10">
      <Header 
        view={view} 
        onViewChange={setView}
        syncStatus={syncStatus}
        lastRun={lastRun}
      />

      <main className="max-w-7xl mx-auto px-4 py-6">
        <Suspense fallback={<ViewFallback />}>
        {view === "history" ? (
          <PredictionHistory />
        ) : view === "knowledge" ? (
          <KnowledgeView />
        ) : view === "standings" ? (
          <StandingsView />
        ) : view === "modelops" ? (
          <ModelOpsView />
        ) : view === "integrity" ? (
          <DataIntegrityView />
        ) : view === "providers" ? (
          <ProviderControlView />
        ) : view === "settings" ? (
          <SettingsView />
        ) : (
          <>
            {/* DATE NAVIGATION - NIEUW! */}
            <DateNavigation 
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
            />

            

            <div className="hidden">
              {[
                { key: "favorieten", label: "Favorieten", count: favoriteCount, color: "yellow", icon: "★" },
                { key: "live", label: "Live", count: liveCount, color: "red", icon: "●" },
                { key: "gepland", label: "Gepland", count: plannedCount, color: "blue", icon: "" },
                { key: "gespeeld", label: "Gespeeld", count: finishedCount, color: "slate", icon: "" },
                { key: "brondekking", label: "Brondekking", count: sourceCoverageCount, color: "emerald", icon: "" },
                { key: "odds", label: "Heeft odds", count: oddsCoverageCount, color: "emerald", icon: "" },
                { key: "xg", label: "Heeft xG", count: xgCoverageCount, color: "cyan", icon: "" },
                { key: "weer", label: "Heeft weer", count: weatherCoverageCount, color: "sky", icon: "" },
                { key: "mistdata", label: "Mist brondata", count: missingCoverageCount, color: "amber", icon: "" },
              ].map(({ key, label, count, color, icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveFilter(activeFilter === key ? "alle" : (key as FilterMode))}
                  className={`glass-card p-3 rounded-2xl border text-left transition ${
                    activeFilter === key
                      ? `border-${color}-500/60 bg-${color}-900/20`
                      : `border-${color}-500/20 hover:border-${color}-500/30`
                  }`}
                >
                  <div className={`text-[9px] font-black text-${color}-400 uppercase flex items-center gap-1`}>
                    {icon && <span className={key === "live" ? "animate-pulse" : ""}>{icon}</span>}
                    {label}
                  </div>
                  <div className="text-xl font-black">{count}</div>
                </button>
              ))}
            </div>

            <div className="mb-3 rounded-2xl border border-white/10 bg-slate-950/45 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-black uppercase text-white">Dagoverzicht</h2>
                  <p className="text-[11px] text-slate-400">
                    {dayMatches.length} wedstrijden · live {liveCount} · gepland {plannedCount} · gespeeld {finishedCount}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {[
                    { key: "alle", label: "Alles", count: dayMatches.length },
                    { key: "live", label: "Live", count: liveCount },
                    { key: "gepland", label: "Gepland", count: plannedCount },
                    { key: "gespeeld", label: "Gespeeld", count: finishedCount },
                    { key: "favorieten", label: "Favorieten", count: favoriteCount },
                  ].map(({ key, label, count }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setActiveFilter(key as FilterMode)}
                      className={`rounded-full px-3 py-1 text-[10px] font-black transition ${
                        activeFilter === key ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      {label} {count}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* AANGEPAST: Multi-row league tabs zonder scroll */}
            <div className="flex flex-wrap gap-1 mb-4 py-0.5">
              <button
                onClick={() => {
                  setSelectedLeague("alle");
                  setActiveFilter("alle");
                }}
                className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-black whitespace-nowrap ${
                  selectedLeague === "alle"
                    ? "bg-white text-black"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                ⚽ {dayMatches.length}
              </button>

              {allLeagues.map((league) => {
                const summary = leagueSummaries.get(league);
                const total = summary?.total || 0;
                const leagueLiveCount = summary?.live || 0;
                const coverage = summary?.coverage || 0;
                const coverageTone =
                  coverage >= 75 ? "text-emerald-300" : coverage >= 50 ? "text-amber-300" : "text-red-300";

                return (
                  <button
                    key={league}
                    onClick={() => setSelectedLeague(league)}
                    title={`${league} - brondekking ${coverage}% - odds ${summary?.odds || 0}/${total} - xG ${summary?.xg || 0}/${total}`}
                    className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-black whitespace-nowrap ${
                      selectedLeague === league
                        ? "bg-blue-600 text-white"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {shortLeague(league)}
                    {leagueLiveCount > 0 ? (
                      <span className="ml-1 text-[8px] bg-red-500 text-white px-1 rounded animate-pulse">
                        {leagueLiveCount}
                      </span>
                    ) : (
                      <span className="ml-1 opacity-50 text-[9px]">{total}</span>
                    )}
                    <span className={`ml-1 text-[8px] ${selectedLeague === league ? "text-white" : coverageTone}`}>
                      bron {coverage}%
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedLeagueSummary && (
              <div className="mb-4 rounded-2xl border border-cyan-500/15 bg-slate-950/45 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[9px] font-black uppercase text-cyan-300">Competitiebronstatus</div>
                    <h3 className="text-sm font-black text-white">{selectedLeague}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveFilter(selectedLeagueSummary.missing > 0 ? "mistdata" : "alle")}
                    className="rounded-full bg-cyan-500/15 px-3 py-1 text-[10px] font-black text-cyan-200 hover:bg-cyan-500/25"
                  >
                    {selectedLeagueSummary.missing > 0 ? `${selectedLeagueSummary.missing} mist data` : "Bronnen ok"}
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {[
                    { label: "Wedstrijden", value: selectedLeagueSummary.total },
                    { label: "Brondekking", value: `${selectedLeagueSummary.coverage}%` },
                    { label: "Odds", value: `${selectedLeagueSummary.odds}/${selectedLeagueSummary.total}` },
                    { label: "xG/Stats", value: `${selectedLeagueSummary.xg}/${selectedLeagueSummary.total}` },
                    { label: "Weer", value: `${selectedLeagueSummary.weather}/${selectedLeagueSummary.total}` },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-white/5 bg-slate-900/55 p-2">
                      <div className="text-[8px] font-black uppercase text-slate-500">{item.label}</div>
                      <div className="text-sm font-black text-white">{item.value}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[10px] text-slate-400">
                  Bronnen: {selectedLeagueSummary.providers.length ? selectedLeagueSummary.providers.join(", ") : "nog geen providerlabel beschikbaar"}
                </div>
              </div>
            )}

            <div className="mb-4">
              <section className="glass-card rounded-2xl border border-yellow-500/20 p-3 bg-yellow-500/5">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <h2 className="text-sm font-black uppercase text-white flex items-center gap-2">
                      <span className="w-2 h-2 bg-yellow-400 rounded-full" />
                      Top 5 exacte-score voorspellingen vandaag
                    </h2>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Voorspellingen zijn kansinschattingen, geen garantie. Een inzetlabel verschijnt alleen na alle datagates.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setView("standings")}
                      className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-black text-slate-300 hover:bg-white/10"
                    >
                      Competities en standen
                    </button>
                    <div className="rounded-full bg-yellow-500/15 px-3 py-1 text-[10px] font-black text-yellow-200">
                      {bestBets.filter((bet: any) => bet.wagerReadiness?.status === "eligible").length} inzetbaar · {bestBets.length}/5 voorspeld
                    </div>
                  </div>
                </div>

                {bestBets.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                    {bestBets.map((bet: any) => (
                      <BestBetCard key={bet.matchId} bet={bet} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-yellow-500/20 bg-slate-950/30 p-5 text-sm font-bold text-slate-400">
                    Nog geen top-5 beschikbaar voor deze dag. Zodra de worker voorspellingen voor deze datum heeft, verschijnt dit blok automatisch.
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-slate-950/35 px-3 py-2 text-[10px] font-bold text-slate-400">
                  <span>Top-5 exact <strong className="text-white">{dashboardInsights.topFiveExactPct}%</strong></span>
                  <span className="text-slate-600">|</span>
                  <span>Winnaar/gelijk <strong className="text-white">{dashboardInsights.topFiveOutcomePct}%</strong></span>
                  <span className="text-slate-600">|</span>
                  <span>Rest exact <strong className="text-white">{dashboardInsights.otherExactPct}%</strong></span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-black ${dashboardInsights.topSelectionIsBetter ? "bg-green-500/10 text-green-300" : "bg-amber-500/10 text-amber-300"}`}>
                    {dashboardInsights.topSelectionIsBetter ? "AI kiest beter" : "bijsturen nodig"} · foutmarge {dashboardInsights.topFiveAvgError}
                  </span>
                </div>
                {dashboardInsights.leaguePerformance.best && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-cyan-400/15 bg-cyan-400/5 px-3 py-2 text-[10px] font-bold text-slate-300">
                    <span className="uppercase tracking-wide text-cyan-300">Best voorspelde competitie</span>
                    <strong className="text-white">{dashboardInsights.leaguePerformance.best.league}</strong>
                    <span>1X2 <strong className="text-green-300">{dashboardInsights.leaguePerformance.best.outcomePct}%</strong></span>
                    <span>exact <strong className="text-yellow-200">{dashboardInsights.leaguePerformance.best.exactPct}%</strong></span>
                    <span>foutmarge <strong className="text-white">{dashboardInsights.leaguePerformance.best.avgGoalError}</strong></span>
                    <span className="ml-auto text-slate-500">
                      {dashboardInsights.leaguePerformance.best.total} lekvrije evaluaties · minimaal {dashboardInsights.leaguePerformance.minSample}
                    </span>
                  </div>
                )}
              </section>

            </div>

            {loading ? (
              <div className={matchGridClass}>
                {[1, 2, 3, 4, 5, 6].map((index) => (
                  <div key={index} className="h-64 glass-card rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : sortedMatches.length === 0 && activeFilter !== "alle" ? (
              <div className="text-center py-16 text-slate-500">
                <div className="text-5xl mb-3">{activeFilter === "favorieten" ? "★" : "⚽"}</div>
                <div className="font-bold">
                  {activeFilter === "favorieten"
                    ? "Geen wedstrijden van favoriete teams op deze dag"
                    : "Geen wedstrijden voor deze selectie"}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleSortedMatches.map((match) => {
                  const enriched = enrichMatch(match);
                  const expanded = expandedMatchId === match.id;
                  return (
                    <div key={match.id} className="space-y-2">
                      <CompactMatchRow
                        match={enriched}
                        prediction={predictions[match.id]}
                        expanded={expanded}
                        onToggle={() => setExpandedMatchId(expanded ? null : match.id)}
                      />
                      {expanded && (
                        <Suspense fallback={<div className="glass-card rounded-2xl border border-white/5 p-4 text-sm font-bold text-slate-400">Wedstrijddetails laden...</div>}>
                          <MatchCard
                            match={enriched}
                            prediction={predictions[match.id]}
                            onFavoriteChange={() => setFavRefresh((value) => value + 1)}
                          />
                        </Suspense>
                      )}
                    </div>
                  );
                })}
                {visibleSortedMatches.length < sortedMatches.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleMatchLimit((value) => value + MATCH_RENDER_BATCH)}
                    className="w-full rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-black text-cyan-100 hover:bg-cyan-500/15"
                  >
                    Toon meer wedstrijden ({visibleSortedMatches.length}/{sortedMatches.length})
                  </button>
                )}
                {false && (
                  <>
                {activeFilter === "alle" && favoriteCount > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-yellow-400">★</span>
                      <span className="text-sm font-black uppercase">Favoriete teams ({favoriteCount})</span>
                    </div>

                    <div className={matchGridClass}>
                      {favoriteMatches.slice(0, 6).map((match) => (
                        <MatchCard
                          key={match.id}
                          match={enrichMatch(match)}
                          prediction={predictions[match.id]}
                          onFavoriteChange={() => setFavRefresh((value) => value + 1)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {(activeFilter === "alle" || activeFilter === "live" || activeFilter === "favorieten" || activeFilter === "brondekking" || activeFilter === "odds" || activeFilter === "xg" || activeFilter === "weer" || activeFilter === "mistdata") && liveMatches.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                      <span className="text-sm font-black uppercase">Live ({liveMatches.length})</span>
                    </div>
                    <div className={matchGridClass}>
                      {liveMatches.map((match) => (
                        <MatchCard
                          key={match.id}
                          match={enrichMatch(match)}
                          prediction={predictions[match.id]}
                          onFavoriteChange={() => setFavRefresh((value) => value + 1)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {(activeFilter === "alle" || activeFilter === "gepland" || activeFilter === "favorieten" || activeFilter === "brondekking" || activeFilter === "odds" || activeFilter === "xg" || activeFilter === "weer" || activeFilter === "mistdata") && plannedMatches.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2 h-2 bg-blue-500 rounded-full" />
                      <span className="text-sm font-black uppercase">Nog te spelen ({plannedMatches.length})</span>
                    </div>
                    <div className={matchGridClass}>
                      {plannedMatches.map((match) => (
                        <MatchCard
                          key={match.id}
                          match={enrichMatch(match)}
                          prediction={predictions[match.id]}
                          onFavoriteChange={() => setFavRefresh((value) => value + 1)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {(activeFilter === "alle" || activeFilter === "gespeeld" || activeFilter === "favorieten" || activeFilter === "brondekking" || activeFilter === "odds" || activeFilter === "xg" || activeFilter === "weer" || activeFilter === "mistdata") && finishedMatches.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2 h-2 bg-slate-400 rounded-full" />
                      <span className="text-sm font-black uppercase">Gespeeld ({finishedMatches.length})</span>
                    </div>
                    <div className={matchGridClass}>
                      {finishedMatches.map((match) => (
                        <MatchCard
                          key={match.id}
                          match={enrichMatch(match)}
                          prediction={predictions[match.id]}
                          onFavoriteChange={() => setFavRefresh((value) => value + 1)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                  </>
                )}

                {!loading && dayMatches.length === 0 && (
                  <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-slate-950/55 px-8 py-10 text-center text-slate-300 shadow-2xl">
                    <div className="text-5xl mb-3">📅</div>
                    <div className="font-black text-white">Geen wedstrijden gevonden voor {formatDateLabel(selectedDate)}</div>
                    <div className="mt-2 text-sm text-slate-400">
                      {workerNeeded
                        ? "De worker heeft voor deze dag nog geen verse data geleverd. De app controleert opnieuw bij de volgende refresh."
                        : "Er zijn voor deze selectie geen wedstrijden beschikbaar."}
                    </div>
                    {syncMessage && (
                      <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-xs font-bold text-amber-200">
                        {syncMessage}
                      </div>
                    )}
                    {lastRun && (
                      <div className="mt-3 text-xs text-slate-500">
                        Laatste worker-run: {new Date(lastRun).toLocaleString("nl-NL")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        </Suspense>
      </main>
      </div>
    </div>
  );
};

export default App;
