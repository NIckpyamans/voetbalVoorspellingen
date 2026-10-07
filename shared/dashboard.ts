import type { Match } from "../types";
import { todayAmsterdamKey, toAmsterdamDateKey } from "./date.js";
import { shortLeagueName } from "./matchText.js";
import { ACTIVE_COMPETITIONS } from "./competitionVisibility.js";
import { getMatchEvidenceCoverage, parseEvidenceTimestamp } from "./dashboardCoverage.js";
import { buildMatchDedupeKey } from "./matchNormalization.js";

export type DashboardHistoryItem = {
  matchId: string;
  prediction: string;
  actual: string;
  wasCorrect: boolean;
  winnerCorrect?: boolean;
  errorMargin?: number;
  timestamp?: number;
  date?: string | null;
  kickoff?: string | null;
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
  brierScore?: number | null;
  logLoss?: number | null;
  roi?: number | null;
  clv?: number | null;
  confidence?: number | null;
};

export type LeaguePerformanceRow = {
  league: string;
  total: number;
  trustworthyUniqueFixtures: number;
  exact: number;
  outcome: number;
  exactPct: number;
  outcomePct: number;
  avgGoalError: number;
  avgBrierScore: number | null;
  calibrationError: number | null;
  roiTotal: number | null;
  roiSamples: number;
  evaluationMethod: "immutable_snapshots" | "all_evaluated_reviews";
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
  evidenceCoverage: ReturnType<typeof getMatchEvidenceCoverage>;
};

export const LEAGUE_ORDER = [...ACTIVE_COMPETITIONS];

export const FAVORITE_STANDING_KEY = "footyai-favorite-standing";
export const DEFAULT_FAVORITE_STANDING_LABEL = "Netherlands - Eredivisie";

export function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function buildLeaguePerformance(items: DashboardHistoryItem[], minSample = 50) {
  const active = new Set(ACTIVE_COMPETITIONS);
  const dedupeFixtures = (rows: DashboardHistoryItem[]) => {
    const fixtures = new Map<string, DashboardHistoryItem>();
    for (const item of rows) {
      const league = String(item.league || "").trim();
      if (!active.has(league)) continue;
      const fixtureKey = (item.homeTeam && item.awayTeam
        ? buildMatchDedupeKey({
            date: item.kickoff || item.date,
            league,
            homeTeam: item.homeTeam,
            awayTeam: item.awayTeam,
          })
        : "") || (item.matchId ? `${league}|id:${item.matchId}` : "");
      if (!fixtureKey) continue;
      const current = fixtures.get(fixtureKey);
      const itemTime = parseEvidenceTimestamp(item.timestamp) ?? 0;
      const currentTime = parseEvidenceTimestamp(current?.timestamp) ?? -1;
      if (!current || itemTime >= currentTime) fixtures.set(fixtureKey, item);
    }
    return [...fixtures.values()];
  };

  const allReviews = dedupeFixtures(items.filter((item) => !item.leakageRisk));
  const trustworthy = dedupeFixtures(items.filter((item) => item.evaluationSource === "prediction_snapshot" && !item.leakageRisk));
  const immutableByLeague = new Map<string, DashboardHistoryItem[]>();
  for (const item of trustworthy) {
    const league = String(item.league || "").trim();
    immutableByLeague.set(league, [...(immutableByLeague.get(league) || []), item]);
  }
  const reviewByLeague = new Map<string, DashboardHistoryItem[]>();
  for (const item of allReviews) {
    const league = String(item.league || "").trim();
    reviewByLeague.set(league, [...(reviewByLeague.get(league) || []), item]);
  }

  const leagueNames = new Set([...reviewByLeague.keys(), ...immutableByLeague.keys()]);
  const rows: LeaguePerformanceRow[] = [];
  for (const league of leagueNames) {
    const immutable = immutableByLeague.get(league) || [];
    const selected = immutable.length >= minSample ? immutable : reviewByLeague.get(league) || [];
    const evaluationMethod: LeaguePerformanceRow["evaluationMethod"] = immutable.length >= minSample ? "immutable_snapshots" : "all_evaluated_reviews";
    const total = selected.length;
    if (total < minSample) continue;
    const exact = selected.filter((item) => item.wasCorrect).length;
    const outcome = selected.filter((item) => item.winnerCorrect).length;
    const brier = selected.map((item) => Number(item.brierScore)).filter(Number.isFinite);
    const confidence = selected.map((item) => Number(item.confidence)).filter(Number.isFinite);
    const roi = selected.map((item) => Number(item.roi)).filter(Number.isFinite);
    rows.push({
      league,
      total,
      trustworthyUniqueFixtures: immutable.length,
      exact,
      outcome,
      exactPct: pct(exact, total),
      outcomePct: pct(outcome, total),
      avgGoalError: Number((selected.reduce((sum, item) => sum + Number(item.errorMargin || 0), 0) / total).toFixed(2)),
      avgBrierScore: brier.length ? Number((brier.reduce((sum, value) => sum + value, 0) / brier.length).toFixed(4)) : null,
      calibrationError: confidence.length ? Number((outcome / total - confidence.reduce((sum, value) => sum + value, 0) / confidence.length).toFixed(3)) : null,
      roiTotal: roi.length ? Number(roi.reduce((sum, value) => sum + value, 0).toFixed(3)) : null,
      roiSamples: roi.length,
      evaluationMethod,
    });
  }
  rows.sort((a, b) => b.outcomePct - a.outcomePct || b.exactPct - a.exactPct || a.avgGoalError - b.avgGoalError || b.total - a.total);
  const method: LeaguePerformanceRow["evaluationMethod"] = rows.some((row) => row.evaluationMethod === "immutable_snapshots") ? "immutable_snapshots" : "all_evaluated_reviews";
  return { best: rows[0] || null, rows, method, minSample, trustworthyUniqueFixtures: trustworthy.length };
}

export function buildWagerReadiness(bet: any, leaguePerformance?: LeaguePerformanceRow | null, { now = Date.now() }: { now?: number } = {}): WagerReadiness {
  const outcomes = [
    { key: "home", label: "Thuis" as const, probability: Number(bet?.homeProb || 0) },
    { key: "draw", label: "Gelijk" as const, probability: Number(bet?.drawProb || 0) },
    { key: "away", label: "Uit" as const, probability: Number(bet?.awayProb || 0) },
  ];
  const selected = outcomes.sort((a, b) => b.probability - a.probability)[0];
  const odds = bet?.oddsAtPrediction || null;
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
  const rawCompleteness = Number(bet?.dataCompleteness?.score ?? bet?.dataCompletenessScore ?? 0);
  const completeness = Number.isFinite(rawCompleteness) ? Math.max(0, Math.min(1, rawCompleteness > 1 ? rawCompleteness / 100 : rawCompleteness)) : 0;
  const oddsCapturedAt = parseEvidenceTimestamp(odds?.capturedAt);
  const kickoffAt = parseEvidenceTimestamp(bet?.date || bet?.kickoff);
  const hasKickoffTimestamp = kickoffAt != null && String(bet?.date || bet?.kickoff || "").includes("T");
  const hasOddsTimestamp = oddsCapturedAt != null;
  const oddsCaptureNotFuture = oddsCapturedAt != null && oddsCapturedAt <= now;
  const oddsBeforeKickoff = hasKickoffTimestamp && hasOddsTimestamp && oddsCaptureNotFuture && oddsCapturedAt < kickoffAt;
  const oddsFreshEnough = oddsBeforeKickoff && kickoffAt - oddsCapturedAt <= 24 * 60 * 60 * 1000;
  const evidence = getMatchEvidenceCoverage({
    kickoff: bet?.date || bet?.kickoff,
    h2h: bet?.h2h || (Number(bet?.h2hPlayed || 0) > 0 ? { played: bet.h2hPlayed } : null),
    lineupSummary: bet?.lineupSummary,
    oddsAtPrediction: odds,
    oddsStatus: bet?.oddsStatus,
    dataCompletenessScore: completeness,
    h2hPlayed: bet?.h2hPlayed,
  }, bet, { now });
  const blocked = Boolean(bet?.qualityGate?.blockedHighConfidence);
  const friendly = /friendl|oefen/i.test(String(bet?.league || ""));
  const finished = ["FT", "AET", "PEN"].includes(String(bet?.status || "").toUpperCase());
  const lateMarketShift = Math.abs(Number(
    bet?.marketMovement?.probabilityShift ??
      bet?.modelEdges?.marketCalibration?.lateProbabilityShift ??
      0
  ));
  const blockers: string[] = [];

  if (finished) blockers.push("wedstrijd is al gespeeld");
  if (friendly) blockers.push("oefenwedstrijd heeft te hoge selectieronzekerheid");
  const agreement = Number(bet?.ensembleMeta?.agreement ?? bet?.modelEdges?.modelAgreement ?? 0);
  const probabilityFloor = 0.58;
  if (completeness < 0.7) blockers.push("datacompleetheid lager dan de minimale 70%");
  if (blocked) blockers.push("kwaliteitsgate blokkeert hoge zekerheid");
  if (!evidence.lineupConfirmedPrematch) blockers.push("bevestigde opstelling ontbreekt, is afgeleid of mist een prematch-timestamp");
  if (bet?.oddsStatus === "historical_market_profile_only") blockers.push("alleen historisch marktprofiel beschikbaar, geen bookmakerodds");
  if (!validPrices) blockers.push("geen complete actuele 1X2-odds");
  else if (!hasKickoffTimestamp) blockers.push("betrouwbare aftraptijd ontbreekt");
  else if (!hasOddsTimestamp) blockers.push("odds hebben geen betrouwbare timestamp");
  else if (!oddsCaptureNotFuture) blockers.push("odds-timestamp ligt in de toekomst");
  else if (!oddsBeforeKickoff) blockers.push("odds zijn niet aantoonbaar voor de aftrap vastgelegd");
  else if (!oddsFreshEnough) blockers.push("odds zijn ouder dan 24 uur voor de aftrap");
  if (lateMarketShift >= 0.08) blockers.push("late marktbeweging groter dan 8 procentpunt");
  if (selected.probability < probabilityFloor) blockers.push("gekalibreerde 1X2-kans lager dan 58%");
  if (agreement < 0.6) blockers.push("modellen onvoldoende eensgezind");
  if (!leaguePerformance || leaguePerformance.trustworthyUniqueFixtures < 150 || leaguePerformance.evaluationMethod !== "immutable_snapshots") blockers.push("minder dan 150 lekvrije unieke snapshot-evaluaties in deze competitie");
  else if (leaguePerformance.outcomePct < 55) blockers.push("competitie-hitrate op 1X2 lager dan 55%");
  if (edge == null) blockers.push("value-edge kan niet worden berekend");
  else if (edge < 0.03) blockers.push("model-edge lager dan 3 procentpunt");
  const predictionCapturedAt = parseEvidenceTimestamp(bet?.predictionCapturedAt);
  if (predictionCapturedAt == null || predictionCapturedAt > now || now - predictionCapturedAt > 6 * 60 * 60 * 1000) blockers.push("voorspelling ontbreekt, ligt in de toekomst of is ouder dan 6 uur");
  if (kickoffAt != null && kickoffAt <= now) blockers.push("aftrap is voorbij");
  const lineupCapturedAt = parseEvidenceTimestamp(bet?.lineupSummary?.firstConfirmedAt);
  if (lineupCapturedAt != null && lineupCapturedAt > now) blockers.push("opstellingsbevestigingstimestamp ligt in de toekomst");
  else if (lineupCapturedAt != null && now - lineupCapturedAt > 6 * 60 * 60 * 1000) blockers.push("opstellingsbevestiging ouder dan 6 uur");

  const eligible = blockers.length === 0;
  const watchOnly = !eligible && !finished && !friendly && completeness >= 0.7 && !blocked;
  return {
    status: eligible ? "eligible" : watchOnly ? "watch" : "analysis_only",
    label: eligible ? "Inzetbaar volgens datagate" : watchOnly ? "Volgen - nog niet inzetten" : "Analyse - geen inzetadvies",
    recommendedOutcome: selected.label,
    modelProbability: selected.probability,
    marketProbability: marketProbability == null ? null : Number(marketProbability.toFixed(4)),
    marketOdds: selectedOdd,
    edge: edge == null ? null : Number(edge.toFixed(4)),
    blockers,
    evidenceCoverage: evidence,
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
