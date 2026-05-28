// ============================================================================
// MATCH SERVICE - VOLLEDIG
// Haalt wedstrijden en voorspellingen op, inclusief ALLE mogelijke velden
// ============================================================================

import { Match, Prediction } from "../types";
import { normalizeMinute, parseMinuteValue } from "../shared/minute.js";
import { todayAmsterdamKey } from "../shared/date.js";

const CACHE_VERSION = "v9_result_backfill_dedupe_guard";
const LIVE_CACHE_AGE_MS = 30_000;
const TODAY_CACHE_AGE_MS = 90_000;
const OTHER_CACHE_AGE_MS = 30 * 60_000;

const TEAM_DEDUPE_ALIASES: Record<string, string> = {
  "freiburg": "freiburg",
  "sc freiburg": "freiburg",
  "sport club freiburg": "freiburg",
  "aston villa": "aston villa",
  "aston villa fc": "aston villa",
  "man city": "manchester city",
  "manchester city": "manchester city",
  "manchester city fc": "manchester city",
  "psg": "paris saint germain",
  "paris sg": "paris saint germain",
  "paris saint germain": "paris saint germain",
  "paris saint-germain": "paris saint germain",
  "fc barcelona": "barcelona",
  "barca": "barcelona",
  "barcelona": "barcelona",
  "athletic bilbao": "athletic club",
  "athletic club": "athletic club",
};

const VERIFIED_RESULT_BACKFILL = [
  {
    date: "2026-05-20",
    home: "Freiburg",
    away: "Aston Villa",
    score: "0-3",
    status: "FT",
    sourceNote: "verified Europa League final result backfill",
  },
];

function normalizeDedupeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(afc|fc|cf|sc|cd|ac|as|rc|sv|vfl|vfb|bk|fk|ik|if|club de|club)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalDedupeTeam(value: unknown) {
  const normalized = normalizeDedupeText(value);
  if (!normalized) return "";
  return TEAM_DEDUPE_ALIASES[normalized] || normalized;
}

function pairKey(home: unknown, away: unknown) {
  return [canonicalDedupeTeam(home), canonicalDedupeTeam(away)].sort().join("__");
}

function lookupVerifiedResultBackfill(match: any) {
  const dateKey = String(match?.date || match?.kickoff || "").slice(0, 10);
  const matchPair = pairKey(match?.homeTeamName || match?.homeTeam, match?.awayTeamName || match?.awayTeam);
  return VERIFIED_RESULT_BACKFILL.find((item) => item.date === dateKey && pairKey(item.home, item.away) === matchPair) || null;
}

function applyVerifiedResultBackfill(match: any) {
  const backfill = lookupVerifiedResultBackfill(match);
  if (!backfill) return match;
  const hasFinalScore = typeof match?.score === "string" && /^\d+\s*-\s*\d+$/.test(match.score) && String(match?.status || "").toUpperCase() === "FT";
  if (hasFinalScore) return match;
  const [homeScore, awayScore] = backfill.score.split("-").map(Number);
  return {
    ...match,
    score: backfill.score,
    homeScore,
    awayScore,
    status: backfill.status,
    resultPending: false,
    resultPendingReason: null,
    resultBackfill: true,
    resultBackfillSource: backfill.sourceNote,
  };
}

function canonicalDedupeLeague(value: unknown) {
  return normalizeDedupeText(value).replace(/\b(uefa|europe)\b/g, " ").replace(/\s+/g, " ").trim();
}

function matchDateKey(match: any) {
  const directDate = String(match?.date || match?.kickoff || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(directDate)) return directDate;
  const parsed = Date.parse(match?.kickoff || match?.date || "");
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

function buildClientMatchDedupeKey(match: any) {
  const dateKey = matchDateKey(match);
  const league = canonicalDedupeLeague(match?.league);
  const home = canonicalDedupeTeam(match?.homeTeamName || match?.homeTeam);
  const away = canonicalDedupeTeam(match?.awayTeamName || match?.awayTeam);
  if (!dateKey || !home || !away) return "";
  return `${dateKey}|${league}|${home}|${away}`;
}

function matchQuality(match: any) {
  const status = String(match?.status || "").toUpperCase();
  const statusScore = ["FT", "AET", "PEN"].includes(status) ? 80 : ["LIVE", "HT"].includes(status) ? 70 : status === "RESULT_PENDING" ? 20 : 0;
  const scoreScore = match?.score || match?.homeScore != null || match?.awayScore != null ? 30 : 0;
  const logoScore = (match?.homeLogo ? 4 : 0) + (match?.awayLogo ? 4 : 0);
  const h2hScore = Number(match?.h2h?.played || 0) * 2;
  const recentScore = (match?.homeRecent ? 3 : 0) + (match?.awayRecent ? 3 : 0);
  const positionScore = (match?.homePos != null ? 2 : 0) + (match?.awayPos != null ? 2 : 0);
  const sourceScore = String(match?.id || "").includes("espn") ? 5 : String(match?.id || "").includes("sportsdb") ? 3 : 0;
  return statusScore + scoreScore + logoScore + h2hScore + recentScore + positionScore + sourceScore;
}

function mergeDuplicateMatch(current: Match, incoming: Match): Match {
  const incomingPreferred = matchQuality(incoming) > matchQuality(current);
  const preferred = incomingPreferred ? { ...incoming } : { ...current };
  const fallback = incomingPreferred ? current : incoming;

  return {
    ...fallback,
    ...preferred,
    id: preferred.id || fallback.id,
    homeLogo: preferred.homeLogo || fallback.homeLogo,
    awayLogo: preferred.awayLogo || fallback.awayLogo,
    score: preferred.score || fallback.score,
    homeScore: preferred.homeScore ?? fallback.homeScore,
    awayScore: preferred.awayScore ?? fallback.awayScore,
    minute: preferred.minute || fallback.minute,
    minuteValue: preferred.minuteValue ?? fallback.minuteValue,
    homePos: preferred.homePos ?? fallback.homePos,
    awayPos: preferred.awayPos ?? fallback.awayPos,
    h2h: preferred.h2h || fallback.h2h,
    homeRecent: preferred.homeRecent || fallback.homeRecent,
    awayRecent: preferred.awayRecent || fallback.awayRecent,
    homeSeasonStats: preferred.homeSeasonStats || fallback.homeSeasonStats,
    awaySeasonStats: preferred.awaySeasonStats || fallback.awaySeasonStats,
    coverage: preferred.coverage || fallback.coverage,
  };
}

function dedupeMatchesForDay(matches: Match[]) {
  const seen = new Map<string, Match>();
  const idRedirects = new Map<string, string>();

  for (const match of matches || []) {
    const key = buildClientMatchDedupeKey(match);
    if (!key) {
      seen.set(match.id || `${seen.size}`, match);
      continue;
    }

    const current = seen.get(key);
    if (!current) {
      seen.set(key, match);
      continue;
    }

    const merged = mergeDuplicateMatch(current, match);
    seen.set(key, merged);
    if (current.id && current.id !== merged.id) idRedirects.set(current.id, merged.id);
    if (match.id && match.id !== merged.id) idRedirects.set(match.id, merged.id);
  }

  return { matches: [...seen.values()], idRedirects };
}

function dedupePredictionMap(predictions: Record<string, Prediction>, idRedirects: Map<string, string>) {
  if (!idRedirects.size) return predictions;
  const output: Record<string, Prediction> = { ...predictions };
  for (const [fromId, toId] of idRedirects) {
    if (!fromId || !toId || fromId === toId || !output[fromId]) continue;
    output[toId] = { ...output[fromId], ...output[toId], matchId: toId } as Prediction;
    delete output[fromId];
  }
  return output;
}

// ============================================================================
// CACHE FUNCTIES
// ============================================================================

function storageKey(dateISO: string) {
  return `footypredict_${CACHE_VERSION}_${dateISO}`;
}

function isLiveMatch(match: any) {
  const status = String(match?.status || "").toUpperCase();
  if (["FT", "AET", "PEN", "RESULT_PENDING"].includes(status) || status.includes("FINISH")) return false;
  return (
    status === "LIVE" ||
    status === "HT" ||
    match?.minuteValue != null
  );
}

function getMaxCacheAge(dateISO: string, matches: any[]) {
  const today = todayAmsterdamKey();
  if (dateISO !== today) return OTHER_CACHE_AGE_MS;
  if ((matches || []).some(isLiveMatch)) return LIVE_CACHE_AGE_MS;
  return TODAY_CACHE_AGE_MS;
}

function readCache(dateISO: string) {
  try {
    const raw = localStorage.getItem(storageKey(dateISO));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const { matches } = dedupeMatchesForDay(parsed.matches || []);
    const maxAge = getMaxCacheAge(dateISO, matches);
    if (!parsed?.ts || Date.now() - parsed.ts > maxAge) return null;

    return {
      matches,
      predictions: parsed.predictions || {},
      lastRun: parsed.lastRun || null,
    };
  } catch {
    return null;
  }
}

function writeCache(dateISO: string, matches: Match[], predictions: Record<string, any>, lastRun: number | null) {
  try {
    localStorage.setItem(
      storageKey(dateISO),
      JSON.stringify({
        ts: Date.now(),
        matches,
        predictions,
        lastRun,
      })
    );
  } catch {}
}

async function fetchJsonEndpoint(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`API ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("json")) {
    const preview = (await response.text()).slice(0, 60).replace(/\s+/g, " ");
    throw new Error(`Geen JSON-response voor ${url}: ${preview}`);
  }
  return response.json();
}

async function fetchStaticDayData(dateISO: string, signal?: AbortSignal) {
  try {
    const response = await fetch(`/data/days/${dateISO}.json?t=${Date.now()}`, { signal, cache: "no-store" });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) return null;
    return response.json();
  } catch {
    return null;
  }
}

function buildMatchesUpdateFromPayload(
  rawMatches: any[],
  rawPredictions: any[],
  lastRun: number | null
): MatchesUpdate {
  if (rawMatches.length === 0 && rawPredictions.length === 0) {
    return { matches: [], predictions: {}, lastRun, workerNeeded: true };
  }

  const mappedMatches = rawMatches.map(mapRawMatch);
  const { matches, idRedirects } = dedupeMatchesForDay(mappedMatches);
  let predictionMap: Record<string, Prediction> = {};

  for (const prediction of rawPredictions) {
    if (prediction.matchId) {
      predictionMap[prediction.matchId] = prediction;
    }
  }

  for (const rawMatch of rawMatches) {
    if (!rawMatch.id) continue;

    if (!predictionMap[rawMatch.id]) {
      predictionMap[rawMatch.id] = {} as Prediction;
    }

    predictionMap[rawMatch.id] = {
      ...predictionMap[rawMatch.id],
      matchId: rawMatch.id,

      ...(rawMatch.h2h ? { h2h: rawMatch.h2h } : {}),
      ...(rawMatch.h2hStatus ? { h2hStatus: rawMatch.h2hStatus } : {}),
      ...(rawMatch.aggregate ? { aggregate: rawMatch.aggregate } : {}),
      ...(rawMatch.context ? { context: rawMatch.context } : {}),
      ...(rawMatch.homePos != null ? { homePos: rawMatch.homePos } : {}),
      ...(rawMatch.awayPos != null ? { awayPos: rawMatch.awayPos } : {}),
      ...(rawMatch.matchImportance != null ? { matchImportance: rawMatch.matchImportance } : {}),
      ...(rawMatch.homeRestDays != null ? { homeRestDays: rawMatch.homeRestDays } : {}),
      ...(rawMatch.awayRestDays != null ? { awayRestDays: rawMatch.awayRestDays } : {}),
      ...(rawMatch.weather ? { weather: rawMatch.weather } : {}),
      ...(rawMatch.lineupSummary ? { lineupSummary: rawMatch.lineupSummary } : {}),
      ...(rawMatch.modelEdges ? { modelEdges: rawMatch.modelEdges } : {}),
      ...(rawMatch.homeClubElo != null ? { homeClubElo: rawMatch.homeClubElo } : {}),
      ...(rawMatch.awayClubElo != null ? { awayClubElo: rawMatch.awayClubElo } : {}),
      ...(rawMatch.homeTeamProfile ? { homeTeamProfile: rawMatch.homeTeamProfile } : {}),
      ...(rawMatch.awayTeamProfile ? { awayTeamProfile: rawMatch.awayTeamProfile } : {}),
      ...(rawMatch.featureVector ? { featureVector: rawMatch.featureVector } : {}),
      ...(rawMatch.learningSummary ? { learningSummary: rawMatch.learningSummary } : {}),
      ...(rawMatch.marketCalibration ? { marketCalibration: rawMatch.marketCalibration } : {}),
      ...(rawMatch.review ? { review: rawMatch.review } : {}),
      ...(rawMatch.ensembleMeta ? { ensembleMeta: rawMatch.ensembleMeta } : {}),
      ...(rawMatch.monteCarlo ? { monteCarlo: rawMatch.monteCarlo } : {}),
      ...(rawMatch.homeForm ? { homeForm: rawMatch.homeForm } : {}),
      ...(rawMatch.awayForm ? { awayForm: rawMatch.awayForm } : {}),
      ...(rawMatch.bestBetRank != null ? { bestBetRank: rawMatch.bestBetRank } : {}),
      ...(rawMatch.topConfidencePick != null ? { topConfidencePick: rawMatch.topConfidencePick } : {}),
      ...(rawMatch.topExactScorePick != null ? { topExactScorePick: rawMatch.topExactScorePick } : {}),
      ...(rawMatch.exactScoreConfidence != null ? { exactScoreConfidence: rawMatch.exactScoreConfidence } : {}),
      ...(rawMatch.exactScoreReasons ? { exactScoreReasons: rawMatch.exactScoreReasons } : {}),
    };
  }

  predictionMap = dedupePredictionMap(predictionMap, idRedirects);
  return {
    matches,
    predictions: predictionMap,
    lastRun,
    workerNeeded: false,
  };
}

// ============================================================================
// MATCH MAPPING FUNCTIE - MET ALLE VELDEN
// ============================================================================

function normalizeMatchStatus(m: any) {
  const rawStatus = String(m?.status || "NS").toUpperCase();
  const hasScore = typeof m?.score === "string" && m.score.includes("-");
  const settledStatuses = new Set(["FT", "AET", "PEN", "LIVE", "HT", "RESULT_PENDING"]);
  if (hasScore || settledStatuses.has(rawStatus)) return rawStatus;

  const kickoffMs = Date.parse(m?.kickoff || m?.date || "");
  if (Number.isFinite(kickoffMs) && Date.now() - kickoffMs > 150 * 60 * 1000) {
    return "RESULT_PENDING";
  }

  return rawStatus || "NS";
}

function mapRawMatch(m: any): Match {
  m = applyVerifiedResultBackfill(m);
  const minuteValue = parseMinuteValue(m.minute, m.minuteValue);
  const status = normalizeMatchStatus(m);

  return {
    // ========================================
    // BASIS INFORMATIE
    // ========================================
    id: m.id,
    date: m.date,
    kickoff: m.kickoff,
    league: m.league,
    
    // ========================================
    // TEAMS
    // ========================================
    homeTeamId: m.homeTeamId || "",
    awayTeamId: m.awayTeamId || "",
    homeTeamName: m.homeTeamName || "Home",
    awayTeamName: m.awayTeamName || "Away",
    homeLogo: m.homeLogo || "",
    awayLogo: m.awayLogo || "",
    
    // ========================================
    // STATUS & SCORE
    // ========================================
    status,
    score: m.score || undefined,
    ...(m.homeScore != null ? { homeScore: Number(m.homeScore) } : {}),
    ...(m.awayScore != null ? { awayScore: Number(m.awayScore) } : {}),
    minute: normalizeMinute(m.minute, minuteValue, m.extraTime, m.period),
    ...(minuteValue != null ? { minuteValue } : {}),
    ...(m.period != null ? { period: m.period } : {}),
    ...(m.extraTime != null ? { extraTime: m.extraTime } : {}),
    ...(m.liveUpdatedAt != null ? { liveUpdatedAt: m.liveUpdatedAt } : {}),
    
    // ========================================
    // VORM & RANKINGS
    // ========================================
    ...(m.homeForm ? { homeForm: m.homeForm } : {}),
    ...(m.awayForm ? { awayForm: m.awayForm } : {}),
    ...(m.homeElo ? { homeElo: m.homeElo } : {}),
    ...(m.awayElo ? { awayElo: m.awayElo } : {}),
    ...(m.homeClubElo != null ? { homeClubElo: m.homeClubElo } : {}),
    ...(m.awayClubElo != null ? { awayClubElo: m.awayClubElo } : {}),
    ...(m.homePos != null ? { homePos: m.homePos } : {}),
    ...(m.awayPos != null ? { awayPos: m.awayPos } : {}),
    
    // ========================================
    // CONTEXT & BELANG
    // ========================================
    ...(m.matchImportance != null ? { matchImportance: m.matchImportance } : {}),
    ...(m.roundLabel != null ? { roundLabel: m.roundLabel } : {}),
    ...(m.context ? { context: m.context } : {}),
    
    // ========================================
    // HEAD-TO-HEAD & AGGREGATE
    // ========================================
    ...(m.h2h ? { h2h: m.h2h } : {}),
    ...(m.h2hStatus ? { h2hStatus: m.h2hStatus } : {}),
    ...(m.aggregate ? { aggregate: m.aggregate } : {}),
    
    // ========================================
    // SEIZOEN STATISTIEKEN
    // ========================================
    ...(m.homeSeasonStats ? { homeSeasonStats: m.homeSeasonStats } : {}),
    ...(m.awaySeasonStats ? { awaySeasonStats: m.awaySeasonStats } : {}),
    
    // ========================================
    // RECENTE VORM
    // ========================================
    ...(m.homeRecent ? { homeRecent: m.homeRecent } : {}),
    ...(m.awayRecent ? { awayRecent: m.awayRecent } : {}),
    
    // ========================================
    // BLESSURES & OPSTELLINGEN
    // ========================================
    ...(m.homeInjuries ? { homeInjuries: m.homeInjuries } : {}),
    ...(m.awayInjuries ? { awayInjuries: m.awayInjuries } : {}),
    ...(m.lineupSummary ? { lineupSummary: m.lineupSummary } : {}),
    
    // ========================================
    // WEDSTRIJD OMSTANDIGHEDEN
    // ========================================
    ...(m.homeRestDays != null ? { homeRestDays: m.homeRestDays } : {}),
    ...(m.awayRestDays != null ? { awayRestDays: m.awayRestDays } : {}),
    ...(m.weather ? { weather: m.weather } : {}),
    ...(m.venue ? { venue: m.venue } : {}),
    
    // ========================================
    // GOAL TIMING
    // ========================================
    ...(m.homeGoalTiming ? { homeGoalTiming: m.homeGoalTiming } : {}),
    ...(m.awayGoalTiming ? { awayGoalTiming: m.awayGoalTiming } : {}),
    
    // ========================================
    // LIVE STATS
    // ========================================
    ...(m.liveStats ? { liveStats: m.liveStats } : {}),
    
    // ========================================
    // TEAM PROFIELEN
    // ========================================
    ...(m.homeTeamProfile ? { homeTeamProfile: m.homeTeamProfile } : {}),
    ...(m.awayTeamProfile ? { awayTeamProfile: m.awayTeamProfile } : {}),
    
    // ========================================
    // SCHEIDSRECHTER
    // ========================================
    ...(m.referee ? { referee: m.referee } : {}),
    
    // ========================================
    // MODEL EDGES
    // ========================================
    ...(m.modelEdges ? { modelEdges: m.modelEdges } : {}),
    ...(m.learningSummary ? { learningSummary: m.learningSummary } : {}),
    ...(m.marketCalibration ? { marketCalibration: m.marketCalibration } : {}),
    ...(m.review ? { review: m.review } : {}),
    
    // ========================================
    // MACHINE LEARNING
    // ========================================
    ...(m.featureVector ? { featureVector: m.featureVector } : {}),
    ...(m.ensembleMeta ? { ensembleMeta: m.ensembleMeta } : {}),
    ...(m.monteCarlo ? { monteCarlo: m.monteCarlo } : {}),
    
    // ========================================
    // BETTING DATA (OPTIONEEL)
    // ========================================
    ...(m.odds ? { odds: m.odds } : {}),
    ...(m.marketMovement ? { marketMovement: m.marketMovement } : {}),
    
    // ========================================
    // METADATA
    // ========================================
    ...(m.coverage ? { coverage: m.coverage } : {}),
    ...(m.importance ? { importance: m.importance } : {}),
    ...(m.worldCup2026 ? { worldCup2026: m.worldCup2026 } : {}),
    ...(m.dataCompleteness ? { dataCompleteness: m.dataCompleteness } : {}),
    ...(m.dataCompletenessScore != null ? { dataCompletenessScore: m.dataCompletenessScore } : {}),
    ...(m.phaseBucket ? { phaseBucket: m.phaseBucket } : {}),
    ...(m.leagueType ? { leagueType: m.leagueType } : {}),

    // ========================================
    // TOP 5 EXACTE-SCORE SELECTIE
    // ========================================
    ...(m.bestBetRank != null ? { bestBetRank: m.bestBetRank } : {}),
    ...(m.topConfidencePick != null ? { topConfidencePick: m.topConfidencePick } : {}),
    ...(m.topExactScorePick != null ? { topExactScorePick: m.topExactScorePick } : {}),
    ...(m.exactScoreConfidence != null ? { exactScoreConfidence: m.exactScoreConfidence } : {}),
    ...(m.exactScoreReasons ? { exactScoreReasons: m.exactScoreReasons } : {}),
  } as Match;
}

// ============================================================================
// EXPORT INTERFACE
// ============================================================================

export interface MatchesUpdate {
  matches: Match[];
  predictions: Record<string, Prediction>;
  lastRun: number | null;
  workerNeeded?: boolean;
}

// ============================================================================
// HOOFD FETCH FUNCTIE
// ============================================================================

export async function fetchMatchesAndPredictions(
  dateISO: string,
  signal?: AbortSignal
): Promise<MatchesUpdate> {
  // Check cache eerst
  const cached = readCache(dateISO);
  if (cached) return { ...cached, workerNeeded: false };

  try {
    const json = await fetchJsonEndpoint(`/api/matches?date=${dateISO}`, signal);
    if (json?.ok === false) {
      throw new Error(json.error || "Wedstrijddata tijdelijk niet beschikbaar");
    }

    const lastRun: number | null = json.lastRun || null;
    const rawMatches: any[] = json.matches || json.events || [];

    let predJson: any = { predictions: [] };
    try {
      predJson = await fetchJsonEndpoint(`/api/predict?date=${dateISO}`, signal);
    } catch {
      predJson = { predictions: [] };
    }
    if (predJson?.ok === false) {
      console.warn("[matchService] predict endpoint gaf een fout terug", predJson.error || predJson);
    }
    const rawPredictions: any[] = predJson.predictions || [];
    const update = buildMatchesUpdateFromPayload(rawMatches, rawPredictions, lastRun);
    writeCache(dateISO, update.matches, update.predictions, lastRun);
    
    return update;
    
  } catch (err) {
    const fallback = await fetchStaticDayData(dateISO, signal);
    if (fallback) {
      const lastRun: number | null = fallback.lastRun || null;
      const update = buildMatchesUpdateFromPayload(fallback.matches || [], fallback.predictions || [], lastRun);
      writeCache(dateISO, update.matches, update.predictions, lastRun);
      return update;
    }
    console.error("[matchService]", err);
    return {
      matches: [],
      predictions: {},
      lastRun: null,
      workerNeeded: true
    };
  }
}

// ============================================================================
// HELPER FUNCTIES (EXPORT VOOR GEBRUIK ELDERS)
// ============================================================================

export { isLiveMatch };

