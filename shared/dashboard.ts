import type { Match } from "../types";
import { todayAmsterdamKey, toAmsterdamDateKey } from "./date.js";
import { shortLeagueName } from "./matchText.js";
import { ACTIVE_COMPETITIONS } from "./competitionVisibility.js";

export type DashboardHistoryItem = {
  matchId: string;
  prediction: string;
  actual: string;
  wasCorrect: boolean;
  winnerCorrect?: boolean;
  errorMargin?: number;
  timestamp?: number;
  homeTeam?: string | null;
  awayTeam?: string | null;
  league?: string | null;
  predictedOutcome?: string | null;
  actualOutcome?: string | null;
  bestBetRank?: number | null;
  topExactScorePick?: boolean;
  exactScoreConfidence?: number;
  predictionId?: string | null;
  evaluationSource?: string | null;
  leakageRisk?: string | null;
};

export type LeaguePerformanceRow = {
  league: string;
  total: number;
  exact: number;
  outcome: number;
  exactPct: number;
  outcomePct: number;
  avgGoalError: number;
};

export type WagerReadiness = {
  status: "eligible" | "watch" | "analysis_only";
  label: string;
  recommendedOutcome: "Thuis" | "Gelijk" | "Uit";
  modelProbability: number;
  marketProbability: number | null;
  marketOdds: number | null;
  edge: number | null;
  blockers: string[];
};

export const LEAGUE_ORDER = [...ACTIVE_COMPETITIONS];

export const FAVORITE_STANDING_KEY = "footyai-favorite-standing";
export const DEFAULT_FAVORITE_STANDING_LABEL = "Netherlands - Eredivisie";

export function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function buildLeaguePerformance(items: DashboardHistoryItem[], minSample = 10) {
  const active = new Set(ACTIVE_COMPETITIONS);
  const trustworthy = items.filter(
    (item) =>
      active.has(String(item.league || "")) &&
      item.evaluationSource === "prediction_snapshot" &&
      !item.leakageRisk
  );
  const sourceItems = trustworthy.length >= minSample ? trustworthy : items.filter((item) => active.has(String(item.league || "")));
  const method = trustworthy.length >= minSample ? "immutable_snapshots" : "all_evaluated_reviews";
  const buckets = new Map<string, { total: number; exact: number; outcome: number; goalError: number }>();

  for (const item of sourceItems) {
    const league = String(item.league || "").trim();
    if (!league) continue;
    const bucket = buckets.get(league) || { total: 0, exact: 0, outcome: 0, goalError: 0 };
    bucket.total += 1;
    bucket.exact += item.wasCorrect ? 1 : 0;
    bucket.outcome += item.winnerCorrect ? 1 : 0;
    bucket.goalError += Number(item.errorMargin || 0);
    buckets.set(league, bucket);
  }

  const rows: LeaguePerformanceRow[] = [...buckets.entries()]
    .map(([league, bucket]) => ({
      league,
      total: bucket.total,
      exact: bucket.exact,
      outcome: bucket.outcome,
      exactPct: pct(bucket.exact, bucket.total),
      outcomePct: pct(bucket.outcome, bucket.total),
      avgGoalError: Number((bucket.goalError / Math.max(bucket.total, 1)).toFixed(2)),
    }))
    .filter((row) => row.total >= minSample)
    .sort(
      (a, b) =>
        b.outcomePct - a.outcomePct ||
        b.exactPct - a.exactPct ||
        a.avgGoalError - b.avgGoalError ||
        b.total - a.total
    );

  return { best: rows[0] || null, rows, method, minSample };
}

export function buildWagerReadiness(bet: any, leaguePerformance?: LeaguePerformanceRow | null): WagerReadiness {
  const outcomes = [
    { key: "home", label: "Thuis" as const, probability: Number(bet?.homeProb || 0) },
    { key: "draw", label: "Gelijk" as const, probability: Number(bet?.drawProb || 0) },
    { key: "away", label: "Uit" as const, probability: Number(bet?.awayProb || 0) },
  ];
  const selected = outcomes.sort((a, b) => b.probability - a.probability)[0];
  const odds = bet?.odds || null;
  const prices = {
    home: Number(odds?.home ?? odds?.homeWin ?? 0),
    draw: Number(odds?.draw ?? 0),
    away: Number(odds?.away ?? odds?.awayWin ?? 0),
  };
  const validPrices = Object.values(prices).every((value) => Number.isFinite(value) && value > 1.01);
  const inverseTotal = validPrices ? 1 / prices.home + 1 / prices.draw + 1 / prices.away : 0;
  const selectedOdd = validPrices ? prices[selected.key] : null;
  const marketProbability = selectedOdd && inverseTotal > 0 ? (1 / selectedOdd) / inverseTotal : null;
  const edge = marketProbability == null ? null : selected.probability - marketProbability;
  const completeness = Number(bet?.dataCompleteness?.score ?? bet?.dataCompletenessScore ?? 0);
  const lineupConfirmed = Boolean(bet?.lineupSummary?.confirmed);
  const blocked = Boolean(bet?.qualityGate?.blockedHighConfidence);
  const friendly = /friendl|oefen/i.test(String(bet?.league || ""));
  const finished = String(bet?.status || "").toUpperCase() === "FT";
  const kickoffAt = Date.parse(String(bet?.date || bet?.kickoff || ""));
  const oddsCapturedAt = Date.parse(String(odds?.capturedAt || odds?.lastUpdated || ""));
  const hasKickoffTimestamp = Number.isFinite(kickoffAt) && String(bet?.date || bet?.kickoff || "").includes("T");
  const hasOddsTimestamp = Number.isFinite(oddsCapturedAt);
  const oddsBeforeKickoff = hasKickoffTimestamp && hasOddsTimestamp && oddsCapturedAt < kickoffAt;
  const oddsFreshEnough = oddsBeforeKickoff && kickoffAt - oddsCapturedAt <= 24 * 60 * 60 * 1000;
  const blockers: string[] = [];

  if (finished) blockers.push("wedstrijd is al gespeeld");
  if (friendly) blockers.push("oefenwedstrijd heeft te hoge selectieronzekerheid");
  if (completeness < 0.7) blockers.push("datadekking lager dan 70%");
  if (blocked) blockers.push("kwaliteitsgate blokkeert hoge zekerheid");
  if (!lineupConfirmed) blockers.push("bevestigde opstelling ontbreekt");
  if (!validPrices) blockers.push("geen complete actuele 1X2-odds");
  else if (!hasKickoffTimestamp) blockers.push("betrouwbare aftraptijd ontbreekt");
  else if (!hasOddsTimestamp) blockers.push("odds hebben geen betrouwbare timestamp");
  else if (!oddsBeforeKickoff) blockers.push("odds zijn niet aantoonbaar voor de aftrap vastgelegd");
  else if (!oddsFreshEnough) blockers.push("odds zijn ouder dan 24 uur voor de aftrap");
  if (!leaguePerformance || leaguePerformance.total < 30) blockers.push("minder dan 30 lekvrije competitie-evaluaties");
  else if (leaguePerformance.outcomePct < 55) blockers.push("competitie-hitrate op 1X2 lager dan 55%");
  if (edge == null) blockers.push("value-edge kan niet worden berekend");
  else if (edge < 0.03) blockers.push("model-edge lager dan 3 procentpunt");

  const eligible = blockers.length === 0;
  const watchOnly = !eligible && !finished && !friendly && completeness >= 0.6 && !blocked;
  return {
    status: eligible ? "eligible" : watchOnly ? "watch" : "analysis_only",
    label: eligible ? "Inzetbaar volgens datagate" : watchOnly ? "Volgen - nog niet inzetten" : "Analyse - geen inzetadvies",
    recommendedOutcome: selected.label,
    modelProbability: selected.probability,
    marketProbability: marketProbability == null ? null : Number(marketProbability.toFixed(4)),
    marketOdds: selectedOdd,
    edge: edge == null ? null : Number(edge.toFixed(4)),
    blockers,
  };
}

export function isoDate(date: Date) {
  return toAmsterdamDateKey(date) || todayAmsterdamKey();
}

export function formatDateLabel(dateISO: string) {
  return new Date(`${dateISO}T12:00:00`).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatAmsterdamDate(date: Date) {
  return toAmsterdamDateKey(date) || isoDate(date);
}

export function belongsToSelectedDate(match: Match, dateISO: string) {
  if (String(match.date || "") === dateISO) return true;

  if (match.kickoff) {
    const parsed = new Date(match.kickoff);
    if (!Number.isNaN(parsed.getTime())) return formatAmsterdamDate(parsed) === dateISO;
  }

  return false;
}

export function shortLeague(league: string) {
  return shortLeagueName(league);
}

export function readFavoriteStandingLabel() {
  try {
    return localStorage.getItem(FAVORITE_STANDING_KEY) || DEFAULT_FAVORITE_STANDING_LABEL;
  } catch {
    return DEFAULT_FAVORITE_STANDING_LABEL;
  }
}

export function getStandingLabel(table: any, key: string) {
  return String(table?.label || key || "");
}

export function outcomeFromScore(score?: string | null) {
  const [home, away] = String(score || "").split("-").map(Number);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (home > away) return "Thuis";
  if (away > home) return "Uit";
  return "Gelijk";
}

export function hydrateDashboardHistory(items: DashboardHistoryItem[]) {
  return items.map((item) => {
    const predictedOutcome = item.predictedOutcome || outcomeFromScore(item.prediction);
    const actualOutcome = item.actualOutcome || outcomeFromScore(item.actual);
    return {
      ...item,
      predictedOutcome,
      actualOutcome,
      winnerCorrect: typeof item.winnerCorrect === "boolean" ? item.winnerCorrect : predictedOutcome === actualOutcome,
      wasCorrect: String(item.prediction || "").trim() === String(item.actual || "").trim(),
    };
  });
}

export function mergeDashboardHistory(localItems: DashboardHistoryItem[], serverItems: DashboardHistoryItem[]) {
  const merged = new Map<string, DashboardHistoryItem>();
  for (const item of [...serverItems, ...localItems]) {
    if (!item?.matchId) continue;
    const current = merged.get(item.matchId);
    if (!current || Number(item.timestamp || 0) >= Number(current.timestamp || 0)) {
      merged.set(item.matchId, item);
    }
  }
  return [...merged.values()].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}
