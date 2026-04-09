// ============================================================================
// MATCH SERVICE - VOLLEDIG
// Haalt wedstrijden en voorspellingen op, inclusief ALLE mogelijke velden
// ============================================================================

import { Match, Prediction } from "../types";
import { normalizeMinute, parseMinuteValue } from "../shared/minute.js";

const CACHE_VERSION = "v5_complete_data";
const LIVE_CACHE_AGE_MS = 30_000;
const TODAY_CACHE_AGE_MS = 90_000;
const OTHER_CACHE_AGE_MS = 30 * 60_000;

// ============================================================================
// CACHE FUNCTIES
// ============================================================================

function storageKey(dateISO: string) {
  return `footypredict_${CACHE_VERSION}_${dateISO}`;
}

function isLiveMatch(match: any) {
  return (
    String(match?.status || "").toUpperCase() === "LIVE" ||
    match?.minute != null ||
    match?.minuteValue != null
  );
}

function getMaxCacheAge(dateISO: string, matches: any[]) {
  const today = new Date().toISOString().split("T")[0];
  if (dateISO !== today) return OTHER_CACHE_AGE_MS;
  if ((matches || []).some(isLiveMatch)) return LIVE_CACHE_AGE_MS;
  return TODAY_CACHE_AGE_MS;
}

function readCache(dateISO: string) {
  try {
    const raw = localStorage.getItem(storageKey(dateISO));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const matches = parsed.matches || [];
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

// ============================================================================
// MATCH MAPPING FUNCTIE - MET ALLE VELDEN
// ============================================================================

function mapRawMatch(m: any): Match {
  const minuteValue = parseMinuteValue(m.minute, m.minuteValue);

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
    status: m.status || "NS",
    score: m.score || undefined,
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
    // Fetch matches
    const res = await fetch(`/api/matches?date=${dateISO}`, { signal, cache: "no-store" });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const json = await res.json();

    const lastRun: number | null = json.lastRun || null;
    const rawMatches: any[] = json.matches || json.events || [];

    // Fetch predictions
    const predRes = await fetch(`/api/predict?date=${dateISO}`, { signal, cache: "no-store" });
    const predJson = predRes.ok ? await predRes.json() : { predictions: [] };
    const rawPredictions: any[] = predJson.predictions || [];

    // Als er geen data is
    if (rawMatches.length === 0 && rawPredictions.length === 0) {
      return { matches: [], predictions: {}, lastRun, workerNeeded: true };
    }

    // Map matches met ALLE velden
    const matches = rawMatches.map(mapRawMatch);
    
    // Build prediction map
    const predictionMap: Record<string, Prediction> = {};
    
    for (const prediction of rawPredictions) {
      if (prediction.matchId) {
        predictionMap[prediction.matchId] = prediction;
      }
    }

    // Merge match data into predictions voor convenience
    for (const rawMatch of rawMatches) {
      if (!rawMatch.id) continue;
      
      if (!predictionMap[rawMatch.id]) {
        predictionMap[rawMatch.id] = {} as Prediction;
      }
      
      // Voeg relevante match data toe aan prediction
      predictionMap[rawMatch.id] = {
        ...predictionMap[rawMatch.id],
        matchId: rawMatch.id,
        
        // Kopieer nuttige velden voor convenience in predictions
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
        ...(rawMatch.homeForm ? { homeForm: rawMatch.homeForm } : {}),
        ...(rawMatch.awayForm ? { awayForm: rawMatch.awayForm } : {}),
      };
    }

    // Write to cache
    writeCache(dateISO, matches, predictionMap, lastRun);
    
    return { 
      matches, 
      predictions: predictionMap, 
      lastRun, 
      workerNeeded: false 
    };
    
  } catch (err) {
    console.error("[matchService]", err);
    return { 
      matches: [], 
      predictions: {}, 
      lastRun: null, 
      workerNeeded: false 
    };
  }
}

// ============================================================================
// HELPER FUNCTIES (EXPORT VOOR GEBRUIK ELDERS)
// ============================================================================

export { isLiveMatch };

