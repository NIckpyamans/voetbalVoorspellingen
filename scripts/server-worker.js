#!/usr/bin/env node

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { normalizeMinute, parseMinuteValue } from "../shared/minute.js";
import {
  WORLD_CUP_LEAGUE,
  WORLD_FRIENDLY_LEAGUE,
  TEAMS as WORLD_CUP_TEAMS,
  buildWorldCup2026ProjectionFromStore,
  buildWorldCup2026ReadinessFromStore,
  isWorldCup2026Team,
} from "../shared/worldCup2026.js";
import {
  buildBacktestSummaryFromReviews,
  buildDataCompletenessAudit,
  buildModelPerformanceFromReviews,
  buildOddsIntegrationReadiness,
  calibrateConfidenceWithBacktest,
  calibrateOutcomeProbabilities,
} from "./prediction-analytics.js";
import { fetchOddsAtPrediction } from "./odds-provider.js";
import { writeJsonFile, writeSplitDataFiles } from "./worker/archive.js";
import {
  addDaysToDateKey,
  buildRefreshDateWindow as buildConfiguredRefreshDateWindow,
  buildRetainedDateSet as buildConfiguredRetainedDateSet,
  toAmsterdamDateKey,
} from "./worker/date-window.js";
import { buildCupSheetsFromMatches, mergeCupSheets } from "../shared/cupSheets.js";
import { loadLocalEnv, readDatabaseFeatureContext, syncStoreToDatabase } from "../shared/database.js";
import {
  createSafeFetch,
  fetchBbcScheduledEvents as fetchBbcScheduledEventsSource,
  fetchEspnScoreboardEvents as fetchEspnScoreboardEventsSource,
  fetchExternalJson,
  fetchFbrefSnapshot as fetchFbrefSnapshotSource,
  fetchOpenfootballProfile as fetchOpenfootballProfileSource,
  resolveEspnTeamLogoByName as resolveEspnTeamLogoByNameSource,
  fetchText,
  fetchUnderstatSnapshot as fetchUnderstatSnapshotSource,
  fetchWithTimeout,
  safeFetchText,
} from "./worker/data-collection.js";
import {
  ensureH2HContract,
  lookupCuratedResultBackfill,
  matchHasFinalScore,
  mergeH2HResultLists,
  normalizeStoredMatchReliability,
  parseScoreToGoals,
} from "./worker/validation.js";
import {
  buildFeatureImportance,
  buildFeatureVector,
  buildPoissonScoreModel,
  buildRiskProfile,
  hashSeed,
  qualityGateForCompleteness,
  scoreDataCompleteness,
  seededRandom,
  sourceReliabilityScore,
} from "./worker/prediction.js";

const SOFA = "https://api.sofascore.com/api/v1";
const THESPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json";
const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
const sofaFetchCircuit = { blocked: false, failures: 0, logged: false };
const ROOT = process.cwd();
const DATA_FILE = path.resolve(process.cwd(), "server_data.json");
const SPLIT_DATA_DIR = path.resolve(process.cwd(), "data");
const COMPETITION_ARCHIVE_DIR = path.join(SPLIT_DATA_DIR, "competitions");
const TRAINING_SNAPSHOT_FILE = path.resolve(process.cwd(), "training", "training-snapshot.json");

loadLocalEnv(process.cwd());

const LEAGUES = [
  { country: "netherlands", name: "eredivisie", label: "Netherlands - Eredivisie", type: "league" },
  { country: "netherlands", name: "eerste divisie", label: "Netherlands - Eerste Divisie", type: "league" },
  { country: "netherlands", name: "knvb beker", label: "Netherlands - KNVB Beker", type: "cup" },
  { country: "england", name: "premier league", label: "England - Premier League", type: "league" },
  { country: "england", name: "championship", label: "England - Championship", type: "league" },
  { country: "germany", name: "bundesliga", label: "Germany - Bundesliga", type: "league" },
  { country: "germany", name: "2. bundesliga", label: "Germany - 2. Bundesliga", type: "league" },
  { country: "spain", name: "laliga", label: "Spain - LaLiga", type: "league" },
  { country: "spain", name: "la liga", label: "Spain - LaLiga", type: "league" },
  { country: "spain", name: "laliga2", label: "Spain - LaLiga2", type: "league" },
  { country: "spain", name: "segunda", label: "Spain - LaLiga2", type: "league" },
  { country: "italy", name: "serie a", label: "Italy - Serie A", type: "league" },
  { country: "italy", name: "serie b", label: "Italy - Serie B", type: "league" },
  { country: "france", name: "ligue 1", label: "France - Ligue 1", type: "league" },
  { country: "france", name: "ligue 2", label: "France - Ligue 2", type: "league" },
  { country: "portugal", name: "liga portugal", label: "Portugal - Liga Portugal", type: "league" },
  { country: "portugal", name: "liga portugal 2", label: "Portugal - Liga Portugal 2", type: "league" },
  { country: "belgium", name: "pro league", label: "Belgium - Pro League", type: "league" },
  { country: "belgium", name: "challenger pro league", label: "Belgium - Challenger Pro League", type: "league" },
  { country: "", name: "champions league", label: "Europe - Champions League", type: "cup" },
  { country: "", name: "europa league", label: "Europe - Europa League", type: "cup" },
  { country: "", name: "conference league", label: "Europe - Conference League", type: "cup" },
  { country: "", name: "fifa world cup", label: WORLD_CUP_LEAGUE, type: "cup" },
];

const LEAGUE_CALIBRATION_PROFILES = {
  "England - Premier League": { confidenceBias: 0.01, drawBias: -0.01, homeBias: 0 },
  "Spain - LaLiga": { confidenceBias: 0.008, drawBias: 0.006, homeBias: 0 },
  "Italy - Serie A": { confidenceBias: 0.006, drawBias: 0.012, homeBias: 0 },
  "Germany - Bundesliga": { confidenceBias: 0.004, drawBias: -0.008, homeBias: 0.004 },
  "France - Ligue 1": { confidenceBias: 0.005, drawBias: 0.004, homeBias: 0 },
  "Netherlands - Eredivisie": { confidenceBias: 0.007, drawBias: -0.01, homeBias: 0.003 },
  default: { confidenceBias: 0, drawBias: 0, homeBias: 0 },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const toFiniteNumber = (value, fallback = null) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

function buildRetainedDateSet(baseDateKey) {
  return buildConfiguredRetainedDateSet(baseDateKey, HISTORY_KEEP_DAYS_BACK, HISTORY_KEEP_DAYS_FORWARD);
}

function buildRefreshDateWindow(todayKey) {
  return buildConfiguredRefreshDateWindow(todayKey, process.env.FOOTYAI_DATE_WINDOW);
}

function trimScoreMatrix(scoreMatrix, limit = MAX_SCORE_MATRIX_ENTRIES) {
  return Object.fromEntries(
    Object.entries(scoreMatrix || {})
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .slice(0, limit)
  );
}

function getLeagueCalibrationProfile(leagueLabel) {
  return LEAGUE_CALIBRATION_PROFILES[leagueLabel] || LEAGUE_CALIBRATION_PROFILES.default;
}

function mergeLeagueCalibrationProfile(base, dynamicProfile = null) {
  if (!dynamicProfile) return base;
  return {
    confidenceBias: Number(base?.confidenceBias || 0) + Number(dynamicProfile?.confidenceBias || 0),
    drawBias: Number(base?.drawBias || 0) + Number(dynamicProfile?.drawBias || 0),
    homeBias: Number(base?.homeBias || 0) + Number(dynamicProfile?.homeBias || 0),
  };
}

function applyLeagueCalibration(probabilities, leagueLabel, dynamicProfile = null) {
  const profile = mergeLeagueCalibrationProfile(getLeagueCalibrationProfile(leagueLabel), dynamicProfile);
  const home = clamp(Number(probabilities?.homeProb || 0) + Number(profile.homeBias || 0), 0.01, 0.98);
  const draw = clamp(Number(probabilities?.drawProb || 0) + Number(profile.drawBias || 0), 0.01, 0.98);
  const away = clamp(Number(probabilities?.awayProb || 0) - Number(profile.homeBias || 0), 0.01, 0.98);
  const total = home + draw + away;
  return {
    homeProb: Number((home / total).toFixed(4)),
    drawProb: Number((draw / total).toFixed(4)),
    awayProb: Number((away / total).toFixed(4)),
    profile,
  };
}

function rebuildLeagueCalibrationProfilesFromReviews(store) {
  const reviews = Object.values(store?.postMatchReviews || {}).filter(Boolean);
  const windows = [7, 30, 90];
  const generatedAt = new Date().toISOString();
  const buildProfile = (items, windowDays) => {
    const byLeague = {};
    for (const item of items) {
      const league = String(item?.league || "").trim();
      if (!league) continue;
      if (!byLeague[league]) byLeague[league] = { matches: 0, actualDraw: 0, predictedDraw: 0, homeMissBias: 0, outcomeHits: 0 };
      const row = byLeague[league];
      row.matches += 1;
      row.outcomeHits += item?.outcomeHit ? 1 : 0;
      const actual = String(item?.actualScore || "").split("-").map(Number);
      const pred = String(item?.predictedScore || "").split("-").map(Number);
      const actualDraw = Number.isFinite(actual[0]) && Number.isFinite(actual[1]) && actual[0] === actual[1] ? 1 : 0;
      const predDraw = Number.isFinite(pred[0]) && Number.isFinite(pred[1]) && pred[0] === pred[1] ? 1 : 0;
      row.actualDraw += actualDraw;
      row.predictedDraw += predDraw;
      if (item?.actualOutcome === "H" && item?.predictedOutcome !== "H") row.homeMissBias += 1;
      if (item?.actualOutcome !== "H" && item?.predictedOutcome === "H") row.homeMissBias -= 1;
    }
    const profiles = {};
    for (const [league, row] of Object.entries(byLeague)) {
      if (Number(row.matches || 0) < 8) continue;
      const sampleStability = clamp(Number(row.matches || 0) / (windowDays <= 7 ? 18 : windowDays <= 30 ? 36 : 60), 0, 1);
      const outcomeHitRate = Number(row.outcomeHits || 0) / Number(row.matches || 1);
      const hitRateStability = clamp(1 - Math.abs(outcomeHitRate - 0.52) * 1.7, 0, 1);
      const stabilityScore = Number((sampleStability * 0.72 + hitRateStability * 0.28).toFixed(3));
      const drawRateActual = Number(row.actualDraw || 0) / Number(row.matches || 1);
      const drawRatePred = Number(row.predictedDraw || 0) / Number(row.matches || 1);
      const drawBias = clamp((drawRateActual - drawRatePred) * 0.08, -0.035, 0.035);
      const homeBias = clamp((Number(row.homeMissBias || 0) / Number(row.matches || 1)) * 0.03, -0.025, 0.025);
      const confidenceBias = clamp((outcomeHitRate - 0.52) * 0.04, -0.025, 0.025);
      profiles[league] = {
        matches: Number(row.matches || 0),
        windowDays,
        stabilityScore,
        confidenceBias: Number(confidenceBias.toFixed(4)),
        drawBias: Number(drawBias.toFixed(4)),
        homeBias: Number(homeBias.toFixed(4)),
        updatedAt: generatedAt,
      };
    }
    return profiles;
  };
  const now = Date.now();
  const profilesByWindow = {};
  for (const days of windows) {
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    profilesByWindow[String(days)] = buildProfile(
      reviews.filter((review) => Number(review?.createdAt || 0) >= cutoff || Date.parse(review?.date || "") >= cutoff),
      days
    );
  }
  const allLeagues = new Set(Object.values(profilesByWindow).flatMap((profiles) => Object.keys(profiles || {})));
  const selectedProfiles = {};
  for (const league of allLeagues) {
    const candidates = windows
      .map((days) => profilesByWindow[String(days)]?.[league])
      .filter(Boolean)
      .sort((a, b) => Number(b.stabilityScore || 0) - Number(a.stabilityScore || 0));
    const selected = candidates[0];
    if (!selected || Number(selected.stabilityScore || 0) < 0.45) continue;
    selectedProfiles[league] = {
      ...selected,
      selectedWindow: selected.windowDays,
      availableWindows: candidates.map((item) => ({
        windowDays: item.windowDays,
        matches: item.matches,
        stabilityScore: item.stabilityScore,
      })),
    };
  }
  const rollbackProfiles = { ...(store.leagueCalibrationRollbackProfiles || {}) };
  for (const alert of store.backtestSegmentation?.driftAlerts || []) {
    if (alert?.scope !== "league" || alert?.severity !== "high") continue;
    const key = String(alert.key || "");
    const previous = store.leagueCalibrationProfiles?.[key];
    if (previous) rollbackProfiles[key] = { ...previous, rollbackAt: generatedAt, rollbackReason: "performance_drift" };
    delete selectedProfiles[key];
  }
  store.leagueCalibrationProfilesByWindow = profilesByWindow;
  store.leagueCalibrationRollbackProfiles = rollbackProfiles;
  store.leagueCalibrationProfiles = selectedProfiles;
}

function quarterBucketFromMinute(minuteLike) {
  const minute = parseMinuteValue(minuteLike);
  if (!Number.isFinite(minute)) return "unknown";
  if (minute <= 15) return "q1_0_15";
  if (minute <= 30) return "q2_16_30";
  if (minute <= 45) return "q3_31_45_plus";
  if (minute <= 60) return "q4_46_60";
  if (minute <= 75) return "q5_61_75";
  return "q6_76_90_plus";
}

function emptyGoalQuarters() {
  return {
    q1_0_15: 0,
    q2_16_30: 0,
    q3_31_45_plus: 0,
    q4_46_60: 0,
    q5_61_75: 0,
    q6_76_90_plus: 0,
    unknown: 0,
  };
}

function normalizePostMatchStats(raw, source, sourceDetail = null) {
  const home = raw?.home || {};
  const away = raw?.away || {};
  const quarters = raw?.goalQuarters || {};
  return {
    source: source || "unknown",
    sourceDetail: sourceDetail || null,
    home: {
      possession: toFiniteNumber(home.possession),
      shots: toFiniteNumber(home.shots),
      shotsOnTarget: toFiniteNumber(home.shotsOnTarget),
      bigChances: toFiniteNumber(home.bigChances),
      corners: toFiniteNumber(home.corners),
      freeKicks: toFiniteNumber(home.freeKicks),
      fouls: toFiniteNumber(home.fouls),
    },
    away: {
      possession: toFiniteNumber(away.possession),
      shots: toFiniteNumber(away.shots),
      shotsOnTarget: toFiniteNumber(away.shotsOnTarget),
      bigChances: toFiniteNumber(away.bigChances),
      corners: toFiniteNumber(away.corners),
      freeKicks: toFiniteNumber(away.freeKicks),
      fouls: toFiniteNumber(away.fouls),
    },
    goalQuarters: {
      home: { ...emptyGoalQuarters(), ...(quarters.home || {}) },
      away: { ...emptyGoalQuarters(), ...(quarters.away || {}) },
      total: { ...emptyGoalQuarters(), ...(quarters.total || {}) },
    },
  };
}

function compactMonteCarlo(monteCarlo) {
  if (!monteCarlo || typeof monteCarlo !== "object") return null;
  return {
    active: !!monteCarlo.active,
    simulations: Number(monteCarlo.simulations || 0),
    weight: monteCarlo.weight != null ? Number(monteCarlo.weight) : null,
    homeProb: monteCarlo.homeProb != null ? Number(monteCarlo.homeProb) : null,
    drawProb: monteCarlo.drawProb != null ? Number(monteCarlo.drawProb) : null,
    awayProb: monteCarlo.awayProb != null ? Number(monteCarlo.awayProb) : null,
    bttsProb: monteCarlo.bttsProb != null ? Number(monteCarlo.bttsProb) : null,
    over25Prob: monteCarlo.over25Prob != null ? Number(monteCarlo.over25Prob) : null,
    under25Prob: monteCarlo.under25Prob != null ? Number(monteCarlo.under25Prob) : null,
    topScore: monteCarlo.topScore || null,
    topScoreProb: monteCarlo.topScoreProb != null ? Number(monteCarlo.topScoreProb) : null,
    agreement: monteCarlo.agreement != null ? Number(monteCarlo.agreement) : null,
    scoreMatrix: trimScoreMatrix(monteCarlo.scoreMatrix, 8),
  };
}

function compactPredictionEntry(prediction, historical = false) {
  if (!prediction || typeof prediction !== "object") return prediction;
  const compact = {
    ...prediction,
    scoreMatrix: trimScoreMatrix(prediction.scoreMatrix),
    ...(prediction.monteCarlo ? { monteCarlo: compactMonteCarlo(prediction.monteCarlo) } : {}),
  };

  if (historical) {
    delete compact.featureVector;
    delete compact.analysis;
    if (compact.ensembleMeta) {
      compact.ensembleMeta = {
        active: !!compact.ensembleMeta.active,
        baseModel: compact.ensembleMeta.baseModel,
        blendModel: compact.ensembleMeta.blendModel,
        blendWeightBase: compact.ensembleMeta.blendWeightBase,
        blendWeightHeuristic: compact.ensembleMeta.blendWeightHeuristic,
        blendWeightMonteCarlo: compact.ensembleMeta.blendWeightMonteCarlo,
        agreement: compact.ensembleMeta.agreement,
        baseProbabilities: compact.ensembleMeta.baseProbabilities,
        heuristicProbabilities: compact.ensembleMeta.heuristicProbabilities,
        monteCarloProbabilities: compact.ensembleMeta.monteCarloProbabilities,
      };
    }
  }

  return compact;
}

function stableDigest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hashObject(value) {
  return stableDigest(JSON.stringify(value ?? null));
}

function isoFromMs(value) {
  const ms = Number(value || 0);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function isoFromTimestamp(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return isoFromMs(value);
}

function getPredictionProbabilities(prediction) {
  return {
    home: Number(prediction?.homeProb || 0),
    draw: Number(prediction?.drawProb || 0),
    away: Number(prediction?.awayProb || 0),
  };
}

function normalizeOddsAtPrediction(prediction) {
  const odds = prediction?.odds || prediction?.oddsAtPrediction || null;
  const marketCalibration = prediction?.marketCalibration || prediction?.modelEdges?.marketCalibration || null;
  const hasMarketProfile =
    !!marketCalibration &&
    (
      !!marketCalibration.source ||
      Number(marketCalibration.closingCoverage || 0) > 0 ||
      (Array.isArray(marketCalibration.bookmakerSignals) && marketCalibration.bookmakerSignals.length > 0)
    );
  const base = {
    oddsAtPrediction: null,
    oddsStatus: hasMarketProfile ? "historical_market_profile_only" : "missing",
    oddsMissingReason: hasMarketProfile
      ? "Historisch marktprofiel aanwezig, maar geen actuele bookmaker odds op voorspellingstijdstip."
      : "Geen actuele bookmaker odds op voorspellingstijdstip.",
  };
  if (!odds || typeof odds !== "object") return base;
  const home = Number(odds.home);
  const draw = Number(odds.draw);
  const away = Number(odds.away);
  const validCount = [home, draw, away].filter((value) => Number.isFinite(value) && value > 1).length;
  if (!validCount) return base;
  const oddsAtPrediction = {
    home: Number.isFinite(home) && home > 1 ? home : null,
    draw: Number.isFinite(draw) && draw > 1 ? draw : null,
    away: Number.isFinite(away) && away > 1 ? away : null,
    closingHome: Number(odds.closingHome) > 1 ? Number(odds.closingHome) : null,
    closingDraw: Number(odds.closingDraw) > 1 ? Number(odds.closingDraw) : null,
    closingAway: Number(odds.closingAway) > 1 ? Number(odds.closingAway) : null,
    bookmaker: odds.bookmaker || odds.source || null,
    market: odds.market || "1X2",
    capturedAt: odds.capturedAt || odds.timestamp || null,
    closingCapturedAt: odds.closingCapturedAt || odds.closingTimestamp || null,
  };
  return {
    oddsAtPrediction,
    oddsStatus: validCount === 3 ? "available" : "partial",
    oddsMissingReason: validCount === 3 ? null : "Niet alle 1X2 odds waren beschikbaar op voorspellingstijdstip.",
  };
}

function resolveOddsAtPrediction(prediction) {
  return normalizeOddsAtPrediction(prediction).oddsAtPrediction;
}

function buildTeamIdentity(homeId, awayId, homeName, awayName, source = "unknown") {
  const homeKey = homeId ? `id:${homeId}` : `name:${normalizeName(homeName)}`;
  const awayKey = awayId ? `id:${awayId}` : `name:${normalizeName(awayName)}`;
  const status = homeId && awayId ? "provider_ids" : homeKey && awayKey ? "name_fallback" : "incomplete";
  return {
    status,
    source,
    home: {
      id: homeId || null,
      name: homeName || null,
      normalizedName: normalizeName(homeName),
      key: homeKey || null,
      identityType: homeId ? "provider_id" : "name_fallback",
    },
    away: {
      id: awayId || null,
      name: awayName || null,
      normalizedName: normalizeName(awayName),
      key: awayKey || null,
      identityType: awayId ? "provider_id" : "name_fallback",
    },
  };
}

function resolveLineupStatus(lineupSummary) {
  if (lineupSummary?.confirmed) return "confirmed";
  if (lineupSummary?.home || lineupSummary?.away) return "partial";
  return "missing";
}

function resolveRefereeStatus(refereeProfile) {
  if (Number(refereeProfile?.matches || 0) > 0) return "historical_profile";
  if (refereeProfile?.name) return "named_estimate";
  return "missing";
}

function buildFeatureSourceMetadata(match, prediction, generatedAt, oddsDiagnostics = null) {
  const source = prediction?.dataSource || match?.dataSource || "unknown";
  const homeSources = match?.homeSeasonStats?.externalSources || prediction?.homeTeamProfile?.externalSources || [];
  const awaySources = match?.awaySeasonStats?.externalSources || prediction?.awayTeamProfile?.externalSources || [];
  const sourceList = [...new Set([...homeSources, ...awaySources])];
  const marketCalibration = prediction?.marketCalibration || prediction?.modelEdges?.marketCalibration || match?.marketCalibration || null;
  const oddsStatus = oddsDiagnostics?.oddsStatus || prediction?.oddsStatus || null;
  const sourceAsOf = prediction?.sourceAsOf || match?.sourceAsOf || {};
  const h2hAsOf = prediction?.h2h?.asOf || prediction?.h2h?.sourceTimestamp || match?.h2h?.asOf || match?.h2h?.sourceTimestamp || sourceAsOf.h2h;
  const teamIdentity = prediction?.teamIdentity || match?.teamIdentity || null;
  const field = (available, fieldSource, asOf = null, sourceTimestampKnown = false, note = null) => ({
    available: !!available,
    source: fieldSource || source,
    asOf,
    sourceTimestampKnown: !!sourceTimestampKnown,
    note,
  });
  const fields = {
    fixture: field(true, source, sourceAsOf.fixture || generatedAt, true, "Worker-run as_of voor fixturedata."),
    teamIdentity: field(
      !!(teamIdentity?.home?.key && teamIdentity?.away?.key),
      teamIdentity?.source || source,
      sourceAsOf.fixture || generatedAt,
      true,
      teamIdentity?.status === "provider_ids"
        ? "Provider team-id aanwezig voor beide teams."
        : "Provider team-id ontbreekt deels; stabiele naam-key opgeslagen als fallback."
    ),
    h2h: field(
      Number(prediction?.h2h?.played || match?.h2h?.played || 0) > 0,
      prediction?.h2h?.source || match?.h2h?.source || "historical results",
      h2hAsOf || generatedAt,
      !!h2hAsOf,
      h2hAsOf
        ? "H2H-profiel heeft een expliciete as_of/source timestamp."
        : "Historische resultaten zijn pre-match gefilterd, maar losse bron-publicatietijden ontbreken nog."
    ),
    form: field(
      Number(prediction?.homeTeamProfile?.matches || prediction?.homeRecent?.gamesPlayed || 0) > 0 ||
        Number(prediction?.awayTeamProfile?.matches || prediction?.awayRecent?.gamesPlayed || 0) > 0,
      "derived recent matches",
      sourceAsOf.homeForm && sourceAsOf.awayForm ? [sourceAsOf.homeForm, sourceAsOf.awayForm].sort().slice(-1)[0] : generatedAt,
      !!(sourceAsOf.homeForm && sourceAsOf.awayForm),
      sourceAsOf.homeForm && sourceAsOf.awayForm
        ? "Teamvorm gebruikt cache-as_of per team."
        : "Vorm is afgeleid uit opgeslagen wedstrijden; per bronrecord ontbreekt nog as_of."
    ),
    standings: field(
      Number(prediction?.homePos || match?.homePos || 0) > 0 && Number(prediction?.awayPos || match?.awayPos || 0) > 0,
      "standings snapshot",
      sourceAsOf.standings || generatedAt,
      !!sourceAsOf.standings,
      sourceAsOf.standings
        ? "Standings-cache as_of vastgelegd."
        : "Standings worden als worker-snapshot opgeslagen, nog niet per competitie met source timestamp."
    ),
    xgShots: field(
      sourceList.includes("Understat") ||
        sourceList.includes("FBref") ||
        prediction?.homeTeamProfile?.xG != null ||
        match?.homeSeasonStats?.xG != null,
      sourceList.filter((item) => item === "Understat" || item === "FBref").join(" + ") || "derived season stats",
      sourceAsOf.understat || sourceAsOf.fbref || sourceAsOf.homeSeasonStats || sourceAsOf.awaySeasonStats || generatedAt,
      !!(sourceAsOf.understat || sourceAsOf.fbref || sourceAsOf.homeSeasonStats || sourceAsOf.awaySeasonStats),
      sourceAsOf.understat || sourceAsOf.fbref
        ? "xG/shot snapshot-cache as_of vastgelegd."
        : "xG/shot snapshots hebben bronnaam, maar nog geen veldniveau published_at."
    ),
    marketProfile: field(
      !!marketCalibration,
      marketCalibration?.source || "football-data.co.uk historical market profile",
      sourceAsOf.marketProfile || generatedAt,
      !!sourceAsOf.marketProfile,
      oddsStatus === "available" ? "Actuele odds apart opgeslagen." : "Historisch marktprofiel; geen echte odds_at_prediction."
    ),
    oddsAtPrediction: field(
      oddsStatus === "available" || oddsStatus === "partial",
      prediction?.oddsAtPrediction?.bookmaker || prediction?.odds?.bookmaker || "bookmaker odds",
      prediction?.oddsAtPrediction?.capturedAt || prediction?.odds?.capturedAt || null,
      !!(prediction?.oddsAtPrediction?.capturedAt || prediction?.odds?.capturedAt),
      oddsStatus || "missing"
    ),
    lineups: field(
      !!(prediction?.lineupSummary?.confirmed || match?.lineupSummary?.confirmed),
      prediction?.lineupSummary?.source || match?.lineupSummary?.source || "lineup source",
      sourceAsOf.lineups || generatedAt,
      !!sourceAsOf.lineups,
      prediction?.lineupSummary?.confirmed || match?.lineupSummary?.confirmed ? "Bevestigd in worker-run." : "Nog open of niet beschikbaar."
    ),
    referee: field(
      Number(prediction?.refereeProfile?.matches || match?.refereeProfile?.matches || 0) > 0 ||
        !!(prediction?.refereeProfile?.name || match?.refereeProfile?.name),
      prediction?.refereeProfile?.source || match?.refereeProfile?.source || "referee profile",
      sourceAsOf.referee || sourceAsOf.marketProfile || generatedAt,
      !!(sourceAsOf.referee || sourceAsOf.marketProfile),
      Number(prediction?.refereeProfile?.matches || match?.refereeProfile?.matches || 0) > 0
        ? "Scheidsrechterprofiel is historisch samengevoegd met as_of van marktprofiel."
        : "Scheidsrechternaam bekend, historisch profiel ontbreekt nog."
    ),
  };
  const values = Object.values(fields).filter((item) => item.available);
  const timestampKnown = values.filter((item) => item.sourceTimestampKnown);
  return {
    generatedAt,
    schemaVersion: "feature-source-v2",
    fields,
    coverage: {
      availableFields: values.length,
      timestampKnownFields: timestampKnown.length,
      timestampCoverage: values.length ? Number((timestampKnown.length / values.length).toFixed(3)) : 0,
      unknownTimestampFields: Object.entries(fields)
        .filter(([, value]) => value.available && !value.sourceTimestampKnown)
        .map(([key]) => key),
    },
  };
}

function buildLeakageGuard(match, prediction, options = {}) {
  const generatedAt = options.generatedAt || prediction?.generatedAt || null;
  const cutoffAt = options.cutoffAt || prediction?.cutoffAt || generatedAt || null;
  const kickoff = match?.kickoff || prediction?.kickoff || null;
  const cutoffMs = Date.parse(cutoffAt || "");
  const kickoffMs = Date.parse(kickoff || "");
  const cutoffBeforeKickoff =
    Number.isFinite(cutoffMs) && Number.isFinite(kickoffMs) ? cutoffMs <= kickoffMs : null;
  const snapshotBacked = !!options.snapshotBacked || prediction?.evaluationSource === "prediction_snapshot";
  const featureSourceMetadata =
    options.featureSourceMetadata || prediction?.featureSourceMetadata || prediction?.inputSnapshot?.featureSourceMetadata || null;
  const sourceTimestampCoverage = Number(featureSourceMetadata?.coverage?.timestampCoverage || 0);
  const sourceTimestampsKnown =
    !!prediction?.sourceTimestampsKnown ||
    !!prediction?.inputSnapshot?.sourceTimestampsKnown ||
    (!!featureSourceMetadata?.coverage?.availableFields && sourceTimestampCoverage >= 0.95);
  return {
    generatedAt,
    cutoffAt,
    kickoff,
    cutoffBeforeKickoff,
    snapshotBacked,
    snapshotStatus: options.snapshotStatus || null,
    fieldLevelAsOfTracked: !!featureSourceMetadata,
    sourceTimestampsKnown,
    sourceTimestampCoverage,
    unknownTimestampFields: featureSourceMetadata?.coverage?.unknownTimestampFields || [],
    risk:
      cutoffBeforeKickoff === false
        ? "high"
        : sourceTimestampsKnown
          ? "low"
          : snapshotBacked
            ? "medium"
            : "unknown",
    note:
      cutoffBeforeKickoff === false
        ? "Cutoff ligt na kickoff; review mag niet als lekvrij gelden."
        : sourceTimestampsKnown
          ? "Bronvelden hebben expliciete as_of/source timestamps."
          : "Pre-match snapshot bewaakt cutoff, maar bronvelden hebben nog geen volledig as_of spoor.",
  };
}

function buildPredictionInputSnapshot(match, prediction, metadata = {}) {
  return {
    matchId: match?.id || prediction?.matchId || null,
    date: match?.date || prediction?.date || null,
    kickoff: match?.kickoff || null,
    league: match?.league || prediction?.league || null,
    homeTeam: match?.homeTeamName || prediction?.homeTeam || null,
    awayTeam: match?.awayTeamName || prediction?.awayTeam || null,
    teamIdentity: match?.teamIdentity || prediction?.teamIdentity || null,
    dataSource: match?.dataSource || prediction?.dataSource || null,
    sourceAsOf: prediction?.sourceAsOf || match?.sourceAsOf || null,
    homeForm: match?.homeForm || prediction?.homeForm || null,
    awayForm: match?.awayForm || prediction?.awayForm || null,
    homeRestDays: match?.homeRestDays ?? prediction?.homeRestDays ?? null,
    awayRestDays: match?.awayRestDays ?? prediction?.awayRestDays ?? null,
    h2hStatus: match?.h2hStatus || prediction?.h2hStatus || null,
    homePos: match?.homePos ?? null,
    awayPos: match?.awayPos ?? null,
    matchImportance: match?.matchImportance ?? prediction?.matchImportance ?? null,
    dataCompleteness: prediction?.dataCompleteness || match?.dataCompleteness || null,
    qualityGate: prediction?.qualityGate || match?.qualityGate || null,
    lineupStatus: prediction?.lineupStatus || match?.lineupStatus || null,
    refereeStatus: prediction?.refereeStatus || match?.refereeStatus || null,
    oddsProviderStatus: prediction?.oddsProviderStatus || match?.oddsProviderStatus || null,
    marketCalibration: prediction?.marketCalibration || prediction?.modelEdges?.marketCalibration || match?.marketCalibration || null,
    learningSummary: prediction?.learningSummary || prediction?.modelEdges?.learningEdge || match?.learningSummary || null,
    competitionReliability: prediction?.competitionReliability || prediction?.modelEdges?.leagueReliability || match?.competitionReliability || null,
    phaseReliability: prediction?.phaseReliability || prediction?.modelEdges?.phaseReliability || match?.phaseReliability || null,
    refereeProfile: prediction?.refereeProfile || prediction?.modelEdges?.refereeProfile || match?.refereeProfile || null,
    dbFeatureContext: prediction?.dbFeatureContext || match?.dbFeatureContext || null,
    featureSourceMetadata: metadata.featureSourceMetadata || prediction?.featureSourceMetadata || null,
  };
}

function ensurePredictionSnapshotStore(store) {
  if (!store.predictionSnapshots) store.predictionSnapshots = {};
  if (!store.predictionSnapshotIndex) store.predictionSnapshotIndex = {};
}

function registerPredictionSnapshot(store, match, prediction, generatedAtMs) {
  ensurePredictionSnapshotStore(store);
  const matchId = match?.id || prediction?.matchId;
  if (!matchId || !prediction) return null;

  const generatedAt = isoFromMs(generatedAtMs) || new Date().toISOString();
  const kickoffMs = Date.parse(match?.kickoff || "");
  const status = String(match?.status || "").toUpperCase();
  const isPreMatchStatus = !["LIVE", "HT", "FT", "AET", "PEN"].includes(status);
  const isBeforeKickoff = !Number.isFinite(kickoffMs) || Number(generatedAtMs || Date.now()) <= kickoffMs;
  if (!isPreMatchStatus || !isBeforeKickoff) {
    return {
      predictionId: prediction.predictionId || null,
      generatedAt,
      cutoffAt: generatedAt,
      modelVersion: MODEL_VERSION,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      snapshotStored: false,
      snapshotStatus: "not_pre_match",
    };
  }

  const oddsDiagnostics = normalizeOddsAtPrediction(prediction);
  const oddsAtPrediction = oddsDiagnostics.oddsAtPrediction;
  const featureSourceMetadata = buildFeatureSourceMetadata(match, prediction, generatedAt, oddsDiagnostics);
  const inputSnapshot = buildPredictionInputSnapshot(match, prediction, { featureSourceMetadata });
  const inputSnapshotHash = hashObject(inputSnapshot);
  const predictionId = `pred_${stableDigest(`${matchId}|${generatedAt}|${inputSnapshotHash}`).slice(0, 18)}`;
  const predictionWithSourceMetadata = { ...prediction, featureSourceMetadata, inputSnapshot };
  const leakageGuard = buildLeakageGuard(match, predictionWithSourceMetadata, {
    generatedAt,
    cutoffAt: generatedAt,
    snapshotBacked: true,
    snapshotStatus: "pre_match",
    featureSourceMetadata,
  });
  const predictedOutcome = getPredictedOutcome(prediction);
  const hasRoiOdd = !!oddForOutcome(oddsAtPrediction, predictedOutcome);
  const snapshot = {
    predictionId,
    matchId,
    generatedAt,
    cutoffAt: generatedAt,
    kickoff: match?.kickoff || null,
    status: "pre_match",
    schemaVersion: PREDICTION_SNAPSHOT_SCHEMA_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    modelVersion: MODEL_VERSION,
    algorithmVersion: prediction?.ensembleMeta?.baseModel || "dixon-coles-poisson",
    workerVersion: MODEL_VERSION,
    date: match?.date || prediction?.date || null,
    league: match?.league || prediction?.league || null,
    season: match?.season || prediction?.season || null,
    homeTeam: match?.homeTeamName || prediction?.homeTeam || null,
    awayTeam: match?.awayTeamName || prediction?.awayTeam || null,
    homeTeamId: match?.homeTeamId || null,
    awayTeamId: match?.awayTeamId || null,
    teamIdentity: match?.teamIdentity || prediction?.teamIdentity || null,
    dbFeatureContext: prediction?.dbFeatureContext || match?.dbFeatureContext || null,
    inputSnapshot,
    inputSnapshotHash,
    features: prediction?.featureVector || null,
    probabilities: getPredictionProbabilities(prediction),
    confidence: Number(prediction?.confidence || 0),
    confidenceRaw: Number(prediction?.confidenceRaw ?? prediction?.confidence ?? 0),
    calibration: {
      confidence: prediction?.modelEdges?.confidenceCalibration || null,
      probabilities: prediction?.modelEdges?.probabilityCalibration || null,
    },
    expectedScore: {
      home: Number(prediction?.predHomeGoals || 0),
      away: Number(prediction?.predAwayGoals || 0),
      label: `${Number(prediction?.predHomeGoals || 0)}-${Number(prediction?.predAwayGoals || 0)}`,
    },
    explanation: {
      modelEdges: prediction?.modelEdges || null,
      exactScoreReasons: prediction?.exactScoreReasons || [],
      riskProfile: prediction?.modelEdges?.riskProfile || prediction?.riskProfile || null,
    },
    oddsAtPrediction,
    oddsStatus: oddsDiagnostics.oddsStatus,
    oddsMissingReason: oddsDiagnostics.oddsMissingReason,
    oddsProviderStatus: prediction?.oddsProviderStatus || match?.oddsProviderStatus || oddsDiagnostics.oddsStatus,
    oddsProviderDiagnostics: prediction?.oddsProviderDiagnostics || match?.oddsProviderDiagnostics || null,
    roiStatus: hasRoiOdd ? "pending_result" : "odds_missing",
    clvStatus: "closing_odds_missing",
    featureSourceMetadata,
    leakageGuard,
    dataCompleteness: prediction?.dataCompleteness || null,
    missingData: prediction?.dataCompleteness?.missing || [],
    prediction: {
      ...compactPredictionEntry(prediction, false),
      predictionId,
      generatedAt,
      cutoffAt: generatedAt,
      modelVersion: MODEL_VERSION,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      inputSnapshotHash,
      oddsAtPrediction,
      oddsStatus: oddsDiagnostics.oddsStatus,
      oddsMissingReason: oddsDiagnostics.oddsMissingReason,
      roiStatus: hasRoiOdd ? "pending_result" : "odds_missing",
      clvStatus: "closing_odds_missing",
      dbFeatureContext: prediction?.dbFeatureContext || match?.dbFeatureContext || null,
      featureSourceMetadata,
      leakageGuard,
    },
  };

  if (!store.predictionSnapshots[predictionId]) {
    store.predictionSnapshots[predictionId] = snapshot;
  }

  const ids = Array.isArray(store.predictionSnapshotIndex[matchId])
    ? store.predictionSnapshotIndex[matchId]
    : [];
  if (!ids.includes(predictionId)) ids.push(predictionId);
  ids.sort((a, b) =>
    Date.parse(store.predictionSnapshots[a]?.generatedAt || "") -
    Date.parse(store.predictionSnapshots[b]?.generatedAt || "")
  );
  store.predictionSnapshotIndex[matchId] = ids;

  return {
    predictionId,
    generatedAt,
    cutoffAt: generatedAt,
    modelVersion: MODEL_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    inputSnapshotHash,
    oddsAtPrediction,
    oddsStatus: oddsDiagnostics.oddsStatus,
    oddsMissingReason: oddsDiagnostics.oddsMissingReason,
    roiStatus: hasRoiOdd ? "pending_result" : "odds_missing",
    clvStatus: "closing_odds_missing",
    featureSourceMetadata,
    leakageGuard,
    snapshotStored: true,
    snapshotStatus: "pre_match",
  };
}

function compactPredictionSnapshots(store) {
  ensurePredictionSnapshotStore(store);
  const entries = Object.entries(store.predictionSnapshots || {})
    .filter(([, snapshot]) => snapshot?.predictionId && snapshot?.matchId)
    .sort((a, b) => Date.parse(b[1]?.generatedAt || "") - Date.parse(a[1]?.generatedAt || ""))
    .slice(0, MAX_PREDICTION_SNAPSHOTS);
  store.predictionSnapshots = Object.fromEntries(entries);

  const index = {};
  for (const snapshot of Object.values(store.predictionSnapshots || {})) {
    if (!snapshot?.matchId || !snapshot?.predictionId) continue;
    if (!index[snapshot.matchId]) index[snapshot.matchId] = [];
    index[snapshot.matchId].push(snapshot.predictionId);
  }
  for (const ids of Object.values(index)) {
    ids.sort((a, b) =>
      Date.parse(store.predictionSnapshots[a]?.generatedAt || "") -
      Date.parse(store.predictionSnapshots[b]?.generatedAt || "")
    );
  }
  store.predictionSnapshotIndex = index;
}

function selectPredictionForReview(store, match, fallbackPrediction) {
  const ids = store.predictionSnapshotIndex?.[match?.id] || [];
  const kickoffMs = Date.parse(match?.kickoff || "");
  const candidates = ids
    .map((id) => store.predictionSnapshots?.[id])
    .filter((snapshot) => snapshot?.prediction)
    .filter((snapshot) => {
      const generatedMs = Date.parse(snapshot.generatedAt || "");
      return !Number.isFinite(kickoffMs) || !Number.isFinite(generatedMs) || generatedMs <= kickoffMs;
    })
    .sort((a, b) => Date.parse(b.generatedAt || "") - Date.parse(a.generatedAt || ""));

  const snapshot = candidates[0] || null;
  if (snapshot) {
    return {
      ...snapshot.prediction,
      predictionId: snapshot.predictionId,
      generatedAt: snapshot.generatedAt,
      cutoffAt: snapshot.cutoffAt,
      modelVersion: snapshot.modelVersion,
      featureSchemaVersion: snapshot.featureSchemaVersion,
      inputSnapshotHash: snapshot.inputSnapshotHash,
      oddsAtPrediction: snapshot.oddsAtPrediction || snapshot.prediction?.oddsAtPrediction || null,
      oddsStatus: snapshot.oddsStatus || snapshot.prediction?.oddsStatus || null,
      oddsMissingReason: snapshot.oddsMissingReason || snapshot.prediction?.oddsMissingReason || null,
      roiStatus: snapshot.roiStatus || snapshot.prediction?.roiStatus || null,
      clvStatus: snapshot.clvStatus || snapshot.prediction?.clvStatus || null,
      featureSourceMetadata: snapshot.featureSourceMetadata || snapshot.prediction?.featureSourceMetadata || snapshot.inputSnapshot?.featureSourceMetadata || null,
      leakageGuard: snapshot.leakageGuard || snapshot.prediction?.leakageGuard || buildLeakageGuard(match, snapshot.prediction, {
        generatedAt: snapshot.generatedAt,
        cutoffAt: snapshot.cutoffAt,
        snapshotBacked: true,
        snapshotStatus: snapshot.status || "pre_match",
        featureSourceMetadata: snapshot.featureSourceMetadata || snapshot.inputSnapshot?.featureSourceMetadata || null,
      }),
      evaluationSource: "prediction_snapshot",
    };
  }

  return fallbackPrediction
    ? {
        ...fallbackPrediction,
        evaluationSource: "current_prediction_fallback",
        leakageRisk: "possible_post_match_overwrite",
        leakageGuard: buildLeakageGuard(match, fallbackPrediction, {
          generatedAt: fallbackPrediction?.generatedAt || null,
          cutoffAt: fallbackPrediction?.cutoffAt || fallbackPrediction?.generatedAt || null,
          snapshotBacked: false,
          snapshotStatus: "fallback",
        }),
      }
    : null;
}

function probabilityForOutcome(prediction, outcome) {
  const probabilities = {
    H: Number(prediction?.homeProb || 0),
    D: Number(prediction?.drawProb || 0),
    A: Number(prediction?.awayProb || 0),
  };
  return Number(probabilities[outcome] || 0);
}

function calculateBrierScore(prediction, actualOutcome) {
  const probabilities = {
    H: Number(prediction?.homeProb || 0),
    D: Number(prediction?.drawProb || 0),
    A: Number(prediction?.awayProb || 0),
  };
  const score = Object.entries(probabilities).reduce((sum, [outcome, probability]) => {
    const expected = outcome === actualOutcome ? 1 : 0;
    return sum + Math.pow(probability - expected, 2);
  }, 0);
  return Number(score.toFixed(4));
}

function calculateLogLoss(prediction, actualOutcome) {
  const probability = clamp(probabilityForOutcome(prediction, actualOutcome), 0.000001, 0.999999);
  return Number((-Math.log(probability)).toFixed(4));
}

function oddForOutcome(oddsAtPrediction, outcome) {
  if (!oddsAtPrediction) return null;
  const value =
    outcome === "H" ? oddsAtPrediction.home :
    outcome === "D" ? oddsAtPrediction.draw :
    oddsAtPrediction.away;
  const odd = Number(value);
  return Number.isFinite(odd) && odd > 1 ? odd : null;
}

function calculateRoi(prediction, predictedOutcome, actualOutcome) {
  const odd = oddForOutcome(prediction?.oddsAtPrediction || prediction?.odds, predictedOutcome);
  if (!odd) return null;
  return Number((predictedOutcome === actualOutcome ? odd - 1 : -1).toFixed(4));
}

function closingOddForOutcome(oddsAtPrediction, outcome) {
  if (!oddsAtPrediction) return null;
  const value =
    outcome === "H" ? oddsAtPrediction.closingHome :
    outcome === "D" ? oddsAtPrediction.closingDraw :
    oddsAtPrediction.closingAway;
  const odd = Number(value);
  return Number.isFinite(odd) && odd > 1 ? odd : null;
}

function calculateClv(prediction, predictedOutcome) {
  const odds = prediction?.oddsAtPrediction || prediction?.odds;
  const preMatchOdd = oddForOutcome(odds, predictedOutcome);
  const closingOdd = closingOddForOutcome(odds, predictedOutcome);
  if (!preMatchOdd || !closingOdd) return null;
  return Number(((preMatchOdd - closingOdd) / closingOdd).toFixed(4));
}

function pruneUpdatedMap(store, valueKey, updatedKey, ttl, now, maxEntries = null) {
  const values = store[valueKey] || {};
  const updated = store[updatedKey] || {};
  for (const key of Object.keys(updated)) {
    if (now - Number(updated[key] || 0) > ttl) {
      delete updated[key];
      delete values[key];
    }
  }

  if (maxEntries && Object.keys(updated).length > maxEntries) {
    const keep = new Set(
      Object.entries(updated)
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
        .slice(0, maxEntries)
        .map(([key]) => key)
    );
    for (const key of Object.keys(updated)) {
      if (!keep.has(key)) {
        delete updated[key];
        delete values[key];
      }
    }
  }

  store[valueKey] = values;
  store[updatedKey] = updated;
}

function pruneEmbeddedUpdatedMap(store, valueKey, ttl, now, maxEntries = null) {
  const values = store[valueKey] || {};
  for (const key of Object.keys(values)) {
    if (now - Number(values[key]?.updated || 0) > ttl) delete values[key];
  }

  if (maxEntries && Object.keys(values).length > maxEntries) {
    const keep = new Set(
      Object.entries(values)
        .sort((a, b) => Number(b[1]?.updated || 0) - Number(a[1]?.updated || 0))
        .slice(0, maxEntries)
        .map(([key]) => key)
    );
    for (const key of Object.keys(values)) {
      if (!keep.has(key)) delete values[key];
    }
  }

  store[valueKey] = values;
}

const FORM_TTL = 6 * 60 * 60 * 1000;
const INJURY_TTL = 4 * 60 * 60 * 1000;
const SEASON_TTL = 12 * 60 * 60 * 1000;
const STANDINGS_TTL = 60 * 60 * 1000;
const H2H_TTL = 3 * 24 * 60 * 60 * 1000;
const WEATHER_TTL = 6 * 60 * 60 * 1000;
const EVENT_TTL = 12 * 60 * 60 * 1000;
const CLUB_ELO_TTL = 12 * 60 * 60 * 1000;
const MARKET_TTL = 24 * 60 * 60 * 1000;
const SNAPSHOT_TTL = 3 * 24 * 60 * 60 * 1000;
const OPENFOOTBALL_TTL = 14 * 24 * 60 * 60 * 1000;
const INTERNATIONAL_AVAILABILITY_TTL = 12 * 60 * 60 * 1000;
const SQUAD_TTL = 30 * 24 * 60 * 60 * 1000;
const EMPTY_SQUAD_RETRY_TTL = 12 * 60 * 60 * 1000;
const TRANSFER_WINDOW_SQUAD_TTL = 3 * 24 * 60 * 60 * 1000;
const TRANSFER_WATCH_TTL = 24 * 60 * 60 * 1000;
const MAX_SQUAD_FETCHES_PER_RUN = 8;
const SQUAD_FETCH_MIN_DELAY = 450;
const ROSTER_BACKFILL_VERSION = "v5-fill-empty-rosters";
const MAX_WIKIPEDIA_SQUAD_FETCHES_PER_RUN = 6;
const MAX_WIKIDATA_SQUAD_FETCHES_PER_RUN = 4;
const MAX_WIKIPEDIA_ROSTER_PLAYERS = 65;
const MAX_FORZA_SQUAD_FETCHES_PER_RUN = 3;
const MAX_FOOTBALL_DATA_SQUAD_FETCHES_PER_RUN = 3;
const MAX_REEP_IDENTITY_FETCHES_PER_RUN = 2;
const MIN_COMPLETE_ROSTER_PLAYERS = 22;
const MIN_USABLE_ROSTER_PLAYERS = 16;
// Bewaar gespeelde dagen ruim genoeg voor analyse, terugkijken en model-review.
const HISTORY_KEEP_DAYS_BACK = 365;
const HISTORY_KEEP_DAYS_FORWARD = 14;
const MAX_REVIEWS = 2500;
const MAX_PREDICTION_SNAPSHOTS = 5000;
const MAX_SCORE_MATRIX_ENTRIES = 10;
const MODEL_VERSION = "v23-calibrated-odds-ledger";
const FEATURE_SCHEMA_VERSION = "feature-v2";
const PREDICTION_SNAPSHOT_SCHEMA_VERSION = "prediction-snapshot-v4";
const MAX_EVENT_CACHE = 300;
const MONTE_CARLO_RUNS = 10000;
const MONTE_CARLO_WEIGHT = 0.14;
const MAX_H2H_CACHE = 500;
const MAX_WEATHER_CACHE = 220;
const MAX_MARKET_PROFILES = 64;
const MAX_SNAPSHOT_CACHE = 48;
const MAX_OPENFOOTBALL_CACHE = 48;
const MAX_INTERNATIONAL_AVAILABILITY = 160;
const MAX_TEAM_SQUADS = 850;
const MAX_TEAM_TRANSFERS = 850;
const sportsDbSquadFetchState = {
  count: 0,
  lastAt: 0,
  blockedUntil: 0,
  loggedLimit: false,
  loggedRateLimit: false,
};
const safeFetch = createSafeFetch({
  sofaBase: SOFA,
  sofaFetchCircuit,
  sportsDbSquadFetchState,
  logger: console,
});
const openSquadSourceState = {
  wikidataCount: 0,
  wikipediaCount: 0,
  forzaCount: 0,
  footballDataCount: 0,
  reepCount: 0,
  lastAt: 0,
  loggedLimit: false,
  loggedForzaBlocked: false,
  loggedFootballDataConfig: false,
  loggedReepBlocked: false,
};
const TEAM_RECENT_MATCH_WINDOW = 10;
const TEAM_FORM_BADGE_WINDOW = 5;

const TRANSFER_WINDOW_PERIODS = [
  { label: "winter transferwindow", startMonth: 1, startDay: 1, endMonth: 2, endDay: 3 },
  { label: "zomer transferwindow", startMonth: 6, startDay: 10, endMonth: 9, endDay: 2 },
];
const TRANSFER_WINDOW_WATCH_BUFFER_DAYS = 14;

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function transferWindowBounds(year, period, bufferDays = 0) {
  const start = addDays(new Date(Date.UTC(year, period.startMonth - 1, period.startDay, 0, 0, 0)), -bufferDays);
  const end = addDays(new Date(Date.UTC(year, period.endMonth - 1, period.endDay, 23, 59, 59)), bufferDays);
  if (end < start) end.setUTCFullYear(end.getUTCFullYear() + 1);
  return { start, end };
}

function getTransferWindowState(now = Date.now()) {
  const current = new Date(now);
  const candidates = [];
  for (const year of [current.getUTCFullYear() - 1, current.getUTCFullYear(), current.getUTCFullYear() + 1]) {
    for (const period of TRANSFER_WINDOW_PERIODS) {
      const active = transferWindowBounds(year, period, 0);
      const watch = transferWindowBounds(year, period, TRANSFER_WINDOW_WATCH_BUFFER_DAYS);
      candidates.push({ ...period, year, active, watch });
    }
  }

  const activePeriod = candidates.find((period) => current >= period.active.start && current <= period.active.end);
  if (activePeriod) {
    return {
      active: true,
      watchMode: true,
      label: activePeriod.label,
      startAt: activePeriod.active.start.toISOString(),
      endAt: activePeriod.active.end.toISOString(),
      nextWindowLabel: activePeriod.label,
      refreshEveryDays: Math.round(TRANSFER_WINDOW_SQUAD_TTL / (24 * 60 * 60 * 1000)),
    };
  }

  const watchPeriod = candidates.find((period) => current >= period.watch.start && current <= period.watch.end);
  if (watchPeriod) {
    return {
      active: false,
      watchMode: true,
      label: `${watchPeriod.label} bewaking`,
      startAt: watchPeriod.active.start.toISOString(),
      endAt: watchPeriod.active.end.toISOString(),
      nextWindowLabel: watchPeriod.label,
      refreshEveryDays: Math.round(TRANSFER_WINDOW_SQUAD_TTL / (24 * 60 * 60 * 1000)),
    };
  }

  const nextPeriod = candidates
    .filter((period) => period.active.start > current)
    .sort((a, b) => a.active.start.getTime() - b.active.start.getTime())[0];

  return {
    active: false,
    watchMode: false,
    label: "buiten transferwindow",
    startAt: nextPeriod?.active.start.toISOString() || null,
    endAt: nextPeriod?.active.end.toISOString() || null,
    nextWindowLabel: nextPeriod?.label || "onbekend",
    refreshEveryDays: Math.round(SQUAD_TTL / (24 * 60 * 60 * 1000)),
  };
}

const MARKET_LEAGUE_CODES = {
  "England - Premier League": "E0",
  "England - Championship": "E1",
  "Scotland - Premiership": "SC0",
  "Scotland - Championship": "SC1",
  "Netherlands - Eredivisie": "N1",
  "Netherlands - Eerste Divisie": "N2",
  "Germany - Bundesliga": "D1",
  "Germany - 2. Bundesliga": "D2",
  "Spain - LaLiga": "SP1",
  "Spain - LaLiga2": "SP2",
  "Spain - LaLiga 2": "SP2",
  "Italy - Serie A": "I1",
  "Italy - Serie B": "I2",
  "France - Ligue 1": "F1",
  "France - Ligue 2": "F2",
  "Portugal - Liga Portugal": "P1",
  "Portugal - Liga Portugal 2": "P2",
  "Belgium - Pro League": "B1",
  "Belgium - Challenger Pro League": "B2",
  "Turkey - Super Lig": "T1",
  "Greece - Super League": "G1",
  "Austria - Bundesliga": "AUT",
  "Switzerland - Super League": "SWZ",
  "Denmark - Superliga": "DNK",
  "Sweden - Allsvenskan": "SWE",
  "Norway - Eliteserien": "NOR",
  "Poland - Ekstraklasa": "POL",
};

const TEAM_FORM_HISTORY_LEAGUES = Object.keys(MARKET_LEAGUE_CODES);

const SPORTSDB_LEAGUE_IDS = {
  "Belgium - Pro League": "4338",
  "England - Championship": "4329",
  "England - Premier League": "4328",
  "France - Ligue 1": "4334",
  "Germany - Bundesliga": "4331",
  "Italy - Serie A": "4332",
  "Netherlands - Eredivisie": "4337",
  "Spain - LaLiga": "4335",
};

const SPORTSDB_NAME_TO_LABEL = {
  "Belgian Pro League": "Belgium - Pro League",
  "Dutch Eredivisie": "Netherlands - Eredivisie",
  "English League Championship": "England - Championship",
  "English Premier League": "England - Premier League",
  "French Ligue 1": "France - Ligue 1",
  "German Bundesliga": "Germany - Bundesliga",
  "Italian Serie A": "Italy - Serie A",
  "Spanish La Liga": "Spain - LaLiga",
};

const ESPN_SCOREBOARD_LEAGUES = {
  "Belgium - Pro League": "bel.1",
  "England - Championship": "eng.2",
  "England - Premier League": "eng.1",
  "Europe - Champions League": "uefa.champions",
  "Europe - Conference League": "uefa.europa.conf",
  "Europe - Europa League": "uefa.europa",
  "France - Ligue 1": "fra.1",
  "Germany - 2. Bundesliga": "ger.2",
  "Germany - Bundesliga": "ger.1",
  "Italy - Serie A": "ita.1",
  "Netherlands - Eredivisie": "ned.1",
  "Portugal - Liga Portugal": "por.1",
  "Spain - LaLiga": "esp.1",
  "World - FIFA World Cup 2026": "fifa.world",
};

const DATA_SCOUT_SOURCES = [
  {
    key: "sofascore",
    name: "Sofascore",
    category: "optionele live/details",
    freeUse: "publieke voetbaldata",
    data: ["wedstrijden", "live status", "scores", "lineups", "standen"],
    priority: "optioneel",
  },
  {
    key: "espn-scoreboard",
    name: "ESPN Scoreboard",
    category: "scores/logo",
    freeUse: "publieke scoreboard endpoint",
    data: ["fixtures", "live/FT scores", "clublogo's", "competitiedekking"],
    priority: "hoog",
  },
  {
    key: "thesportsdb",
    name: "TheSportsDB",
    category: "fixtures/logo",
    freeUse: "gratis API-laag",
    data: ["fixtures", "teamlogo's", "basic events"],
    priority: "hoog",
  },
  {
    key: "forza-football",
    name: "Forza Football",
    category: "selecties/transfers",
    freeUse: "publieke teampagina's, alleen als aanvullende fallback",
    data: ["spelerslijsten", "posities", "unavailable spelers", "transfers"],
    priority: "fallback",
  },
  {
    key: "football-data-org",
    name: "football-data.org",
    category: "officiele API-selecties",
    freeUse: "gratis API-tier met optionele token",
    data: ["teams", "squads waar beschikbaar", "competitiemetadata"],
    priority: "fallback",
  },
  {
    key: "reep",
    name: "Reep Football",
    category: "team-ID koppeling",
    freeUse: "open football ID-laag waar bereikbaar",
    data: ["teamnamen", "alias/ID-koppeling", "bronmatching"],
    priority: "fallback",
  },
  {
    key: "football-data",
    name: "football-data.co.uk",
    category: "historie/odds",
    freeUse: "gratis CSV-bestanden",
    data: ["historische uitslagen", "closing odds", "shots", "cards", "referee"],
    priority: "hoog",
  },
  {
    key: "openligadb",
    name: "OpenLigaDB",
    category: "scores/logo",
    freeUse: "gratis openbare API",
    data: ["Duitse fixtures", "uitslagen", "teamlogo's"],
    priority: "medium",
  },
  {
    key: "openfootball",
    name: "openfootball",
    category: "historische H2H",
    freeUse: "open GitHub datasets",
    data: ["historische wedstrijden", "H2H-backfill", "competitiegeschiedenis"],
    priority: "hoog",
  },
  {
    key: "understat",
    name: "Understat",
    category: "xG-profielen",
    freeUse: "publieke pagina snapshots",
    data: ["xG", "xGA", "shotkwaliteit", "teamprofielen"],
    priority: "pilot",
  },
  {
    key: "fbref",
    name: "FBref",
    category: "shots/splits",
    freeUse: "publieke pagina snapshots, rate-limited",
    data: ["schoten", "home/away splits", "teamstatistieken"],
    priority: "pilot",
  },
  {
    key: "bbc-fixtures",
    name: "BBC fixtures",
    category: "fixture-check",
    freeUse: "publieke fixturepagina's",
    data: ["topwedstrijd controle", "noodbackfill"],
    priority: "veiligheidsnet",
  },
];

const BBC_COMPETITION_TO_LABEL = {
  "UEFA Champions League": "Europe - Champions League",
  "UEFA Europa League": "Europe - Europa League",
  "UEFA Conference League": "Europe - Conference League",
  "Premier League": "England - Premier League",
  "Championship": "England - Championship",
  "Bundesliga": "Germany - Bundesliga",
  "Spanish La Liga": "Spain - LaLiga",
  "Italian Serie A": "Italy - Serie A",
  "French Ligue 1": "France - Ligue 1",
  "Dutch Eredivisie": "Netherlands - Eredivisie",
  "Portuguese Primeira Liga": "Portugal - Liga Portugal",
  "Belgian First Division A": "Belgium - Pro League",
};


const CURATED_FIXTURE_BACKFILL = [
  {
    date: "2026-05-04",
    time: "21:00",
    league: "England - Premier League",
    tournament: "Premier League",
    country: "England",
    home: "Everton",
    away: "Manchester City",
    sourceNote: "BBC fixtures backfill",
  },
  {
    date: "2026-05-05",
    time: "18:45",
    league: "Netherlands - Eredivisie",
    tournament: "Eredivisie",
    country: "Netherlands",
    home: "RKC Waalwijk",
    away: "Willem II",
    sourceNote: "TheSportsDB result safety backfill",
  },
  {
    date: "2026-05-05",
    time: "21:00",
    league: "Europe - Champions League",
    tournament: "Champions League",
    country: "Europe",
    home: "Arsenal",
    away: "Atletico Madrid",
    round: "Semi-finals",
    aggregateLabel: "Aggregate 1-1",
    sourceNote: "BBC fixtures backfill",
  },
  {
    date: "2026-05-06",
    time: "21:00",
    league: "Europe - Champions League",
    tournament: "Champions League",
    country: "Europe",
    home: "Bayern Munich",
    away: "Paris Saint-Germain",
    round: "Semi-finals",
    aggregateLabel: "Aggregate 4-5",
    sourceNote: "UEFA result safety backfill",
  },
  {
    date: "2026-05-07",
    time: "21:00",
    league: "Europe - Europa League",
    tournament: "Europa League",
    country: "Europe",
    home: "Freiburg",
    away: "Sporting Braga",
    round: "Semi-finals",
    sourceNote: "UEFA fixtures backfill",
  },
  {
    date: "2026-05-07",
    time: "21:00",
    league: "Europe - Europa League",
    tournament: "Europa League",
    country: "Europe",
    home: "Aston Villa",
    away: "Nottingham Forest",
    round: "Semi-finals",
    sourceNote: "UEFA fixtures backfill",
  },
  {
    date: "2026-05-07",
    time: "21:00",
    league: "Europe - Conference League",
    tournament: "Conference League",
    country: "Europe",
    home: "Crystal Palace",
    away: "Shakhtar Donetsk",
    round: "Semi-finals",
    sourceNote: "UEFA fixtures backfill",
  },
  {
    date: "2026-05-07",
    time: "21:00",
    league: "Europe - Conference League",
    tournament: "Conference League",
    country: "Europe",
    home: "Strasbourg",
    away: "Rayo Vallecano",
    round: "Semi-finals",
    sourceNote: "UEFA fixtures backfill",
  },
];

const CURATED_RESULT_BACKFILL = [
  {
    date: "2026-05-23",
    home: "Hull City",
    away: "Southampton",
    score: null,
    status: "CANCELLED",
    sourceNote: "Championship play-off fixture replaced; Hull City played Middlesbrough instead",
  },
  {
    date: "2026-05-05",
    home: "RKC Waalwijk",
    away: "Willem II",
    score: "0-1",
    status: "FT",
    sourceNote: "TheSportsDB verified result backfill",
  },
  {
    date: "2026-05-05",
    home: "Arsenal",
    away: "Atletico Madrid",
    score: "1-0",
    status: "FT",
    sourceNote: "manual verified result backfill",
  },
  {
    date: "2026-05-06",
    home: "Bayern Munich",
    away: "Paris Saint-Germain",
    score: "1-1",
    status: "FT",
    sourceNote: "manual verified result backfill",
  },
  {
    date: "2026-05-07",
    home: "Freiburg",
    away: "Sporting Braga",
    score: "3-1",
    status: "FT",
    sourceNote: "UEFA verified semi-final result backfill",
  },
  {
    date: "2026-05-07",
    home: "Aston Villa",
    away: "Nottingham Forest",
    score: "4-0",
    status: "FT",
    sourceNote: "UEFA verified semi-final result backfill",
  },
  {
    date: "2026-05-07",
    home: "Crystal Palace",
    away: "Shakhtar Donetsk",
    score: "2-1",
    status: "FT",
    sourceNote: "UEFA verified semi-final result backfill",
  },
  {
    date: "2026-05-07",
    home: "Strasbourg",
    away: "Rayo Vallecano",
    score: "0-1",
    status: "FT",
    sourceNote: "UEFA verified semi-final result backfill",
  },
  {
    date: "2026-05-20",
    home: "Freiburg",
    away: "Aston Villa",
    score: "0-3",
    status: "FT",
    sourceNote: "verified Europa League final result backfill",
  },
];

const CURATED_H2H_BACKFILL = {
  "arsenal__atletico madrid": [
    {
      date: "2018-05-03",
      home: "Atletico Madrid",
      away: "Arsenal",
      score: "1-0",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2025-10-21",
      home: "Arsenal",
      away: "Atletico Madrid",
      score: "4-0",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2026-04-28",
      home: "Arsenal",
      away: "Atletico Madrid",
      score: "1-1",
      source: "aiscore-h2h-backfill",
    },
  ],
  "rkc waalwijk__willem ii": [
    {
      date: "2026-02-08",
      home: "Willem II",
      away: "RKC Waalwijk",
      score: "2-1",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2025-10-18",
      home: "RKC Waalwijk",
      away: "Willem II",
      score: "2-3",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2024-09-15",
      home: "Willem II",
      away: "RKC Waalwijk",
      score: "3-0",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2025-01-26",
      home: "RKC Waalwijk",
      away: "Willem II",
      score: "2-0",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2022-02-06",
      home: "Willem II",
      away: "RKC Waalwijk",
      score: "3-1",
      source: "aiscore-h2h-backfill",
    },
  ],
  "aston villa__nottingham forest": [
    {
      date: "2026-04-12",
      home: "Nottingham Forest",
      away: "Aston Villa",
      score: "1-1",
      source: "sportsmole-h2h-backfill",
    },
    {
      date: "2026-01-03",
      home: "Aston Villa",
      away: "Nottingham Forest",
      score: "3-1",
      source: "sportsmole-h2h-backfill",
    },
    {
      date: "2025-04-05",
      home: "Aston Villa",
      away: "Nottingham Forest",
      score: "2-1",
      source: "avfc-history-h2h-backfill",
    },
    {
      date: "2024-12-14",
      home: "Nottingham Forest",
      away: "Aston Villa",
      score: "2-1",
      source: "sportsmole-h2h-backfill",
    },
    {
      date: "2024-02-24",
      home: "Aston Villa",
      away: "Nottingham Forest",
      score: "4-2",
      source: "avfc-history-h2h-backfill",
    },
  ],
  "bayern munich__paris saint germain": [
    {
      date: "2024-11-26",
      home: "Bayern Munich",
      away: "Paris Saint-Germain",
      score: "1-0",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2025-11-05",
      home: "Paris Saint-Germain",
      away: "Bayern Munich",
      score: "1-2",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2025-07-06",
      home: "Paris Saint-Germain",
      away: "Bayern Munich",
      score: "2-0",
      source: "aiscore-h2h-backfill",
    },
  ],
};
const OPENLIGADB_LEAGUES = {
  bl1: "Germany - Bundesliga",
  bl2: "Germany - 2. Bundesliga",
};

const OPENFOOTBALL_COMPETITIONS = {
  "England - Premier League": "eng.1",
  "England - Championship": "eng.2",
  "Germany - Bundesliga": "de.1",
  "Germany - 2. Bundesliga": "de.2",
  "Spain - LaLiga": "es.1",
  "Spain - LaLiga2": "es.2",
  "Spain - LaLiga 2": "es.2",
  "Italy - Serie A": "it.1",
  "Italy - Serie B": "it.2",
  "France - Ligue 1": "fr.1",
  "France - Ligue 2": "fr.2",
  "Netherlands - Eredivisie": "nl.1",
};

const UNDERSTAT_LEAGUE_CODES = {
  "England - Premier League": "EPL",
  "Spain - LaLiga": "La_liga",
  "Germany - Bundesliga": "Bundesliga",
  "Italy - Serie A": "Serie_A",
  "France - Ligue 1": "Ligue_1",
};

const FBREF_RELEASE_CODES = {
  "England - Premier League": { country: "ENG", tier: "1st", advanced: true },
  "England - Championship": { country: "ENG", tier: "2nd", advanced: false },
  "Spain - LaLiga": { country: "ESP", tier: "1st", advanced: true },
  "France - Ligue 1": { country: "FRA", tier: "1st", advanced: true },
  "Germany - Bundesliga": { country: "GER", tier: "1st", advanced: true },
  "Italy - Serie A": { country: "ITA", tier: "1st", advanced: true },
  "Portugal - Liga Portugal": { country: "POR", tier: "1st", advanced: false },
  "Netherlands - Eredivisie": { country: "NED", tier: "1st", advanced: false },
};

process.on("unhandledRejection", (err) => {
  console.error("[worker] unhandledRejection:", err?.message || err);
  process.exitCode = 1;
});

process.on("uncaughtException", (err) => {
  console.error("[worker] uncaughtException:", err?.message || err);
  process.exitCode = 1;
});

function samplePoisson(lambda, random) {
  const safeLambda = clamp(Number(lambda || 0), 0.05, 7);
  const threshold = Math.exp(-safeLambda);
  let product = 1;
  let goals = 0;

  do {
    goals += 1;
    product *= random();
  } while (product > threshold && goals < 10);

  return Math.max(0, goals - 1);
}

function normalizeTriple(model) {
  const homeProb = Math.max(0, Number(model?.homeProb || 0));
  const drawProb = Math.max(0, Number(model?.drawProb || 0));
  const awayProb = Math.max(0, Number(model?.awayProb || 0));
  const total = homeProb + drawProb + awayProb || 1;
  return {
    homeProb: homeProb / total,
    drawProb: drawProb / total,
    awayProb: awayProb / total,
  };
}

function blendTriple(base, extra, extraWeight) {
  const safeBase = normalizeTriple(base);
  const safeExtra = normalizeTriple(extra);
  const weight = clamp(Number(extraWeight || 0), 0, 0.5);
  return normalizeTriple({
    homeProb: safeBase.homeProb * (1 - weight) + safeExtra.homeProb * weight,
    drawProb: safeBase.drawProb * (1 - weight) + safeExtra.drawProb * weight,
    awayProb: safeBase.awayProb * (1 - weight) + safeExtra.awayProb * weight,
  });
}

function blendScoreMatrices(baseMatrix, simulationMatrix, simulationWeight = MONTE_CARLO_WEIGHT) {
  const weight = clamp(Number(simulationWeight || 0), 0, 0.5);
  const keys = new Set([
    ...Object.keys(baseMatrix || {}),
    ...Object.keys(simulationMatrix || {}),
  ]);
  const combined = {};
  for (const key of keys) {
    const value =
      Number(baseMatrix?.[key] || 0) * (1 - weight) +
      Number(simulationMatrix?.[key] || 0) * weight;
    if (value > 0.004) combined[key] = Number(value.toFixed(4));
  }
  return combined;
}

function runMonteCarloSimulation({ homeXG, awayXG, seed, runs = MONTE_CARLO_RUNS }) {
  const random = seededRandom(seed);
  const scoreCounts = {};
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let btts = 0;
  let over25 = 0;
  let over35 = 0;

  for (let i = 0; i < runs; i += 1) {
    const homeGoals = samplePoisson(homeXG, random);
    const awayGoals = samplePoisson(awayXG, random);
    const key = `${homeGoals}-${awayGoals}`;
    scoreCounts[key] = (scoreCounts[key] || 0) + 1;

    if (homeGoals > awayGoals) homeWins += 1;
    else if (homeGoals === awayGoals) draws += 1;
    else awayWins += 1;

    if (homeGoals > 0 && awayGoals > 0) btts += 1;
    if (homeGoals + awayGoals > 2.5) over25 += 1;
    if (homeGoals + awayGoals > 3.5) over35 += 1;
  }

  const scoreMatrix = {};
  let topScore = "1-1";
  let topScoreCount = 0;
  for (const [score, count] of Object.entries(scoreCounts)) {
    const probability = Number((Number(count || 0) / runs).toFixed(4));
    if (probability > 0.004) scoreMatrix[score] = probability;
    if (Number(count || 0) > topScoreCount) {
      topScore = score;
      topScoreCount = Number(count || 0);
    }
  }

  return {
    active: true,
    simulations: runs,
    seed,
    homeProb: Number((homeWins / runs).toFixed(4)),
    drawProb: Number((draws / runs).toFixed(4)),
    awayProb: Number((awayWins / runs).toFixed(4)),
    bttsProb: Number((btts / runs).toFixed(4)),
    over25Prob: Number((over25 / runs).toFixed(4)),
    over35Prob: Number((over35 / runs).toFixed(4)),
    under25Prob: Number((1 - over25 / runs).toFixed(4)),
    topScore,
    topScoreProb: Number((topScoreCount / runs).toFixed(4)),
    scoreMatrix,
  };
}

function parseMinuteFromDescription(description) {
  const text = String(description || "");
  const plus = text.match(/(\d+)\s*\+\s*(\d+)/);
  if (plus) return { current: Number(plus[1]), extra: Number(plus[2]) };

  const plain = text.match(/(\d+)/);
  if (plain) return { current: Number(plain[1]), extra: 0 };

  return null;
}

function resolveMinuteState(eventLike, eventDetails) {
  const period =
    eventLike?.status?.description ||
    eventDetails?.status?.description ||
    null;

  const parsed =
    parseMinuteFromDescription(period) ||
    parseMinuteFromDescription(eventDetails?.time?.injuryTime1) ||
    null;

  const current =
    Number(eventLike?.time?.current ?? eventDetails?.time?.current ?? parsed?.current ?? 0) || null;
  const extra =
    Number(eventLike?.time?.extra ?? eventDetails?.time?.extra ?? parsed?.extra ?? 0) || null;

  const minute = normalizeMinute(null, current, extra, period) || null;

  return {
    minute,
    minuteValue: current,
    extraTime: extra,
    period,
  };
}

function resolveAppStatus(eventLike) {
  const type = String(eventLike?.status?.type || "").toLowerCase();
  const description = String(eventLike?.status?.description || eventLike?.status?.status || "").toLowerCase();
  const period = String(eventLike?.period || "").toLowerCase();

  if (type === "finished" || description.includes("finished") || description === "ft" || description.includes("full time")) {
    return "FT";
  }

  if (type === "halftime" || period === "ht" || description === "ht" || description.includes("half")) {
    return "HT";
  }

  if (
    type === "inprogress" ||
    description.includes("live") ||
    description.includes("progress") ||
    description.includes("1st") ||
    description.includes("2nd")
  ) {
    return "LIVE";
  }

  return "NS";
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugifyKey(value) {
  return normalizeName(value).replace(/\s+/g, "-") || "unknown";
}

function buildTeamStoreKey(teamId, teamName) {
  return teamId ? `id:${teamId}` : `name:${normalizeName(teamName)}`;
}

function getMatchDateKey(match) {
  return match?.date || toAmsterdamDateKey(match?.kickoff || match?.startTimestamp || Date.now()) || "unknown";
}

function getMatchFinalStatus(match) {
  const status = String(match?.status || "").toUpperCase();
  return ["FT", "AET", "PEN"].includes(status);
}

function compactArchiveMatch(match) {
  return {
    id: match.id || "",
    date: getMatchDateKey(match),
    kickoff: match.kickoff || null,
    league: match.league || "",
    homeTeamId: match.homeTeamId || "",
    awayTeamId: match.awayTeamId || "",
    homeTeamName: match.homeTeamName || "",
    awayTeamName: match.awayTeamName || "",
    homeScore: match.homeScore ?? null,
    awayScore: match.awayScore ?? null,
    score: match.score || null,
    status: match.status || "NS",
    roundLabel: match.roundLabel || null,
    aggregate: match.aggregate || null,
    h2h: match.h2h?.played
      ? {
          played: match.h2h.played,
          homeWins: match.h2h.homeWins || 0,
          draws: match.h2h.draws || 0,
          awayWins: match.h2h.awayWins || 0,
          results: (match.h2h.results || []).slice(-5),
        }
      : null,
    homePos: match.homePos ?? null,
    awayPos: match.awayPos ?? null,
    homeClubElo: match.homeClubElo ?? null,
    awayClubElo: match.awayClubElo ?? null,
    dataCompletenessScore: match.dataCompletenessScore ?? null,
    dataSource: match.dataSource || "unknown",
  };
}

function buildCompetitionArchives(store, todayKey) {
  const grouped = new Map();
  for (const matches of Object.values(store.matches || {})) {
    for (const match of matches || []) {
      if (!match?.league) continue;
      const dateKey = getMatchDateKey(match);
      const season = getSportsDbSeasonLabel(dateKey);
      const slug = slugifyKey(match.league);
      const key = `${season}__${slug}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          season,
          league: match.league,
          slug,
          matches: [],
          teams: new Set(),
          firstMatchDate: dateKey,
          lastMatchDate: dateKey,
          finishedMatches: 0,
          scheduledMatches: 0,
          liveMatches: 0,
        });
      }
      const entry = grouped.get(key);
      entry.matches.push(compactArchiveMatch(match));
      if (match.homeTeamName) entry.teams.add(match.homeTeamName);
      if (match.awayTeamName) entry.teams.add(match.awayTeamName);
      if (dateKey < entry.firstMatchDate) entry.firstMatchDate = dateKey;
      if (dateKey > entry.lastMatchDate) entry.lastMatchDate = dateKey;
      const status = String(match.status || "").toUpperCase();
      if (getMatchFinalStatus(match)) entry.finishedMatches += 1;
      else if (status === "LIVE" || status === "HT") entry.liveMatches += 1;
      else entry.scheduledMatches += 1;
    }
  }

  const archives = {};
  const competitions = [...grouped.values()]
    .map((entry) => {
      const seasonEndYear = Number(String(entry.season).split("-")[1] || String(entry.season).slice(0, 4));
      const seasonArchiveDate = Number.isFinite(seasonEndYear) ? `${seasonEndYear}-06-30` : entry.lastMatchDate;
      const safelyPastSeason = todayKey > addDaysToDateKey(seasonArchiveDate, 21);
      const inactiveForWeeks = entry.scheduledMatches === 0 && entry.liveMatches === 0 && entry.lastMatchDate <= addDaysToDateKey(todayKey, -21);
      const status = safelyPastSeason || inactiveForWeeks ? "closed" : "active";
      const archiveFile = `data/competitions/${entry.season}/${entry.slug}.json`;
      const archive = {
        key: entry.key,
        season: entry.season,
        league: entry.league,
        slug: entry.slug,
        status,
        firstMatchDate: entry.firstMatchDate,
        lastMatchDate: entry.lastMatchDate,
        generatedAt: Date.now(),
        teamCount: entry.teams.size,
        teams: [...entry.teams].sort(),
        totalMatches: entry.matches.length,
        finishedMatches: entry.finishedMatches,
        scheduledMatches: entry.scheduledMatches,
        liveMatches: entry.liveMatches,
        matches: entry.matches.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.kickoff || "").localeCompare(String(b.kickoff || ""))),
      };
      archives[entry.key] = archive;
      return {
        key: entry.key,
        season: entry.season,
        league: entry.league,
        slug: entry.slug,
        status,
        totalMatches: entry.matches.length,
        finishedMatches: entry.finishedMatches,
        scheduledMatches: entry.scheduledMatches,
        liveMatches: entry.liveMatches,
        firstMatchDate: entry.firstMatchDate,
        lastMatchDate: entry.lastMatchDate,
        teamCount: entry.teams.size,
        archiveFile,
      };
    })
    .sort((a, b) => `${b.season} ${a.league}`.localeCompare(`${a.season} ${b.league}`));

  try {
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "competition-catalog.json"), "utf8"));
    for (const competition of catalog.competitions || []) {
      const key = `${catalog.season}__${competition.slug}`;
      if (competitions.some((item) => item.key === key)) continue;
      competitions.unshift({
        key,
        season: catalog.season,
        league: competition.league,
        slug: competition.slug,
        status: "planned",
        totalMatches: 0,
        finishedMatches: 0,
        scheduledMatches: 0,
        liveMatches: 0,
        firstMatchDate: null,
        lastMatchDate: null,
        teamCount: (competition.teams || []).length,
        membershipStatus: competition.membershipStatus,
        expectedTeams: competition.expectedTeams,
        archiveFile: `data/competitions/${catalog.season}/${competition.slug}.json`,
      });
    }
  } catch {
    // The worker remains compatible when no future-season catalog is present.
  }

  return {
    index: {
      generatedAt: Date.now(),
      totalCompetitions: competitions.length,
      activeCount: competitions.filter((item) => item.status === "active").length,
      plannedCount: competitions.filter((item) => item.status === "planned").length,
      closedCount: competitions.filter((item) => item.status === "closed").length,
      competitions,
    },
    archives,
  };
}

function buildCompetitionArchiveIndex(store, todayKey) {
  return buildCompetitionArchives(store, todayKey).index;
}

function writeCompetitionArchiveFiles(store) {
  const todayKey = toAmsterdamDateKey(new Date()) || new Date().toISOString().slice(0, 10);
  const { index, archives } = buildCompetitionArchives(store, todayKey);
  fs.mkdirSync(COMPETITION_ARCHIVE_DIR, { recursive: true });
  writeJsonFile(path.join(COMPETITION_ARCHIVE_DIR, "index.json"), index);
  for (const archive of Object.values(archives)) {
    writeJsonFile(path.join(COMPETITION_ARCHIVE_DIR, archive.season, `${archive.slug}.json`), archive);
  }
  const nextSeasonScript = path.join(ROOT, "scripts", "prepare-next-season.js");
  if (fs.existsSync(nextSeasonScript)) {
    spawnSync(process.execPath, [nextSeasonScript], { cwd: ROOT, stdio: "inherit" });
  }
}

const TEAM_ALIAS_GROUPS = [
  ["fc cologne", "1 fc koln", "1 fc koeln", "fc koln", "fc koeln", "koln", "koeln", "cologne"],
  ["1 fc heidenheim 1846", "1 fc heidenheim", "fc heidenheim", "heidenheim"],
  ["hamburg sv", "hamburger sv", "hsv"],
  ["hertha bsc", "hertha berlin"],
  ["spvgg greuther furth", "spvgg greuther fuerth", "greuther furth", "greuther fuerth"],
  ["borussia monchengladbach", "borussia moenchengladbach", "monchengladbach", "moenchengladbach", "gladbach"],
  ["bayern munich", "fc bayern munchen", "bayern munchen", "bayern"],
  ["bayer leverkusen", "bayer 04 leverkusen", "leverkusen"],
  ["borussia dortmund", "dortmund"],
  ["rb leipzig", "rasenballsport leipzig", "leipzig"],
  ["fc st pauli", "st pauli"],
  ["sc freiburg", "freiburg", "sport club freiburg"],
  ["werder bremen", "sv werder bremen"],
  ["ajax", "ajax amsterdam", "afc ajax"],
  ["az alkmaar", "az"],
  ["fc twente", "twente"],
  ["fc utrecht", "utrecht"],
  ["fc volendam", "volendam"],
  ["nec nijmegen", "nijmegen", "nec"],
  ["fortuna sittard", "for sittard"],
  ["pec zwolle", "zwolle"],
  ["fc groningen", "groningen"],
  ["heracles almelo", "heracles"],
  ["go ahead eagles", "ga eagles"],
  ["psv eindhoven", "psv"],
  ["feyenoord rotterdam", "feyenoord"],
  ["karlsruher sc", "karlsruhe", "karlsruher"],
  ["dsc arminia bielefeld", "arminia bielefeld", "bielefeld"],
  ["1 fc kaiserslautern", "kaiserslautern"],
  ["sc paderborn 07", "paderborn"],
  ["paris saint germain", "psg", "paris sg", "paris saint-germain"],
  ["internazionale", "inter milan", "inter"],
  ["ac milan", "milan"],
  ["as roma", "roma"],
  ["ss lazio", "lazio"],
  ["fiorentina", "acf fiorentina"],
  ["atletico madrid", "ath madrid", "atletico"],
  ["athletic club", "athletic bilbao", "ath bilbao", "athletic club bilbao"],
  ["espanyol", "espanol", "rcd espanyol", "espanyol barcelona"],
  ["barcelona", "fc barcelona", "barca"],
  ["crystal palace", "crystal palace fc"],
  ["real sociedad", "sociedad"],
  ["real betis", "betis"],
  ["rayo vallecano", "vallecano"],
  ["celta vigo", "rc celta", "celtavigo", "celta"],
  ["girona", "girona fc"],
  ["leeds united", "leeds"],
  ["manchester city", "man city"],
  ["manchester united", "man united"],
  ["nottingham forest", "nott m forest", "nottm forest"],
  ["wolverhampton wanderers", "wolverhampton", "wolves"],
  ["brighton hove albion", "brighton and hove albion", "brighton"],
  ["tottenham hotspur", "tottenham", "spurs"],
  ["newcastle united", "newcastle"],
  ["west ham united", "west ham"],
  ["aston villa", "villa"],
  ["sporting braga", "sp braga", "braga"],
  ["sporting cp", "sporting lisbon"],
  ["union st gilloise", "union saint gilloise", "royale union saint gilloise"],
  ["standard liege", "standard"],
  ["kvc westerlo", "westerlo"],
  ["racing genk", "krc genk", "genk"],
  ["royal charleroi sc", "sporting charleroi", "charleroi"],
  ["royal antwerp", "antwerp", "royal antwerp fc"],
  ["sint truidense", "sint truiden"],
  ["oh leuven", "oud heverlee leuven", "oud heverlee"],
  ["kv mechelen", "mechelen"],
  ["kaa gent", "gent"],
  ["sl benfica", "benfica"],
  ["fc porto", "porto"],
  ["ogc nice", "nice"],
  ["aj auxerre", "auxerre"],
  ["angers sco", "angers"],
];

// Forza gebruikt numerieke team-id's in publieke squad-URL's. We houden deze lijst klein en veilig:
// alleen bekende teams worden direct geprobeerd; andere teams vallen terug op Wikipedia/TheSportsDB/Wikidata.
const FORZA_TEAM_PAGE_HINTS = {
  "manchester city": "https://forzafootball.com/team/manchester-city-6803/squad",
  "man city": "https://forzafootball.com/team/manchester-city-6803/squad",
};

const teamAliasLookup = new Map();
for (const group of TEAM_ALIAS_GROUPS) {
  const normalizedGroup = [...new Set(group.map(normalizeName).filter(Boolean))];
  const canonical = normalizedGroup[0];
  for (const alias of normalizedGroup) {
    teamAliasLookup.set(alias, canonical);
  }
}

const UNSAFE_LOGO_KEYS = new Set([
  "city",
  "united",
  "real",
  "sporting",
  "athletic",
  "inter",
  "milan",
  "racing",
  "standard",
  "union",
  "wanderers",
  "rovers",
  "forest",
  "villa",
]);

function canonicalTeamName(name) {
  const normalized = normalizeName(name);
  if (!normalized) return "";
  return teamAliasLookup.get(normalized) || normalized.replace(/\s+and\s+/g, " ");
}

function buildLogoLookupNames(name) {
  const normalized = normalizeName(name);
  if (!normalized) return [];
  const canonical = canonicalTeamName(normalized);
  const groupAliases = TEAM_ALIAS_GROUPS.find((group) =>
    group.map(normalizeName).includes(canonical)
  ) || [];
  return [...new Set([normalized, canonical, ...groupAliases.map(normalizeName)])]
    .filter(Boolean)
    .filter(isSafeLogoLookupName);
}

function isSafeLogoLookupName(key) {
  const normalized = normalizeName(key);
  if (!normalized || UNSAFE_LOGO_KEYS.has(normalized)) return false;
  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length === 1 && normalized.length < 5) return false;
  if (parts.length === 1 && /^(fc|cf|sc|cd|ac|afc|sv|bk|ifk|rkc|psg|psv)$/i.test(normalized)) return false;
  return true;
}

function isWomenContext(...values) {
  const text = values
    .flatMap((value) => (value == null ? [] : [String(value)]))
    .join(" ")
    .toLowerCase();

  return (
    text.includes("women") ||
    text.includes("woman") ||
    text.includes("femminile") ||
    text.includes("feminine") ||
    text.includes("feminin") ||
    text.includes("frauen") ||
    text.includes("dames") ||
    text.includes("ladies") ||
    text.includes("vrouw")
  );
}

function isYouthContext(...values) {
  const text = values
    .flatMap((value) => (value == null ? [] : [String(value)]))
    .join(" ")
    .toLowerCase();

  return (
    text.includes("u17") ||
    text.includes("u18") ||
    text.includes("u19") ||
    text.includes("u20") ||
    text.includes("u21") ||
    text.includes("u23") ||
    text.includes("under 17") ||
    text.includes("under 18") ||
    text.includes("under 19") ||
    text.includes("under 20") ||
    text.includes("under 21") ||
    text.includes("under 23") ||
    text.includes("youth") ||
    text.includes("junior")
  );
}

function getCompetitionSegment(...values) {
  return isYouthContext(...values) ? "youth" : "senior";
}

const EUROPEAN_COUNTRIES = new Set(
  [
    "albania",
    "andorra",
    "armenia",
    "austria",
    "azerbaijan",
    "belarus",
    "belgium",
    "bosnia and herzegovina",
    "bosnia herzegovina",
    "bulgaria",
    "croatia",
    "cyprus",
    "czech republic",
    "czechia",
    "denmark",
    "england",
    "estonia",
    "faroe islands",
    "finland",
    "france",
    "georgia",
    "germany",
    "gibraltar",
    "greece",
    "hungary",
    "iceland",
    "ireland",
    "israel",
    "italy",
    "kazakhstan",
    "kosovo",
    "latvia",
    "liechtenstein",
    "lithuania",
    "luxembourg",
    "malta",
    "moldova",
    "montenegro",
    "netherlands",
    "north macedonia",
    "norway",
    "poland",
    "portugal",
    "romania",
    "san marino",
    "scotland",
    "serbia",
    "slovakia",
    "slovenia",
    "spain",
    "sweden",
    "switzerland",
    "turkey",
    "ukraine",
    "wales",
  ].map((entry) => normalizeName(entry))
);

function isEuropeanCountryName(name) {
  return EUROPEAN_COUNTRIES.has(normalizeName(name));
}

function isSeniorInternationalTournament(tournamentName) {
  const value = normalizeName(tournamentName);
  if (!value) return false;
  const blocked = ["u17", "u18", "u19", "u20", "u21", "u23", "women", "femin", "vrouw", "futsal"];
  return !blocked.some((token) => value.includes(token));
}

function shouldExcludeEvent(event) {
  return isWomenContext(
    event?.uniqueTournament?.name,
    event?.tournament?.name,
    event?.tournament?.category?.name,
    event?.homeTeam?.name,
    event?.awayTeam?.name,
    event?.homeTeam?.teamType,
    event?.awayTeam?.teamType
  ) || isYouthContext(
    event?.uniqueTournament?.name,
    event?.tournament?.name,
    event?.tournament?.category?.name,
    event?.homeTeam?.name,
    event?.awayTeam?.name,
    event?.homeTeam?.teamType,
    event?.awayTeam?.teamType
  );
}

function getInternationalLeagueInfo(event) {
  if (shouldExcludeEvent(event)) return null;
  const tournament = String(
    event?.uniqueTournament?.name || event?.tournament?.name || ""
  );
  const tournamentNorm = normalizeName(tournament);
  const categoryNorm = normalizeName(event?.tournament?.category?.name || "");
  const homeCountryNorm = normalizeName(event?.homeTeam?.country?.name || "");
  const awayCountryNorm = normalizeName(event?.awayTeam?.country?.name || "");
  const homeName = event?.homeTeam?.name || "";
  const awayName = event?.awayTeam?.name || "";
  const hasEuropeanTeam =
    isEuropeanCountryName(homeCountryNorm) || isEuropeanCountryName(awayCountryNorm);
  const hasWorldCup2026Team = isWorldCup2026Team(homeName) || isWorldCup2026Team(awayName);
  const europeanPair =
    isEuropeanCountryName(homeCountryNorm) && isEuropeanCountryName(awayCountryNorm);

  if (!isSeniorInternationalTournament(tournamentNorm)) return null;

  if (
    tournamentNorm.includes("world championship qualification") ||
    tournamentNorm.includes("world championship qual") ||
    tournamentNorm.includes("world cup qual") ||
    tournamentNorm.includes("world cup qualification") ||
    tournamentNorm.includes("fifa world cup qualification")
  ) {
    if (categoryNorm.includes("europe") || hasEuropeanTeam || tournamentNorm.includes("uefa")) {
      return {
        country: "",
        name: tournamentNorm,
        label: "Europe - World Cup Qualification",
        type: "league",
      };
    }
  }

  if (
    tournamentNorm.includes("world cup") &&
    !tournamentNorm.includes("qualification") &&
    !tournamentNorm.includes("qual")
  ) {
    return {
      country: "",
      name: tournamentNorm,
      label: WORLD_CUP_LEAGUE,
      type: "cup",
    };
  }

  if (
    (tournamentNorm.includes("european championship") && tournamentNorm.includes("qualification")) ||
    tournamentNorm.includes("euro qualification") ||
    tournamentNorm.includes("uefa euro qualification")
  ) {
    if (categoryNorm.includes("europe") || hasEuropeanTeam) {
      return {
        country: "",
        name: tournamentNorm,
        label: "Europe - Euro Qualification",
        type: "league",
      };
    }
  }

  if (tournamentNorm.includes("uefa nations league")) {
    return {
      country: "",
      name: tournamentNorm,
      label: "Europe - UEFA Nations League",
      type: "league",
    };
  }

  if (
    tournamentNorm.includes("european championship") &&
    !tournamentNorm.includes("qualification")
  ) {
    if (categoryNorm.includes("europe") || hasEuropeanTeam) {
      return {
        country: "",
        name: tournamentNorm,
        label: "Europe - European Championship",
        type: "cup",
      };
    }
  }

  if (
    (tournamentNorm.includes("friendly games") || tournamentNorm.includes("international friendly")) &&
    !tournamentNorm.includes("club")
  ) {
    if (hasEuropeanTeam || hasWorldCup2026Team || categoryNorm.includes("international") || categoryNorm.includes("world")) {
      return {
        country: "",
        name: tournamentNorm,
        label: hasEuropeanTeam && !hasWorldCup2026Team ? "Europe - International Friendly" : WORLD_FRIENDLY_LEAGUE,
        type: "league",
      };
    }
  }

  return null;
}

function buildPossibleNames(name) {
  const normalized = normalizeName(name);
  const variants = new Set([normalized]);
  const canonical = canonicalTeamName(normalized);
  if (canonical && canonical !== normalized) variants.add(canonical);
  for (const group of TEAM_ALIAS_GROUPS) {
    const normalizedGroup = group.map(normalizeName);
    if (normalizedGroup.includes(normalized) || normalizedGroup.includes(canonical)) {
      normalizedGroup.forEach((alias) => variants.add(alias));
      break;
    }
  }
  const withoutLeadingClubPrefix = normalized
    .replace(/^(?:1\s+)?(?:fc|sc|dsc|ac|afc|cf|sv|tsv|kaa|kv|kvc)\s+/, "")
    .trim();
  if (withoutLeadingClubPrefix && withoutLeadingClubPrefix !== normalized) variants.add(withoutLeadingClubPrefix);
  const withoutTrailingClubSuffix = normalized.replace(/\s+(?:fc|sc|afc|cf|ac|ksv|rfc)$/g, "").trim();
  if (withoutTrailingClubSuffix && withoutTrailingClubSuffix !== normalized) variants.add(withoutTrailingClubSuffix);
  const withoutTrailingNumber = withoutLeadingClubPrefix.replace(/\s+\d+$/g, "").trim();
  if (withoutTrailingNumber && withoutTrailingNumber !== normalized) variants.add(withoutTrailingNumber);
  const withoutCitySuffix = normalized.replace(/\s+city$/g, "").trim();
  if (withoutCitySuffix && withoutCitySuffix !== normalized) variants.add(withoutCitySuffix);
  if (normalized.includes("fc ")) variants.add(normalized.replace("fc ", "").trim());
  if (normalized.includes(" cf")) variants.add(normalized.replace(" cf", "").trim());
  if (normalized.includes(" afc")) variants.add(normalized.replace(" afc", "").trim());
  if (normalized.includes(" sc")) variants.add(normalized.replace(" sc", "").trim());
  if (normalized.includes(" ac")) variants.add(normalized.replace(" ac", "").trim());
  if (normalized.includes(" ksv")) variants.add(normalized.replace(" ksv", "").trim());
  if (normalized.includes(" rfc")) variants.add(normalized.replace(" rfc", "").trim());
  if (normalized.includes(" and ")) variants.add(normalized.replace(/\s+and\s+/g, " ").trim());
  if (normalized.includes("manchester ")) variants.add(normalized.replace("manchester ", "man ").trim());
  if (normalized.includes("man ")) variants.add(normalized.replace("man ", "manchester ").trim());
  if (normalized === "nottingham forest") variants.add("nott m forest");
  if (normalized === "nott m forest") variants.add("nottingham forest");
  if (normalized === "real sociedad") variants.add("sociedad");
  if (normalized === "sociedad") variants.add("real sociedad");
  if (normalized === "atletico madrid") variants.add("ath madrid");
  if (normalized === "ath madrid") variants.add("atletico madrid");
  if (normalized === "wolverhampton") variants.add("wolves");
  if (normalized === "wolves") variants.add("wolverhampton");
  if (normalized === "tottenham hotspur") variants.add("tottenham");
  if (normalized === "tottenham") variants.add("tottenham hotspur");
  if (normalized === "hull city") variants.add("hull");
  if (normalized === "hull") variants.add("hull city");
  if (normalized === "sc paderborn 07") variants.add("paderborn");
  if (normalized === "paderborn") variants.add("sc paderborn 07");
  if (normalized === "karlsruher sc") {
    variants.add("karlsruher");
    variants.add("karlsruhe");
  }
  if (normalized === "karlsruhe") variants.add("karlsruher sc");
  if (normalized === "1 fc kaiserslautern") variants.add("kaiserslautern");
  if (normalized === "kaiserslautern") variants.add("1 fc kaiserslautern");
  if (normalized === "dsc arminia bielefeld") {
    variants.add("arminia bielefeld");
    variants.add("bielefeld");
  }
  if (normalized === "arminia bielefeld" || normalized === "bielefeld") variants.add("dsc arminia bielefeld");
  if (normalized === "oh leuven") {
    variants.add("oud heverlee leuven");
    variants.add("oud heverlee");
  }
  if (normalized === "oud heverlee leuven") variants.add("oh leuven");
  if (normalized === "standard liege") variants.add("standard");
  if (normalized === "standard") variants.add("standard liege");
  if (normalized === "sporting braga") variants.add("sp braga");
  if (normalized === "sp braga") variants.add("sporting braga");
  if (normalized === "rayo vallecano") variants.add("vallecano");
  if (normalized === "vallecano") variants.add("rayo vallecano");
  if (normalized === "bayer 04 leverkusen") variants.add("bayer leverkusen");
  if (normalized === "bayer leverkusen") variants.add("bayer 04 leverkusen");
  if (normalized === "fc st pauli") variants.add("st pauli");
  if (normalized === "st pauli") variants.add("fc st pauli");
  if (normalized === "sv werder bremen") variants.add("werder bremen");
  if (normalized === "werder bremen") variants.add("sv werder bremen");
  if (normalized === "tsv eintracht braunschweig") variants.add("eintracht braunschweig");
  if (normalized === "eintracht braunschweig") variants.add("tsv eintracht braunschweig");
  if (normalized === "fc bayern munchen" || normalized === "bayern munchen") variants.add("bayern munich");
  if (normalized === "bayern munich") {
    variants.add("fc bayern munchen");
    variants.add("bayern munchen");
  }
  if (normalized === "sint truidense") variants.add("sint truiden");
  if (normalized === "sint truiden") variants.add("sint truidense");
  if (normalized === "1 fsv mainz 05") variants.add("mainz");
  if (normalized === "mainz") variants.add("1 fsv mainz 05");
  if (normalized === "cercle brugge ksv") variants.add("cercle brugge");
  if (normalized === "cercle brugge") variants.add("cercle brugge ksv");
  if (normalized === "ajax amsterdam") variants.add("ajax");
  if (normalized === "ajax") variants.add("ajax amsterdam");
  if (normalized === "fc utrecht") variants.add("utrecht");
  if (normalized === "utrecht") variants.add("fc utrecht");
  if (normalized === "fc volendam") variants.add("volendam");
  if (normalized === "volendam") variants.add("fc volendam");
  if (normalized === "union st gilloise") variants.add("union saint gilloise");
  if (normalized === "union saint gilloise") variants.add("union st gilloise");
  if (normalized === "kv mechelen") variants.add("mechelen");
  if (normalized === "mechelen") variants.add("kv mechelen");
  if (normalized === "angers sco") variants.add("angers");
  if (normalized === "angers") variants.add("angers sco");
  if (normalized === "aj auxerre") variants.add("auxerre");
  if (normalized === "auxerre") variants.add("aj auxerre");
  if (normalized === "ogc nice") variants.add("nice");
  if (normalized === "nice") variants.add("ogc nice");
  if (normalized === "fc porto") variants.add("porto");
  if (normalized === "porto") variants.add("fc porto");
  if (normalized === "sl benfica") variants.add("benfica");
  if (normalized === "benfica") variants.add("sl benfica");
  if (normalized === "braga") variants.add("sporting braga");
  if (normalized === "sporting braga") variants.add("braga");
  if (normalized === "famalicao") variants.add("famalicao");
  if (normalized === "kaa gent") variants.add("gent");
  if (normalized === "gent") variants.add("kaa gent");
  return [...variants].filter(Boolean);
}

function emptySplit() {
  return {
    games: 0,
    avgScored: 1.35,
    avgConceded: 1.35,
    bttsRate: 0.5,
    over15Rate: 0.5,
    over25Rate: 0.45,
    cleanSheetRate: 0.2,
    failToScoreRate: 0.25,
    wins: 0,
    draws: 0,
    losses: 0,
    scoredTotal: 0,
    concededTotal: 0,
  };
}

function finalizeSplit(split) {
  if (!split.games) return emptySplit();
  return {
    games: split.games,
    avgScored: Number((split.scored / split.games).toFixed(2)),
    avgConceded: Number((split.conceded / split.games).toFixed(2)),
    bttsRate: Number((split.btts / split.games).toFixed(2)),
    over15Rate: Number((split.over15 / split.games).toFixed(2)),
    over25Rate: Number((split.over25 / split.games).toFixed(2)),
    cleanSheetRate: Number((split.cleanSheets / split.games).toFixed(2)),
    failToScoreRate: Number((split.failToScore / split.games).toFixed(2)),
    wins: split.wins,
    draws: split.draws,
    losses: split.losses,
    scoredTotal: split.scored,
    concededTotal: split.conceded,
  };
}

function calcTeamPressure(pos, totalTeams) {
  if (!pos || !totalTeams) return 1;
  const relegationStart = Math.max(totalTeams - 2, 1);

  if (pos === 1) return 1.12;
  if (pos <= 2) return 1.1;
  if (pos === 3) return 1.08;
  if (pos <= 6) return 1.04;
  if (pos >= relegationStart) return 1.08;
  if (pos >= Math.max(totalTeams - 5, 1)) return 1.03;
  return 1;
}

function calcMatchImportance(homePos, awayPos, totalTeams) {
  if (!homePos || !awayPos || !totalTeams) return 1;
  const homePressure = calcTeamPressure(homePos, totalTeams);
  const awayPressure = calcTeamPressure(awayPos, totalTeams);
  return Number(Math.max(homePressure, awayPressure).toFixed(2));
}

function toPointsPerGame(wins, draws, games) {
  if (!games) return 0;
  return Number((((wins || 0) * 3 + (draws || 0)) / games).toFixed(2));
}

async function fetchSportsDbSquadProfile(teamName) {
  const normalized = normalizeName(teamName);
  if (!normalized) return null;

  const now = Date.now();
  if (sportsDbSquadFetchState.blockedUntil > now) return null;
  if (sportsDbSquadFetchState.count >= MAX_SQUAD_FETCHES_PER_RUN) {
    if (!sportsDbSquadFetchState.loggedLimit) {
      console.warn(
        `[worker] Spelerslijst-fetch beperkt tot ${MAX_SQUAD_FETCHES_PER_RUN} teams per run om gratis bronnen te beschermen.`
      );
      sportsDbSquadFetchState.loggedLimit = true;
    }
    return null;
  }

  const waitMs = Math.max(0, SQUAD_FETCH_MIN_DELAY - (now - sportsDbSquadFetchState.lastAt));
  if (waitMs) await sleep(waitMs);
  sportsDbSquadFetchState.count += 1;
  sportsDbSquadFetchState.lastAt = Date.now();

  const json = await safeFetch(`https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?t=${encodeURIComponent(teamName)}`);
  const players = Array.isArray(json?.player) ? json.player : [];
  if (!players.length) return null;
  return {
    source: "TheSportsDB",
    sources: ["TheSportsDB"],
    playerCount: players.length,
    players: players.slice(0, 45).map((player) => ({
      id: player.idPlayer || "",
      name: player.strPlayer || "",
      position: player.strPosition || "",
      nationality: player.strNationality || "",
      dateBorn: player.dateBorn || null,
      dateSigned: player.dateSigned || null,
      status: player.strStatus || "beschikbaar",
      availability: player.strStatus || "beschikbaar",
      loan: /loan|huur|verhuur/i.test(String(player.strStatus || "")),
      source: "TheSportsDB",
    })),
  };
}

async function safeFetchPublicJson(url, timeout = 15000) {
  try {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent":
            "Voetbal-Ai-tactics/1.0 (personal football prediction app; free public data cache)",
        },
      },
      timeout
    );
    if (!response.ok) {
      console.warn(`[worker] Open squad source ${response.status} voor ${url}`);
      if (response.status === 429 && /wikipedia\.org/i.test(url)) {
        openSquadSourceState.wikipediaCount = MAX_WIKIPEDIA_SQUAD_FETCHES_PER_RUN;
      }
      if (response.status === 429 && /wikidata\.org/i.test(url)) {
        openSquadSourceState.wikidataCount = MAX_WIKIDATA_SQUAD_FETCHES_PER_RUN;
      }
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn(`[worker] Open squad source mislukt voor ${url}: ${error?.message || error}`);
    return null;
  }
}

function cleanWikiPlayerName(value) {
  let text = String(value || "");
  text = text.replace(/\{\{sortname\|([^|{}]+)\|([^|{}]+)[^{}]*\}\}/gi, "$1 $2");
  text = text.replace(/\{\{[^{}|]+\|([^{}|]+)\}\}/g, "$1");
  text = text.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, "$1");
  text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");
  return text.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function wikiTitleMatchesTeam(title, teamName) {
  const normalizeWikiTitle = (value) =>
    normalizeName(value)
      .replace(/\b(f\.?c\.?|football club|afc|cf|sc|sv|club|calcio|deportivo|atl[eé]tico|united|city)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const titleNorm = normalizeWikiTitle(title);
  const teamNorm = normalizeWikiTitle(teamName);
  const tokens = teamNorm.split(" ").filter((token) => token.length >= 4);
  if (!tokens.length) return true;
  return tokens.every((token) => titleNorm.includes(token)) || titleNorm.includes(teamNorm) || teamNorm.includes(titleNorm);
}

function parseTemplateParams(template) {
  const params = {};
  const keys = ["name", "player", "p", "pos", "position", "nat", "nationality"];
  for (const key of keys) {
    const regex = new RegExp(`(?:^|\\|)\\s*${key}\\s*=\\s*(\\[\\[[^\\]]+\\]\\]|[^|}]+)`, "i");
    const match = regex.exec(template);
    if (match?.[1]) params[key] = cleanWikiPlayerName(match[1]);
  }
  return params;
}

function mergeSquadProfiles(profiles) {
  const valid = profiles.filter(Boolean);
  if (!valid.length) return null;
  const byName = new Map();
  const sources = new Set();
  const sourceIds = {};
  const sourceUrls = {};
  let forzaSquadUrl = "";
  let footballDataTeamId = "";
  let reepTeamId = "";

  for (const profile of valid) {
    for (const source of profile.sources || [profile.source].filter(Boolean)) sources.add(source);
    Object.assign(sourceIds, profile.sourceIds || {});
    Object.assign(sourceUrls, profile.sourceUrls || {});
    if (profile.forzaSquadUrl) forzaSquadUrl = profile.forzaSquadUrl;
    if (profile.footballDataTeamId) footballDataTeamId = String(profile.footballDataTeamId);
    if (profile.reepTeamId) reepTeamId = String(profile.reepTeamId);
    for (const player of profile.players || []) {
      const name = cleanWikiPlayerName(player.name);
      if (!name) continue;
      const key = normalizeName(name);
      const current = byName.get(key) || {};
      byName.set(key, {
        ...current,
        ...player,
        name,
        position: current.position || player.position || "",
        nationality: current.nationality || player.nationality || "",
        status: player.status || current.status || "beschikbaar",
        availability: player.availability || current.availability || "beschikbaar",
        loan: Boolean(current.loan || player.loan),
        sources: Array.from(new Set([...(current.sources || []), player.source || profile.source].filter(Boolean))),
      });
    }
  }

  const players = Array.from(byName.values())
    .sort((a, b) => String(a.position || "").localeCompare(String(b.position || "")) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 60);

  return {
    source: Array.from(sources).join(" + ") || "open-squad-sources",
    sources: Array.from(sources),
    sourceIds,
    sourceUrls,
    ...(forzaSquadUrl ? { forzaSquadUrl } : {}),
    ...(footballDataTeamId ? { footballDataTeamId } : {}),
    ...(reepTeamId ? { reepTeamId } : {}),
    playerCount: players.length,
    players,
  };
}

async function fetchWikidataSquadProfile(teamName) {
  if (openSquadSourceState.wikidataCount >= MAX_WIKIDATA_SQUAD_FETCHES_PER_RUN) return null;
  openSquadSourceState.wikidataCount += 1;
  await sleep(250);

  const search = await safeFetchPublicJson(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=3&search=${encodeURIComponent(teamName)}`
  );
  const entity = (search?.search || []).find((item) =>
    /football|soccer|association football|club/i.test(`${item.description || ""} ${item.label || ""}`)
  ) || search?.search?.[0];
  const id = entity?.id;
  if (!id) return null;

  const query = `
    SELECT ?player ?playerLabel ?positionLabel ?countryLabel WHERE {
      ?player p:P54 ?membership .
      ?membership ps:P54 wd:${id} .
      OPTIONAL { ?membership pq:P580 ?startDate . }
      OPTIONAL { ?membership pq:P582 ?endDate . }
      FILTER(!BOUND(?endDate) || ?endDate > NOW())
      FILTER(!BOUND(?startDate) || ?startDate > "2022-01-01T00:00:00Z"^^xsd:dateTime)
      OPTIONAL { ?player wdt:P413 ?position . }
      OPTIONAL { ?player wdt:P27 ?country . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 80
  `;
  const data = await safeFetchPublicJson(
    `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`,
    18000
  );
  const rows = data?.results?.bindings || [];
  if (!rows.length) return null;
  if (rows.length > 42) {
    console.warn(`[worker] Wikidata selectie voor ${teamName} is te breed (${rows.length}); genegeerd als actuele selectie.`);
    return null;
  }
  return {
    source: "Wikidata",
    sources: ["Wikidata"],
    playerCount: rows.length,
    players: rows.map((row) => ({
      id: row.player?.value || "",
      name: row.playerLabel?.value || "",
      position: row.positionLabel?.value || "",
      nationality: row.countryLabel?.value || "",
      status: "beschikbaar",
      availability: "beschikbaar",
      loan: false,
      source: "Wikidata",
    })),
  };
}

function extractWikipediaPlayers(wikitext) {
  const lines = String(wikitext || "").split(/\r?\n/);
  const players = [];
  let loanSection = false;
  for (const line of lines) {
    if (/^=+.*(out on loan|on loan|verhuurd|uitgeleend).*=+/i.test(line)) loanSection = true;
    if (/^=+/.test(line) && !/^=+.*(out on loan|on loan|verhuurd|uitgeleend).*=+/i.test(line)) loanSection = false;
    if (!/\{\{\s*(fs player|football squad player)/i.test(line)) continue;
    const params = parseTemplateParams(line);
    const name = params.name || params.player || params.p || "";
    if (!name) continue;
    players.push({
      id: "",
      name,
      position: params.pos || params.position || "",
      nationality: params.nat || params.nationality || "",
      status: loanSection ? "verhuurd" : "beschikbaar",
      availability: loanSection ? "verhuurd" : "beschikbaar",
      loan: loanSection,
      source: "Wikipedia",
    });
  }
  return players;
}

async function fetchWikipediaSquadProfile(teamName) {
  if (openSquadSourceState.wikipediaCount >= MAX_WIKIPEDIA_SQUAD_FETCHES_PER_RUN) return null;
  openSquadSourceState.wikipediaCount += 1;
  await sleep(250);

  async function parseWikipediaRoster(title) {
    if (!title || /women|under-|u-?21|academy|reserve|youth|supporters|rivalry/i.test(title)) return null;
    if (!wikiTitleMatchesTeam(title, teamName)) return null;
    if (openSquadSourceState.wikipediaCount >= MAX_WIKIPEDIA_SQUAD_FETCHES_PER_RUN) return null;
    const parsed = await safeFetchPublicJson(
      `https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&page=${encodeURIComponent(title)}`
    );
    if (parsed?.error) return null;
    const wikitext = parsed?.parse?.wikitext?.["*"];
    const players = extractWikipediaPlayers(wikitext);
    if (!players.length) return null;
    if (players.length > MAX_WIKIPEDIA_ROSTER_PLAYERS) {
      console.warn(`[worker] Wikipedia selectie voor ${teamName} via ${title} is te breed (${players.length}); genegeerd.`);
      return null;
    }
    return {
      source: "Wikipedia",
      sources: ["Wikipedia"],
      pageTitle: title,
      playerCount: players.length,
      players,
    };
  }

  const directTitles = Array.from(new Set([`${teamName} F.C.`, `${teamName} FC`, teamName]));
  for (const directTitle of directTitles) {
    if (openSquadSourceState.wikipediaCount >= MAX_WIKIPEDIA_SQUAD_FETCHES_PER_RUN) break;
    const directProfile = await parseWikipediaRoster(directTitle);
    if (directProfile) return directProfile;
    await sleep(120);
  }

  let titles = [];
  for (const query of [`${teamName} F.C.`, `${teamName} football club`, teamName]) {
    if (openSquadSourceState.wikipediaCount >= MAX_WIKIPEDIA_SQUAD_FETCHES_PER_RUN) break;
    const search = await safeFetchPublicJson(
      `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=5&search=${encodeURIComponent(query)}`
    );
    titles = Array.isArray(search?.[1]) ? search[1] : [];
    if (titles.length) break;
    await sleep(150);
  }
  const safeTitles = titles.filter((item) => !/women|under-|u-?21|academy|reserve|youth|supporters|rivalry/i.test(item));
  const matchingTitles = safeTitles.filter((item) => wikiTitleMatchesTeam(item, teamName));
  const title = matchingTitles.find((item) => /football|f\.c\.|fc|club|cf|afc|sc|sv|calcio|deportivo|atlético|atletico/i.test(item)) || matchingTitles[0];
  if (!title) return null;
  return parseWikipediaRoster(title);
}

function squadProfileHasUsefulStatus(profile) {
  const players = Array.isArray(profile?.players) ? profile.players : [];
  return players.some((player) =>
    /injur|bless|suspend|schors|loan|huur|verhuur|unavailable|doubt|twijfel/i.test(
      `${player.status || ""} ${player.availability || ""}`
    )
  );
}

function isCompleteSquadProfile(profile) {
  const players = Array.isArray(profile?.players) ? profile.players : [];
  const playerCount = Number(profile?.playerCount || players.length || 0);
  const withPosition = players.filter((player) => String(player?.position || "").trim()).length;
  return playerCount >= MIN_COMPLETE_ROSTER_PLAYERS && withPosition >= Math.min(14, Math.floor(playerCount * 0.55));
}

function shouldAskFallbackSquadSources(profile) {
  if (!profile) return true;
  const players = Array.isArray(profile?.players) ? profile.players : [];
  const playerCount = Number(profile?.playerCount || players.length || 0);
  if (playerCount < MIN_USABLE_ROSTER_PLAYERS) return true;
  if (!isCompleteSquadProfile(profile)) return true;
  return !squadProfileHasUsefulStatus(profile);
}

function readJsonEnv(name) {
  const raw = process.env[name];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn(`[worker] ${name} is geen geldige JSON; bron wordt overgeslagen.`);
    return null;
  }
}

function getConfiguredTeamSourceEntry(envName, teamName) {
  const map = readJsonEnv(envName);
  if (!map || typeof map !== "object") return null;
  const aliases = buildTeamAliasVariants(teamName);
  for (const alias of aliases) {
    const entry = map[alias] || map[normalizeName(alias)] || map[canonicalTeamName(alias)];
    if (entry) return entry;
  }
  return null;
}

function cleanHtmlFragment(value) {
  return decodeHtmlText(String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function inferPositionFromText(value) {
  const text = String(value || "").toLowerCase();
  if (/goalkeeper|keeper|doelman/.test(text)) return "Goalkeeper";
  if (/defender|centre-back|full-back|left-back|right-back|verdediger/.test(text)) return "Defender";
  if (/midfielder|middenvelder|winger/.test(text)) return "Midfielder";
  if (/forward|striker|attacker|aanvaller/.test(text)) return "Forward";
  return "";
}

function isLikelyPlayerName(value, teamName) {
  const text = cleanWikiPlayerName(value);
  const normalized = normalizeName(text);
  if (!normalized || normalized.length < 5) return false;
  if (normalizeName(teamName) === normalized) return false;
  if (/squad|fixtures|standings|transfers|unavailable|table|scores|stats|matches|football|forza/i.test(text)) return false;
  const parts = normalized.split(" ").filter(Boolean);
  return parts.length >= 2 && parts.length <= 5;
}

function extractForzaPlayers(html, teamName) {
  const text = String(html || "");
  const players = [];
  const seen = new Set();
  const anchorRegex = /<a[^>]+href=["'][^"']*\/player\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of text.matchAll(anchorRegex)) {
    const name = cleanHtmlFragment(match[1]);
    if (!isLikelyPlayerName(name, teamName)) continue;
    const key = normalizeName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const context = text.slice(Math.max(0, Number(match.index || 0) - 450), Math.min(text.length, Number(match.index || 0) + 900));
    const unavailable = /injur|suspend|unavailable|doubt|questionable|red card|yellow cards/i.test(context);
    const loan = /loan|on loan|verhuurd/i.test(context);
    players.push({
      id: "",
      name,
      position: inferPositionFromText(context),
      nationality: "",
      status: loan ? "verhuurd" : unavailable ? "mogelijk niet beschikbaar" : "beschikbaar",
      availability: loan ? "verhuurd" : unavailable ? "mogelijk niet beschikbaar" : "beschikbaar",
      loan,
      source: "Forza Football",
    });
  }
  return players.slice(0, 60);
}

async function fetchForzaSquadProfile(teamName, existing = null) {
  if (openSquadSourceState.forzaCount >= MAX_FORZA_SQUAD_FETCHES_PER_RUN) return null;
  const configured = getConfiguredTeamSourceEntry("FORZA_TEAM_MAP", teamName);
  const configuredUrl = typeof configured === "string" ? configured : configured?.url || configured?.squadUrl;
  const hintUrl = FORZA_TEAM_PAGE_HINTS[canonicalTeamName(teamName)] || FORZA_TEAM_PAGE_HINTS[normalizeName(teamName)];
  const existingUrl = existing?.forzaSquadUrl || existing?.sourceUrls?.forza || existing?.sourceUrl;
  const candidates = [...new Set([existingUrl, configuredUrl, hintUrl].filter((url) => /^https:\/\/forzafootball\.com\/team\/.+\/squad/i.test(String(url || ""))))];
  if (!candidates.length) return null;

  openSquadSourceState.forzaCount += 1;
  await sleep(400);

  for (const url of candidates) {
    const html = await safeFetchText(url);
    if (!html) {
      if (!openSquadSourceState.loggedForzaBlocked) {
        console.warn("[worker] Forza Football selectiebron gaf geen HTML terug; bron blijft fallback en wordt later opnieuw geprobeerd.");
        openSquadSourceState.loggedForzaBlocked = true;
      }
      continue;
    }
    const players = extractForzaPlayers(html, teamName);
    if (players.length < 8) continue;
    return {
      source: "Forza Football",
      sources: ["Forza Football"],
      sourceUrls: { ...(existing?.sourceUrls || {}), forza: url },
      forzaSquadUrl: url,
      playerCount: players.length,
      players,
    };
  }
  return null;
}

async function fetchFootballDataOrgSquadProfile(teamName, existing = null) {
  const token = process.env.FOOTBALL_DATA_TOKEN || process.env.FOOTBALL_DATA_API_KEY || "";
  if (!token) {
    if (!openSquadSourceState.loggedFootballDataConfig) {
      console.warn("[worker] football-data.org squadbron staat klaar, maar FOOTBALL_DATA_TOKEN ontbreekt; bron blijft uit tot er een gratis token is.");
      openSquadSourceState.loggedFootballDataConfig = true;
    }
    return null;
  }
  if (openSquadSourceState.footballDataCount >= MAX_FOOTBALL_DATA_SQUAD_FETCHES_PER_RUN) return null;

  const configured = getConfiguredTeamSourceEntry("FOOTBALL_DATA_TEAM_MAP", teamName);
  const footballDataTeamId = existing?.footballDataTeamId || existing?.sourceIds?.footballData || configured?.id || configured?.teamId || configured;
  if (!footballDataTeamId || !/^\d+$/.test(String(footballDataTeamId))) return null;

  openSquadSourceState.footballDataCount += 1;
  await sleep(350);
  const json = await fetchExternalJson(`https://api.football-data.org/v4/teams/${footballDataTeamId}`, { "X-Auth-Token": token });
  const squad = Array.isArray(json?.squad) ? json.squad : [];
  if (!squad.length) return null;
  return {
    source: "football-data.org",
    sources: ["football-data.org"],
    footballDataTeamId: String(footballDataTeamId),
    sourceIds: { ...(existing?.sourceIds || {}), footballData: String(footballDataTeamId) },
    playerCount: squad.length,
    players: squad.slice(0, 60).map((player) => ({
      id: player.id ? `football-data:${player.id}` : "",
      name: player.name || "",
      position: player.position || "",
      nationality: player.nationality || "",
      dateBorn: player.dateOfBirth || null,
      status: "beschikbaar",
      availability: "beschikbaar",
      loan: false,
      source: "football-data.org",
    })),
  };
}

async function fetchReepIdentityProfile(teamName, existing = null) {
  if (openSquadSourceState.reepCount >= MAX_REEP_IDENTITY_FETCHES_PER_RUN) return null;
  const configured = getConfiguredTeamSourceEntry("REEP_TEAM_MAP", teamName);
  if (!configured) return null;
  openSquadSourceState.reepCount += 1;
  const reepId = typeof configured === "string" ? configured : configured.id || configured.teamId || configured.reepId || "";
  if (!reepId) return null;
  return {
    ...(existing || {}),
    source: existing?.source || "Reep Football identity",
    sources: Array.from(new Set([...(existing?.sources || []), "Reep Football identity"])),
    sourceIds: { ...(existing?.sourceIds || {}), reep: String(reepId) },
    reepTeamId: String(reepId),
    playerCount: Number(existing?.playerCount || existing?.players?.length || 0),
    players: Array.isArray(existing?.players) ? existing.players : [],
  };
}

async function fetchOpenSquadProfile(teamName, existing = null) {
  const profiles = [];
  const wikipedia = await fetchWikipediaSquadProfile(teamName);
  if (wikipedia) profiles.push(wikipedia);
  let merged = mergeSquadProfiles(profiles);

  if (shouldAskFallbackSquadSources(merged)) {
    const forza = await fetchForzaSquadProfile(teamName, existing || merged);
    if (forza) {
      profiles.push(forza);
      merged = mergeSquadProfiles(profiles);
    }
  }

  if (shouldAskFallbackSquadSources(merged)) {
    const footballDataOrg = await fetchFootballDataOrgSquadProfile(teamName, existing || merged);
    if (footballDataOrg) {
      profiles.push(footballDataOrg);
      merged = mergeSquadProfiles(profiles);
    }
  }

  if (shouldAskFallbackSquadSources(merged)) {
    const sportsDb = await fetchSportsDbSquadProfile(teamName);
    if (sportsDb) {
      profiles.push(sportsDb);
      merged = mergeSquadProfiles(profiles);
    }
  }

  if (shouldAskFallbackSquadSources(merged)) {
    const wikidata = await fetchWikidataSquadProfile(teamName);
    if (wikidata) {
      profiles.push(wikidata);
      merged = mergeSquadProfiles(profiles);
    }
  }

  const withIdentity = await fetchReepIdentityProfile(teamName, existing || merged);
  if (withIdentity) profiles.push(withIdentity);
  return mergeSquadProfiles(profiles);
}

function buildDerivedSquadProfile({ teamId, teamName, recent, seasonStats, injuries, clubElo, standingPos, existing }) {
  const ppg = toPointsPerGame(recent?.wins, recent?.draws, recent?.gamesPlayed);
  const eloScore = clubElo ? clamp((Number(clubElo) - 1250) / 750, 0.15, 1) : 0.52;
  const formScore = clamp(ppg / 3, 0.12, 1);
  const dominanceScore =
    seasonStats?.dominanceScore != null
      ? clamp((Number(seasonStats.dominanceScore || 0) + 2) / 4, 0.12, 1)
      : 0.5;
  const standingScore = standingPos ? clamp(1 - (Number(standingPos) - 1) / 22, 0.12, 1) : 0.5;
  const playerCount = Number(existing?.playerCount || existing?.players?.length || 0);
  const rosterCoverage = playerCount ? clamp(playerCount / 24, 0.35, 1) : 0.25;
  const injuryPenalty = clamp(Number(injuries?.injuredCount || 0) * 0.018 + Number(injuries?.injuredRating || 0) * 0.01, 0, 0.18);
  const rating = Number(
    clamp(
      (eloScore * 0.34 + formScore * 0.28 + dominanceScore * 0.16 + standingScore * 0.14 + rosterCoverage * 0.08 - injuryPenalty) * 100,
      22,
      94
    ).toFixed(1)
  );

  return {
    ...(existing || {}),
    key: buildTeamStoreKey(teamId, teamName),
    teamId: teamId || existing?.teamId || "",
    teamName: teamName || existing?.teamName || "",
    rating,
    ratingLabel: rating >= 76 ? "sterk" : rating >= 62 ? "boven gemiddeld" : rating >= 48 ? "gemiddeld" : "kwetsbaar",
    playerCount,
    players: Array.isArray(existing?.players) ? existing.players : [],
    source: existing?.source || "derived-team-strength",
    sources: Array.isArray(existing?.sources) && existing.sources.length ? existing.sources : [existing?.source || "derived-team-strength"],
    injuredPlayers: injuries?.injuredPlayers || injuries?.players || [],
    suspendedPlayers: injuries?.suspendedPlayers || [],
    unavailableCount: Number(injuries?.injuredCount || 0) + Number(injuries?.suspendedCount || 0),
    coverage: Number(rosterCoverage.toFixed(2)),
    lastComputedAt: Date.now(),
    factors: {
      eloScore: Number(eloScore.toFixed(2)),
      formScore: Number(formScore.toFixed(2)),
      dominanceScore: Number(dominanceScore.toFixed(2)),
      standingScore: Number(standingScore.toFixed(2)),
      rosterCoverage: Number(rosterCoverage.toFixed(2)),
      injuryPenalty: Number(injuryPenalty.toFixed(2)),
    },
  };
}

function buildTransferWatchProfile({ teamId, teamName, squadProfile, recent, injuries, existing, transferWindow }) {
  const recentGames = Number(recent?.gamesPlayed || 0);
  const formVolatility = recentGames
    ? clamp(Math.abs(Number(recent?.avgScored || 1.35) - Number(recent?.avgConceded || 1.35)) / 4, 0, 0.35)
    : 0.18;
  const injuryDrag = clamp(Number(injuries?.injuredCount || 0) * 0.025, 0, 0.25);
  const rosterBoost = Number(squadProfile?.playerCount || 0) >= 20 ? 0.03 : 0;
  const netStrengthChange = Number(clamp(rosterBoost - injuryDrag + formVolatility * 0.12, -0.35, 0.35).toFixed(2));
  const riskScore = clamp((Number(squadProfile?.coverage || 0.25) < 0.45 ? 0.22 : 0) + injuryDrag + formVolatility, 0, 1);

  return {
    ...(existing || {}),
    key: buildTeamStoreKey(teamId, teamName),
    teamId: teamId || existing?.teamId || "",
    teamName: teamName || existing?.teamName || "",
    incomingPlayers: Array.isArray(existing?.incomingPlayers) ? existing.incomingPlayers : [],
    outgoingPlayers: Array.isArray(existing?.outgoingPlayers) ? existing.outgoingPlayers : [],
    netStrengthChange,
    riskScore: Number(riskScore.toFixed(2)),
    riskLevel: riskScore >= 0.55 ? "hoog" : riskScore >= 0.3 ? "middel" : "laag",
    source: existing?.source || "derived-transfer-watch",
    lastCheckedAt: Date.now(),
    transferWindow: transferWindow || getTransferWindowState(Date.now()),
    note: transferWindow?.watchMode
      ? "Transferwindow-bewaking actief: spelerslijsten worden vaker gecontroleerd omdat selecties kunnen wijzigen."
      : "Buiten transferwindow: gevulde spelerslijsten worden rustig maandelijks gecontroleerd; lege teams blijven in backfill.",
  };
}

async function updateTeamIntelligence(store, args) {
  const { teamId, teamName, recent, seasonStats, injuries, clubElo, standingPos, now } = args;
  const transferWindow = getTransferWindowState(now);
  const key = buildTeamStoreKey(teamId, teamName);
  if (!store.teamSquads) store.teamSquads = {};
  if (!store.teamSquadsUpdated) store.teamSquadsUpdated = {};
  if (!store.teamTransfers) store.teamTransfers = {};
  if (!store.teamTransfersUpdated) store.teamTransfersUpdated = {};

  let existingSquad = store.teamSquads[key] || null;
  if (
    existingSquad?.source === "Wikidata" &&
    Number(existingSquad?.players?.length || existingSquad?.playerCount || 0) > 42
  ) {
    existingSquad = {
      ...existingSquad,
      players: [],
      playerCount: 0,
      source: "derived-team-strength",
      sources: ["Wikidata-overbroad-rejected", "derived-team-strength"],
      rejectedRosterSource: "Wikidata gaf waarschijnlijk historische spelers terug",
      rosterBackfillAttemptedAt: 0,
    };
  }
  if (Array.isArray(existingSquad?.players) && existingSquad.players.some((player) => /[\[\]{}]/.test(String(player?.name || "")))) {
    existingSquad = {
      ...existingSquad,
      players: [],
      playerCount: 0,
      source: "derived-team-strength",
      sources: ["roster-cleanup-required", "derived-team-strength"],
      rejectedRosterSource: "Spelerslijst bevatte wiki-opmaak en wordt opnieuw opgehaald",
      rosterBackfillAttemptedAt: 0,
    };
  }
  const hasRosterPlayers = Number(existingSquad?.players?.length || existingSquad?.playerCount || 0) > 0;
  const rosterSourceCheckedAt = Number(existingSquad?.rosterSourceCheckedAt || existingSquad?.fetchedAt || 0);
  const rosterRefreshTtl = transferWindow.watchMode ? TRANSFER_WINDOW_SQUAD_TTL : SQUAD_TTL;
  const rosterRefreshDue = !rosterSourceCheckedAt || now - rosterSourceCheckedAt > rosterRefreshTtl;
  const rosterBackfillStale =
    existingSquad?.rosterBackfillVersion !== ROSTER_BACKFILL_VERSION ||
    (!hasRosterPlayers && now - Number(existingSquad?.rosterBackfillAttemptedAt || 0) > EMPTY_SQUAD_RETRY_TTL);
  const shouldFetchRoster =
    !existingSquad ||
    rosterBackfillStale ||
    (hasRosterPlayers && rosterRefreshDue);
  if (shouldFetchRoster) {
    const roster = await fetchOpenSquadProfile(teamName, existingSquad);
    if (roster) {
      existingSquad = {
        ...(existingSquad || {}),
        ...roster,
        teamId: teamId || existingSquad?.teamId || "",
        teamName,
        fetchedAt: now,
        rosterSourceCheckedAt: now,
        rosterBackfillAttemptedAt: now,
        rosterBackfillVersion: ROSTER_BACKFILL_VERSION,
        rosterRefreshReason: hasRosterPlayers
          ? transferWindow.watchMode
            ? "transferwindow-controle"
            : "maandelijkse-controle"
          : "lege-selectie-backfill",
        nextRosterRefreshAt: now + rosterRefreshTtl,
        transferWindow,
      };
      await sleep(40);
    } else if (existingSquad) {
      existingSquad = {
        ...existingSquad,
        rosterBackfillAttemptedAt: now,
        rosterRefreshReason: hasRosterPlayers ? "controle-mislukt-selectie-behouden" : "backfill-mislukt",
        nextRosterRefreshAt: hasRosterPlayers ? now + 24 * 60 * 60 * 1000 : now + EMPTY_SQUAD_RETRY_TTL,
        transferWindow,
      };
    } else {
      existingSquad = {
        key,
        teamId: teamId || "",
        teamName,
        players: [],
        playerCount: 0,
        source: "derived-team-strength",
        sources: ["roster-backfill-pending", "derived-team-strength"],
        rosterBackfillAttemptedAt: now,
        rosterRefreshReason: "backfill-mislukt",
        nextRosterRefreshAt: now + EMPTY_SQUAD_RETRY_TTL,
        transferWindow,
      };
    }
  } else if (existingSquad) {
    existingSquad = {
      ...existingSquad,
      nextRosterRefreshAt: (rosterSourceCheckedAt || now) + rosterRefreshTtl,
      transferWindow,
    };
  }

  const squadProfile = buildDerivedSquadProfile({
    teamId,
    teamName,
    recent,
    seasonStats,
    injuries,
    clubElo,
    standingPos,
    existing: existingSquad,
  });
  store.teamSquads[key] = squadProfile;
  store.teamSquadsUpdated[key] = now;

  const existingTransfer = store.teamTransfers[key] || null;
  const transferProfile = buildTransferWatchProfile({
    teamId,
    teamName,
    squadProfile,
    recent,
    injuries,
    existing: existingTransfer,
    transferWindow,
  });
  store.teamTransfers[key] = transferProfile;
  store.teamTransfersUpdated[key] = now;

  return { squadProfile, transferProfile };
}

function buildTeamSquadSummary(store) {
  const squads = Object.values(store.teamSquads || {});
  const transfers = Object.values(store.teamTransfers || {});
  const transferWindow = getTransferWindowState(Date.now());
  const rated = squads.filter((item) => Number(item?.rating || 0) > 0);
  const averageRating = rated.length
    ? Number((rated.reduce((sum, item) => sum + Number(item.rating || 0), 0) / rated.length).toFixed(1))
    : 0;
  const sourceBreakdown = squads.reduce((acc, item) => {
    const sources = Array.isArray(item?.sources) && item.sources.length ? item.sources : [String(item?.source || "unknown")];
    for (const source of sources) acc[source] = Number(acc[source] || 0) + 1;
    return acc;
  }, {});
  return {
    generatedAt: Date.now(),
    teams: squads.length,
    teamsWithPlayers: squads.filter((item) => Number(item?.playerCount || 0) > 0).length,
    rostersDueForRefresh: squads.filter((item) => Number(item?.nextRosterRefreshAt || 0) <= Date.now()).length,
    monthlyRefreshDays: Math.round(SQUAD_TTL / (24 * 60 * 60 * 1000)),
    transferWindowRefreshDays: Math.round(TRANSFER_WINDOW_SQUAD_TTL / (24 * 60 * 60 * 1000)),
    transferWindow,
    transfersWatched: transfers.length,
    highTransferRisk: transfers.filter((item) => item?.riskLevel === "hoog").length,
    averageRating,
    sourceBreakdown,
    fallbackPolicy: [
      "Wikipedia eerst: snel, gratis en meestal compleet.",
      "Forza Football alleen als aanvullende fallback bij onvolledige spelerslijst of ontbrekende status/transferinformatie.",
      "football-data.org alleen met gratis token en veilige team-id mapping, zodat er geen verkeerde clubs worden gekoppeld.",
      "TheSportsDB en Wikidata blijven laatste backfill-bronnen om lege selecties geleidelijk te vullen.",
      "Reep Football is een ID/alias-koppellaag voor betere clubnaam- en logomatching, geen primaire spelersbron.",
    ],
    strongestTeams: rated
      .sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0))
      .slice(0, 10)
      .map((item) => ({
        teamName: item.teamName,
        rating: item.rating,
        playerCount: item.playerCount || 0,
        source: item.source || "unknown",
      })),
  };
}

function buildTeamProfile({ teamName, recent, seasonStats, postMatchStatsProfile, injuries, clubElo, standingPos, squadProfile, transferProfile }) {
  const homeSplit = recent?.splits?.home || emptySplit();
  const awaySplit = recent?.splits?.away || emptySplit();
  const strongestSide = recent?.strongestSide || "balanced";
  const attackTrend = Number(((recent?.avgScored || 1.35) - (recent?.avgConceded || 1.35)).toFixed(2));
  const consistency =
    recent?.gamesPlayed
      ? Number(
          (
            (Number(recent.wins || 0) + Number(recent.draws || 0) * 0.5) /
            Math.max(Number(recent.gamesPlayed || 1), 1)
          ).toFixed(2)
        )
      : 0.5;
  const setPieceScore = Number(
    (
      Number(seasonStats?.avgCorners || 4.5) * 0.45 +
      Number(seasonStats?.avgShotsOn || 4) * 0.35 +
      Math.max(0, attackTrend) * 0.2
    ).toFixed(2)
  );
  const rolling = postMatchStatsProfile?.rolling || {};
  const blendedSeason = {
    avgShotsOn: seasonStats?.avgShotsOn ?? rolling.shotsOnTarget ?? null,
    avgShotsOnAgainst: seasonStats?.avgShotsOnAgainst ?? null,
    avgShots: seasonStats?.avgShots ?? null,
    avgShotsAgainst: seasonStats?.avgShotsAgainst ?? null,
    avgPossession: seasonStats?.avgPossession ?? rolling.possession ?? null,
    avgCorners: seasonStats?.avgCorners ?? rolling.corners ?? null,
    avgCornersAgainst: seasonStats?.avgCornersAgainst ?? null,
    cleanSheets: seasonStats?.cleanSheets ?? null,
    cleanSheetRate: seasonStats?.cleanSheetRate ?? null,
    failToScoreRate: seasonStats?.failToScoreRate ?? null,
    bttsRate: seasonStats?.bttsRate ?? null,
    over25Rate: seasonStats?.over25Rate ?? null,
    dominanceScore: seasonStats?.dominanceScore ?? null,
    historicalGames: seasonStats?.historicalGames ?? null,
  };

  return {
    teamName,
    standingPos: standingPos ?? null,
    clubElo: clubElo ?? null,
    strongestSide,
    pointsPerGame: toPointsPerGame(recent?.wins, recent?.draws, recent?.gamesPlayed),
    attackTrend,
    consistency,
    setPieceScore,
    cornersTrend: Number(seasonStats?.avgCorners || 0),
    disciplineIndex: Number(
      (
        Number(recent?.yellowCardRate || 0) +
        Number(recent?.redCardRate || 0) * 1.7
      ).toFixed(2)
    ),
    fatigueIndex: Number(
      (
        Math.max(0, 5 - Number(recent?.gamesPlayed || 0) * 0.1) +
        Math.max(0, Number(injuries?.injuredCount || 0) * 0.12)
      ).toFixed(2)
    ),
    homeSplit: {
      avgScored: homeSplit.avgScored,
      avgConceded: homeSplit.avgConceded,
      over25Rate: homeSplit.over25Rate,
      cleanSheetRate: homeSplit.cleanSheetRate,
    },
    awaySplit: {
      avgScored: awaySplit.avgScored,
      avgConceded: awaySplit.avgConceded,
      over25Rate: awaySplit.over25Rate,
      cleanSheetRate: awaySplit.cleanSheetRate,
    },
    season: seasonStats || postMatchStatsProfile ? blendedSeason : null,
    postMatchRolling: postMatchStatsProfile?.rolling || null,
    goalQuarterProfile: postMatchStatsProfile?.quarterScoring || null,
    injuries: {
      count: Number(injuries?.injuredCount || 0),
      ratingImpact: Number(injuries?.injuredRating || 0),
      keyPlayersMissing: injuries?.keyPlayersMissing || [],
    },
    squad: squadProfile || null,
    transferWatch: transferProfile || null,
    teamStrengthRating: squadProfile?.rating ?? null,
    squadRating: squadProfile?.rating ?? null,
    transferImpact: transferProfile?.netStrengthChange ?? 0,
    discipline: {
      yellowRate: Number(recent?.yellowCardRate || 0),
      redRate: Number(recent?.redCardRate || 0),
    },
  };
}

function calcLineupContinuity(lineupSide, injuries) {
  const starters = Number(lineupSide?.starters || 0);
  const avgRating = Number(lineupSide?.avgRating || 6.8);
  const injuryPenalty = Number(injuries?.injuredCount || 0) * 0.07;
  const starterScore = starters ? Math.min(1, starters / 11) : 0.55;
  const ratingScore = Math.max(0, Math.min(1, (avgRating - 6) / 2));
  return Number(Math.max(0, starterScore * 0.6 + ratingScore * 0.4 - injuryPenalty).toFixed(2));
}

function calcTravelPenalty({ homeCountry, awayCountry, leagueType }) {
  const home = normalizeName(homeCountry);
  const away = normalizeName(awayCountry);
  if (!home || !away) return 0;
  if (home === away) return 0;
  if (leagueType === "cup") return 0.22;
  return 0.1;
}

function calcKeeperEdge(lineupSummary) {
  const homeKeeper = Number(lineupSummary?.home?.keeperRating || 0);
  const awayKeeper = Number(lineupSummary?.away?.keeperRating || 0);
  if (!homeKeeper && !awayKeeper) return 0;
  return Number((homeKeeper - awayKeeper).toFixed(2));
}

function calculateRecentH2HBalance(h2h, currentHomeId, currentAwayId) {
  if (!h2h?.results || h2h.results.length === 0) return 0;
  if (!currentHomeId || !currentAwayId) return 0;
  
  // Pak de laatste 5 wedstrijden (of minder als er niet genoeg zijn)
  const recent = h2h.results.slice(-5);
  
  // Bereken gewogen balance - recentere wedstrijden wegen zwaarder
  // Gewichten: laatste = 1.0, voorlaatste = 0.9, etc.
  let weightedScore = 0;
  let totalWeight = 0;
  
  recent.forEach((result, index) => {
    const weight = 0.6 + (index * 0.1); // 0.6, 0.7, 0.8, 0.9, 1.0
    
    // Score: +1 als huidige home team won, -1 als huidige away team won, 0 voor draw
    let score = 0;
    if (result.winnerId) {
      const currentHomeIdStr = String(currentHomeId);
      const currentAwayIdStr = String(currentAwayId);
      
      if (result.winnerId === currentHomeIdStr) {
        score = 1;
      } else if (result.winnerId === currentAwayIdStr) {
        score = -1;
      }
    }
    
    weightedScore += score * weight;
    totalWeight += weight;
  });
  
  return totalWeight > 0 ? Number((weightedScore / totalWeight).toFixed(2)) : 0;
}

function buildHeuristicEnsemble(featureVector) {
  let homeScore = 0;
  let drawScore = 0;
  let awayScore = 0;

  homeScore += featureVector.ppg_diff * 0.22;
  awayScore -= featureVector.ppg_diff * 0.22;
  homeScore += featureVector.club_elo_diff / 180 * 0.18;
  awayScore -= featureVector.club_elo_diff / 180 * 0.18;
  homeScore += Number(featureVector.squad_rating_diff || 0) * 0.045;
  awayScore -= Number(featureVector.squad_rating_diff || 0) * 0.045;
  homeScore += Number(featureVector.transfer_impact_diff || 0) * 0.055;
  awayScore -= Number(featureVector.transfer_impact_diff || 0) * 0.055;
  homeScore += featureVector.rest_diff * 0.08;
  awayScore -= featureVector.rest_diff * 0.08;
  homeScore += (featureVector.home_home_split_scored - featureVector.away_away_split_conceded) * 0.16;
  awayScore += (featureVector.away_away_split_scored - featureVector.home_home_split_conceded) * 0.16;
  homeScore += featureVector.set_piece_diff * 0.04;
  awayScore -= featureVector.set_piece_diff * 0.04;
  homeScore += (featureVector.home_avg_corners - featureVector.away_avg_corners) * 0.015;
  awayScore += (featureVector.away_avg_corners - featureVector.home_avg_corners) * 0.015;
  homeScore += featureVector.dominance_diff * 0.08;
  awayScore -= featureVector.dominance_diff * 0.08;
  homeScore += (featureVector.home_avg_shots - featureVector.away_avg_shots_against) * 0.01;
  awayScore += (featureVector.away_avg_shots - featureVector.home_avg_shots_against) * 0.01;
  homeScore += Number(featureVector.home_db_xg || 0) * 0.035;
  awayScore += Number(featureVector.away_db_xg || 0) * 0.035;
  homeScore += (Number(featureVector.db_historical_home_implied || 0) - Number(featureVector.db_historical_away_implied || 0)) * 0.16;
  awayScore += (Number(featureVector.db_historical_away_implied || 0) - Number(featureVector.db_historical_home_implied || 0)) * 0.16;
  drawScore += Math.min(Number(featureVector.db_historical_odds_samples || 0), 8) * 0.003;
  drawScore += Number(featureVector.weather_risk || 0) * 0.018;
  homeScore += featureVector.lineups_avg_rating_diff * 0.05;
  awayScore -= featureVector.lineups_avg_rating_diff * 0.05;
  homeScore += featureVector.keeper_rating_diff * 0.035;
  awayScore -= featureVector.keeper_rating_diff * 0.035;
  homeScore += (featureVector.home_lineup_continuity - featureVector.away_lineup_continuity) * 0.16;
  awayScore += (featureVector.away_lineup_continuity - featureVector.home_lineup_continuity) * 0.16;
  homeScore += featureVector.away_travel_penalty * 0.18;
  awayScore -= featureVector.away_travel_penalty * 0.18;
  homeScore += featureVector.market_overperformance_diff * 0.1 * Math.max(featureVector.market_strength, 0.35);
  awayScore -= featureVector.market_overperformance_diff * 0.1 * Math.max(featureVector.market_strength, 0.35);
  homeScore += (featureVector.league_reliability - 0.5) * 0.08;
  awayScore += (featureVector.league_reliability - 0.5) * 0.08;
  drawScore += Math.max(0, 0.12 - featureVector.referee_penalty_rate * 0.08);
  homeScore -= Math.max(0, featureVector.referee_cards_trend - 2.8) * 0.02;
  awayScore -= Math.max(0, featureVector.referee_cards_trend - 2.8) * 0.02;
  drawScore += Math.max(0, 0.25 - Math.abs(featureVector.ppg_diff) * 0.06);
  drawScore += Math.max(0, 0.18 - Math.abs(featureVector.club_elo_diff) / 1000);
  homeScore -= featureVector.home_injuries * 0.05;
  awayScore -= featureVector.away_injuries * 0.05;
  homeScore -= featureVector.home_cards_rate * 0.015;
  awayScore -= featureVector.away_cards_rate * 0.015;
  // H2H algemeen patroon (lichte weging)
  const h2hWeight = Number(featureVector.h2h_reliability || 0);
  homeScore += featureVector.h2h_balance * 0.05 * h2hWeight;
  awayScore -= featureVector.h2h_balance * 0.05 * h2hWeight;
  // Recente onderlinge vorm weegt alleen stevig als er minimaal 3 betrouwbare duels zijn.
  homeScore += featureVector.h2h_recent_5_balance * 0.12 * h2hWeight;
  awayScore -= featureVector.h2h_recent_5_balance * 0.12 * h2hWeight;
  // Leermodel per team
  homeScore += featureVector.learning_outcome_bias_diff * 0.16;
  awayScore -= featureVector.learning_outcome_bias_diff * 0.16;
  homeScore += featureVector.home_learning_goal_bias * 0.05;
  awayScore += featureVector.away_learning_goal_bias * 0.05;
  // Historische marktprofilering uit gratis oddsdata
  homeScore += (featureVector.home_market_implied_ppg - featureVector.away_market_implied_ppg) * 0.12;
  awayScore += (featureVector.away_market_implied_ppg - featureVector.home_market_implied_ppg) * 0.12;
  homeScore += featureVector.market_overperformance_diff * 0.10;
  awayScore -= featureVector.market_overperformance_diff * 0.10;
  homeScore += (featureVector.phase_reliability - 0.5) * 0.08;
  awayScore += (featureVector.phase_reliability - 0.5) * 0.08;
  homeScore -= Math.max(0, featureVector.phase_avg_goal_error - 1.5) * 0.03;
  awayScore -= Math.max(0, featureVector.phase_avg_goal_error - 1.5) * 0.03;

  const homeRaw = Math.exp(homeScore);
  const drawRaw = Math.exp(drawScore);
  const awayRaw = Math.exp(awayScore);
  const total = homeRaw + drawRaw + awayRaw;

  return {
    homeProb: Number((homeRaw / total).toFixed(4)),
    drawProb: Number((drawRaw / total).toFixed(4)),
    awayProb: Number((awayRaw / total).toFixed(4)),
  };
}

function blendProbabilities(base, heuristic, weightBase = 0.78) {
  const weightHeuristic = 1 - weightBase;
  const homeProb = base.homeProb * weightBase + heuristic.homeProb * weightHeuristic;
  const drawProb = base.drawProb * weightBase + heuristic.drawProb * weightHeuristic;
  const awayProb = base.awayProb * weightBase + heuristic.awayProb * weightHeuristic;
  const total = homeProb + drawProb + awayProb;
  return {
    homeProb: Number((homeProb / total).toFixed(4)),
    drawProb: Number((drawProb / total).toFixed(4)),
    awayProb: Number((awayProb / total).toFixed(4)),
  };
}

function calcModelAgreement(base, heuristic) {
  const diffs = [
    Math.abs(Number(base.homeProb || 0) - Number(heuristic.homeProb || 0)),
    Math.abs(Number(base.drawProb || 0) - Number(heuristic.drawProb || 0)),
    Math.abs(Number(base.awayProb || 0) - Number(heuristic.awayProb || 0)),
  ];
  const avgDiff = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
  return Number(Math.max(0, 1 - avgDiff * 4).toFixed(3));
}

function buildLineupImpact(input) {
  const homeInjuries = Number(input.homeInjuries?.injuredCount || 0);
  const awayInjuries = Number(input.awayInjuries?.injuredCount || 0);
  const homeRating = Number(input.lineupSummary?.home?.avgRating || 6.8);
  const awayRating = Number(input.lineupSummary?.away?.avgRating || 6.8);
  const ratingDiff = Number((homeRating - awayRating).toFixed(2));
  const keeperDiff = calcKeeperEdge(input.lineupSummary);
  const homeContinuity = calcLineupContinuity(input.lineupSummary?.home, input.homeInjuries);
  const awayContinuity = calcLineupContinuity(input.lineupSummary?.away, input.awayInjuries);

  const homeImpact = Number((homeInjuries * 0.12 - Math.max(0, ratingDiff) * 0.08 - Math.max(0, keeperDiff) * 0.04).toFixed(2));
  const awayImpact = Number((awayInjuries * 0.12 + Math.min(0, ratingDiff) * -0.08 + Math.min(0, keeperDiff) * 0.04 * -1).toFixed(2));

  let summary = "neutraal";
  if (homeImpact + 0.12 < awayImpact) summary = "thuisvoordeel in opstelling";
  else if (awayImpact + 0.12 < homeImpact) summary = "uitvoordeel in opstelling";

  return {
    confirmed: !!input.lineupSummary?.confirmed,
    homeImpact,
    awayImpact,
    ratingDiff,
    keeperDiff,
    homeContinuity,
    awayContinuity,
    summary,
  };
}

function buildTacticalMismatch(input) {
  const homeSplit = pickHomeStrength(input.homeRecent);
  const awaySplit = pickAwayStrength(input.awayRecent);
  const homeScore = Number(((homeSplit.avgScored || 1.35) + (awaySplit.avgConceded || 1.35)).toFixed(2));
  const awayScore = Number(((awaySplit.avgScored || 1.35) + (homeSplit.avgConceded || 1.35)).toFixed(2));

  let summary = "gebalanceerd";
  if (homeScore > awayScore + 0.35) summary = "thuis aanvallende mismatch";
  else if (awayScore > homeScore + 0.35) summary = "uit aanvallende mismatch";

  return {
    homeScore,
    awayScore,
    summary,
  };
}

function buildFormShift(input) {
  const homeSplit = pickHomeStrength(input.homeRecent);
  const awaySplit = pickAwayStrength(input.awayRecent);
  const homeShift = Number(((Number(input.homeRecent?.avgScored || 1.35) - Number(homeSplit.avgScored || 1.35))).toFixed(2));
  const awayShift = Number(((Number(input.awayRecent?.avgScored || 1.35) - Number(awaySplit.avgScored || 1.35))).toFixed(2));

  return {
    homeShift,
    awayShift,
    summary:
      Math.abs(homeShift) < 0.15 && Math.abs(awayShift) < 0.15
        ? "stabiel"
        : homeShift > awayShift
          ? "thuis vorm stijgt sneller"
          : "uit vorm stijgt sneller",
  };
}

function buildTravelEdge(input, featureVector) {
  const penalty = Number(featureVector?.away_travel_penalty || 0);
  if (penalty <= 0) {
    return { penalty, summary: "geen noemenswaardige reisimpact" };
  }
  return {
    penalty,
    summary:
      input.leagueType === "cup"
        ? "uitploeg heeft extra Europese reislast"
        : "uitploeg heeft extra reislast",
  };
}

function buildKeeperEdge(input, featureVector) {
  const diff = Number(featureVector?.keeper_rating_diff || 0);
  if (Math.abs(diff) < 0.05) return { diff, summary: "keepers liggen dicht bij elkaar" };
  return {
    diff,
    summary: diff > 0 ? "thuiskeeper oogt sterker" : "uitkeeper oogt sterker",
  };
}

function buildTeamAiSummary(side, teamName, recent, profile, injuries) {
  const split = side === "home" ? recent?.splits?.home : recent?.splits?.away;
  const strengths = [];
  const risks = [];

  if ((profile?.pointsPerGame || 0) >= 1.9) strengths.push("hoog puntenritme");
  if ((profile?.pointsPerGame || 0) <= 1.1) risks.push("laag puntenritme");
  if ((profile?.attackTrend || 0) >= 0.45) strengths.push("positieve aanvalstrend");
  if ((profile?.attackTrend || 0) <= -0.2) risks.push("negatieve vormtrend");
  if ((split?.cleanSheetRate || 0) >= 0.35) strengths.push("sterke verdedigende split");
  if ((split?.failToScoreRate || recent?.failToScoreRate || 0) >= 0.35) risks.push("regelmatig moeite met scoren");
  if ((injuries?.injuredCount || injuries?.count || 0) >= 3) risks.push("meerdere afwezigen");
  if ((profile?.setPieceScore || 0) >= 3.8) strengths.push("sterk in standaardsituaties");
  if ((profile?.cornersTrend || 0) >= 5.2) strengths.push("hoog cornersvolume");
  if ((recent?.yellowCardRate || 0) >= 2.4) risks.push("hoog kaartenritme");
  if ((profile?.fatigueIndex || 0) >= 1.2) risks.push("vermoeidheidsrisico");

  return {
    teamName,
    strengths: strengths.slice(0, 3),
    risks: risks.slice(0, 3),
    summary:
      strengths.length || risks.length
        ? `${teamName}: ${[...strengths.slice(0, 2), ...risks.slice(0, 2)].join(", ")}`
        : `${teamName}: weinig afwijkende signalen`,
  };
}

function buildTrainingSnapshot(store) {
  const rows = [];
  const snapshotsByMatchId = new Map();
  for (const snapshot of Object.values(store.predictionSnapshots || {}).flat()) {
    if (!snapshot?.matchId) continue;
    const list = snapshotsByMatchId.get(snapshot.matchId) || [];
    list.push(snapshot);
    snapshotsByMatchId.set(snapshot.matchId, list);
  }

  for (const date of Object.keys(store.matches || {})) {
    const matches = store.matches?.[date] || [];
    const predictions = Object.fromEntries(
      (store.predictions?.[date] || []).map((prediction) => [prediction.matchId, prediction])
    );

    for (const match of matches) {
      const prediction = predictions[match.id] || {};
      const reviewPrediction = selectPredictionForReview(store, match, prediction);
      const label =
        String(match.status || "").toUpperCase() === "FT" && match.score?.includes("-")
          ? (() => {
              const [homeGoals, awayGoals] = String(match.score).split("-").map(Number);
              if (homeGoals > awayGoals) return "H";
              if (homeGoals < awayGoals) return "A";
              return "D";
            })()
          : null;
      const baseRow = {
        date,
        matchId: match.id,
        league: match.league,
        homeTeam: match.homeTeamName,
        awayTeam: match.awayTeamName,
        status: match.status || "NS",
        score: match.score || null,
        label,
        review: store.postMatchReviews?.[match.id] || null,
        dbFeatureContext: match.dbFeatureContext || prediction.dbFeatureContext || reviewPrediction?.dbFeatureContext || null,
      };
      const snapshotCandidates = (snapshotsByMatchId.get(match.id) || [])
        .filter((snapshot) => snapshot?.predictionId && snapshot?.generatedAt)
        .map((snapshot) => ({
          predictionId: snapshot.predictionId,
          generatedAt: snapshot.generatedAt,
          cutoffAt: snapshot.cutoffAt || snapshot.generatedAt,
          featureVector: snapshot.featureVector || snapshot.features || snapshot.inputSnapshot?.featureVector || null,
          ensembleMeta: snapshot.ensembleMeta || snapshot.prediction?.ensembleMeta || null,
          dbFeatureContext: snapshot.dbFeatureContext || snapshot.inputSnapshot?.dbFeatureContext || null,
          snapshotStatus: snapshot.status || null,
          snapshotBacked: true,
        }));
      const candidates = [
        {
          predictionId: reviewPrediction?.predictionId || prediction.predictionId || null,
          generatedAt: reviewPrediction?.generatedAt || prediction.generatedAt || null,
          cutoffAt: reviewPrediction?.cutoffAt || prediction.cutoffAt || null,
          featureVector: reviewPrediction?.featureVector || prediction.featureVector || null,
          ensembleMeta: reviewPrediction?.ensembleMeta || prediction.ensembleMeta || null,
          dbFeatureContext:
            reviewPrediction?.dbFeatureContext ||
            prediction.dbFeatureContext ||
            match.dbFeatureContext ||
            baseRow.dbFeatureContext ||
            null,
          snapshotBacked: false,
        },
        ...snapshotCandidates,
      ];
      const seenCandidateIds = new Set();
      for (const candidate of candidates) {
        const candidateKey = candidate.predictionId || `${match.id}:${candidate.generatedAt || "latest"}`;
        if (seenCandidateIds.has(candidateKey)) continue;
        seenCandidateIds.add(candidateKey);
        rows.push({ ...baseRow, ...candidate });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    version: "v9-snapshot-expanded",
    reviewCount: Object.keys(store.postMatchReviews || {}).length,
    rows,
  };
}

function buildLearningEdge(input) {
  const home = input.homeLearning || null;
  const away = input.awayLearning || null;
  const homeBias = Number(home?.homeOutcomeBias || 0);
  const awayBias = Number(away?.awayOutcomeBias || 0);
  const homeReliability = Number(home?.outcomeHitRate || 0);
  const awayReliability = Number(away?.outcomeHitRate || 0);
  const homeReviewedMatches = Number(home?.reviewedMatches || 0);
  const awayReviewedMatches = Number(away?.reviewedMatches || 0);
  const totalReviewedMatches = homeReviewedMatches + awayReviewedMatches;
  const denominator = (home ? 1 : 0) + (away ? 1 : 0) || 1;
  const phaseBucket = getReliabilityBucket(input);
  const phaseMultiplier =
    phaseBucket === "friendly"
      ? 0.55
      : phaseBucket === "interland" || phaseBucket === "qualification"
        ? 0.68
        : phaseBucket === "cup" || phaseBucket === "two-leg-knockout"
          ? 0.78
          : 1;
  const sampleConfidence = clamp(totalReviewedMatches / 30, 0, 1);
  const teamBalance = Math.min(homeReviewedMatches, awayReviewedMatches) / Math.max(Math.max(homeReviewedMatches, awayReviewedMatches), 1);
  const safeToApply = totalReviewedMatches >= 8 && teamBalance >= 0.25;
  const summary = home || away
    ? `${input.homeTeamProfile?.teamName || "Thuis"} ${homeBias >= 0 ? "licht onderschat" : "licht overschat"} (${Math.round(homeReliability * 100)}%) / ${input.awayTeamProfile?.teamName || "Uit"} ${awayBias >= 0 ? "licht onderschat" : "licht overschat"} (${Math.round(awayReliability * 100)}%)`
    : "nog geen reviewdata";

  return {
    summary,
    homeReviewedMatches,
    awayReviewedMatches,
    totalReviewedMatches,
    homeOutcomeHitRate: homeReliability,
    awayOutcomeHitRate: awayReliability,
    homeExactHitRate: Number(home?.exactHitRate || 0),
    awayExactHitRate: Number(away?.exactHitRate || 0),
    homeBias,
    awayBias,
    homeAvgGoalError: Number(home?.avgGoalError || 0),
    awayAvgGoalError: Number(away?.avgGoalError || 0),
    combinedReliability: Number(((homeReliability + awayReliability) / denominator).toFixed(2)),
    phaseBucket,
    phaseMultiplier: Number(phaseMultiplier.toFixed(2)),
    sampleConfidence: Number(sampleConfidence.toFixed(2)),
    teamBalance: Number(teamBalance.toFixed(2)),
    safeToApply,
    homeFragility:
      Number(home?.openLineupMisses || 0) +
      Number(home?.weatherMisses || 0) +
      Number(home?.h2hMisses || 0),
    awayFragility:
      Number(away?.openLineupMisses || 0) +
      Number(away?.weatherMisses || 0) +
      Number(away?.h2hMisses || 0),
  };
}

function buildMarketCalibration(input) {
  const home = input.homeMarketProfile || null;
  const away = input.awayMarketProfile || null;
  const leagueMeta = input.leagueMarketProfile?.leagueMeta || null;
  const supplemental = input.supplementalOdds || null;
  if (!home && !away) {
    const supplementalSignals = Array.isArray(supplemental?.bookmakerSignals) ? supplemental.bookmakerSignals : [];
    const homePpg = Number(input.homeTeamProfile?.pointsPerGame || input.homeRecent?.pointsPerGame || 0);
    const awayPpg = Number(input.awayTeamProfile?.pointsPerGame || input.awayRecent?.pointsPerGame || 0);
    const isInternational =
      isSeniorInternationalTournament(input.league) ||
      String(input.phaseBucket || "").toLowerCase() === "interland" ||
      String(input.leagueType || "").toLowerCase() === "international";
    const clubEloScale = isInternational ? 0.35 : 1;
    const eloDiff =
      Number(input.homeClubElo || 0) > 0 && Number(input.awayClubElo || 0) > 0
        ? ((Number(input.homeClubElo || 0) - Number(input.awayClubElo || 0)) * clubEloScale) / 125
        : 0;
    const derivedDiff = Number((homePpg - awayPpg + eloDiff * 0.45).toFixed(2));
    const derivedStrength = clamp(
      0.1 +
        Math.abs(derivedDiff) / 2.8 +
        Math.max(Number(input.homeSeasonStats?.sourceQuality || 0), Number(input.awaySeasonStats?.sourceQuality || 0)) * 0.25,
      0.1,
      0.42
    );
    const derivedLean = derivedDiff >= 0.3 ? "home" : derivedDiff <= -0.3 ? "away" : "neutral";
    const bookmakerSignals = [...supplementalSignals];
    if (!bookmakerSignals.length) {
      bookmakerSignals.push({
        key: "FreeProxy",
        bookmaker: "Gratis model-proxy",
        diff: derivedDiff,
        strength: Number(derivedStrength.toFixed(2)),
        closingCoverage: 0.18,
        lean: derivedLean,
        source: "derived-free-market-proxy",
      });
    }
    return {
      summary: bookmakerSignals.length
        ? supplementalSignals.length
          ? `geen historische marktdata, live oddsdekking ${supplementalSignals.length} bookmakers`
          : "geen historische marktdata; gratis model-proxy gebruikt als marktcalibratie"
        : "geen historische marktdata gekoppeld",
      source: supplementalSignals.length ? "Sofascore current odds" : "gratis model-proxy",
      homeImpliedPpg: null,
      awayImpliedPpg: null,
      overperformanceDiff: derivedDiff,
      strength: supplementalSignals.length ? 0.26 : Number(derivedStrength.toFixed(2)),
      closingLean: supplemental?.bookmakerSignals?.[0]?.lean || derivedLean,
      closingCoverage: Number(Math.max(Number(supplemental?.closingCoverage || 0), bookmakerSignals.length ? 0.18 : 0).toFixed(2)),
      bookmakerSignals,
      bookmakerAgreement: Number(supplemental?.bookmakerAgreement || (bookmakerSignals.length ? 0.46 : 0)),
    };
  }

  const homeImplied = Number(home?.homeImpliedPpg || home?.homeActualPpg || 0);
  const awayImplied = Number(away?.awayImpliedPpg || away?.awayActualPpg || 0);
  const diff = Number(
    (
      Number(home?.homeOverperformance || 0) -
      Number(away?.awayOverperformance || 0)
    ).toFixed(2)
  );
  const sampleGames = Number(home?.homeGames || 0) + Number(away?.awayGames || 0);
  const sampleStrength = Math.min(sampleGames / 26, 1);
  const closingCoverage = Number(leagueMeta?.closingCoverage || 0);
  const historicalSignals = BOOKMAKER_DEFS.map((bookmaker) => {
    const homeBook = home?.bookmakers?.[bookmaker.key] || null;
    const awayBook = away?.bookmakers?.[bookmaker.key] || null;
    if (!homeBook && !awayBook) return null;

    const bookDiff = Number(
      (
        Number(homeBook?.homeOverperformance || 0) -
        Number(awayBook?.awayOverperformance || 0)
      ).toFixed(2)
    );
    const bookGames = Number(homeBook?.homeGames || 0) + Number(awayBook?.awayGames || 0);
    const bookCoverage = Number(
      (
        (Number(homeBook?.closingCoverage || closingCoverage) +
          Number(awayBook?.closingCoverage || closingCoverage)) /
        2
      ).toFixed(2)
    );
    const bookStrength = Number((Math.min(bookGames / 18, 1) * 0.58 + Math.min(bookCoverage, 1) * 0.42).toFixed(2));
    const bookLean = bookDiff >= 0.3 ? "home" : bookDiff <= -0.3 ? "away" : "neutral";
    return {
      key: bookmaker.key,
        bookmaker: bookmaker.label,
        diff: bookDiff,
        strength: bookStrength,
        closingCoverage: bookCoverage,
        lean: bookLean,
        source: "football-data.co.uk",
      };
  }).filter(Boolean);

  const supplementalSignals = Array.isArray(supplemental?.bookmakerSignals) ? supplemental.bookmakerSignals : [];
  const bookmakerSignals = [...historicalSignals];
  for (const signal of supplementalSignals) {
    if (bookmakerSignals.some((item) => item.key === signal.key)) continue;
    bookmakerSignals.push(signal);
  }

  const weightedBookDiff = bookmakerSignals.length
    ? bookmakerSignals.reduce((sum, item) => sum + Number(item.diff || 0) * Math.max(Number(item.strength || 0), 0.1), 0) /
      bookmakerSignals.reduce((sum, item) => sum + Math.max(Number(item.strength || 0), 0.1), 0)
    : diff;
  let bookmakerAgreement =
    bookmakerSignals.length > 0
      ? Number(
          (
            bookmakerSignals.filter((item) => item.lean === "home" || item.lean === "away").length /
            bookmakerSignals.length
          ).toFixed(2)
        )
      : 0;
  const bookmakerCoverage = bookmakerSignals.length
    ? bookmakerSignals.reduce((sum, item) => sum + Number(item.closingCoverage || 0), 0) / bookmakerSignals.length
    : 0;
  const strength = Number(
    (
      sampleStrength * 0.42 +
      Math.min(Math.max(closingCoverage, Number(supplemental?.closingCoverage || 0), bookmakerCoverage), 1) * 0.23 +
      (bookmakerSignals.length ? bookmakerSignals.reduce((sum, item) => sum + Number(item.strength || 0), 0) / bookmakerSignals.length : 0) * 0.35
    ).toFixed(2)
  );
  const closingLean = weightedBookDiff >= 0.35 ? "home" : weightedBookDiff <= -0.35 ? "away" : "neutral";
  const effectiveCoverage = Number(Math.max(closingCoverage, Number(supplemental?.closingCoverage || 0), bookmakerCoverage).toFixed(2));

  if (!bookmakerSignals.length && Number.isFinite(weightedBookDiff)) {
    bookmakerSignals.push({
      key: "Hist",
      bookmaker: "Historical closing",
      diff: Number(weightedBookDiff.toFixed(2)),
      strength: Number(Math.max(strength, 0.12).toFixed(2)),
      closingCoverage: effectiveCoverage,
      lean: closingLean,
      source: "historical-closing-fallback",
    });
  }
  if (!bookmakerSignals.length) {
    const sourceQuality = Math.max(Number(input.homeSeasonStats?.sourceQuality || 0), Number(input.awaySeasonStats?.sourceQuality || 0));
    const sourceDiff = Number((Number(input.homeTeamProfile?.pointsPerGame || 0) - Number(input.awayTeamProfile?.pointsPerGame || 0)).toFixed(2));
    bookmakerSignals.push({
      key: "FreeProxy",
      bookmaker: "Gratis model-proxy",
      diff: sourceDiff,
      strength: Number(clamp(0.12 + sourceQuality * 0.25, 0.12, 0.38).toFixed(2)),
      closingCoverage: 0.18,
      lean: sourceDiff >= 0.3 ? "home" : sourceDiff <= -0.3 ? "away" : "neutral",
      source: "derived-free-market-proxy",
    });
  }
  if (bookmakerSignals.length && bookmakerAgreement === 0) {
    bookmakerAgreement = Number(
      (
        bookmakerSignals.filter((item) => item.lean === "home" || item.lean === "away").length /
        bookmakerSignals.length
      ).toFixed(2)
    );
  }

  return {
    summary: `closing-profiel ${input.homeTeamProfile?.teamName || "thuis"} ${homeImplied.toFixed(2)} PPG vs ${input.awayTeamProfile?.teamName || "uit"} ${awayImplied.toFixed(2)} PPG, dekking ${Math.round(effectiveCoverage * 100)}%, bookmaker-consensus ${Math.round(bookmakerAgreement * 100)}%`,
    source: supplementalSignals.length ? "football-data.co.uk + Sofascore current odds" : "football-data.co.uk",
    homeImpliedPpg: homeImplied,
    awayImpliedPpg: awayImplied,
    overperformanceDiff: diff,
    homeGames: Number(home?.homeGames || 0),
    awayGames: Number(away?.awayGames || 0),
    strength,
    closingLean,
    closingCoverage: effectiveCoverage,
    bookmakerSignals,
    bookmakerAgreement,
  };
}

function getSeasonFolder(dateISO) {
  const base = dateISO ? new Date(dateISO) : new Date();
  const amsterdamString = base.toLocaleString("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "numeric",
  });
  const [yearStr, monthStr] = amsterdamString.split('/');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const startYear = month >= 6 ? year : year - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}${String(endYear).slice(-2)}`;
}

function getSeasonFolders(dateISO, seasonsBack = 2) {
  const base = dateISO ? new Date(dateISO) : new Date();
  const amsterdamString = base.toLocaleString("en-US", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "numeric",
  });
  const [monthStr, yearStr] = amsterdamString.split('/');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const startYear = month >= 6 ? year : year - 1;
  const folders = [];
  for (let offset = 0; offset < seasonsBack; offset += 1) {
    const currentStart = startYear - offset;
    const currentEnd = currentStart + 1;
    folders.push(`${String(currentStart).slice(-2)}${String(currentEnd).slice(-2)}`);
  }
  return folders;
}

function getOpenfootballSeasonTags(dateISO, seasonsBack = 2) {
  const folder = getSeasonFolder(dateISO);
  const startYear = 2000 + Number(folder.slice(0, 2));
  const tags = [];
  for (let offset = 0; offset < seasonsBack; offset += 1) {
    const currentStart = startYear - offset;
    const currentEnd = String(currentStart + 1).slice(-2);
    tags.push(`${currentStart}-${currentEnd}`);
  }
  return tags;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function parseCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? "";
    });
    return row;
  });
}

function parseFootballDataDateKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    let year = Number(slashMatch[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return raw;
  return null;
}

function buildFootballDataKickoffIso(dateKey, timeValue) {
  const rawTime = String(timeValue || "").trim();
  const timeMatch = rawTime.match(/^(\d{1,2}):(\d{2})$/);
  const hours = timeMatch ? Number(timeMatch[1]) : 15;
  const minutes = timeMatch ? Number(timeMatch[2]) : 0;
  return new Date(
    `${dateKey}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+02:00`
  ).toISOString();
}

async function fetchFallbackScheduledEventsFromMarket(dateISO) {
  const seasonFolder = getSeasonFolder(dateISO);
  const fallbackEvents = [];
  const seen = new Set();

  for (const leagueInfo of LEAGUES.filter((item) => MARKET_LEAGUE_CODES[item.label])) {
    const marketCode = MARKET_LEAGUE_CODES[leagueInfo.label];
    const csvText = await fetchText(`https://www.football-data.co.uk/mmz4281/${seasonFolder}/${marketCode}.csv`);
    if (!csvText) continue;

    for (const row of parseCsv(csvText)) {
      const rowDate = parseFootballDataDateKey(row.Date || row.date);
      if (rowDate !== dateISO) continue;

      const homeName = String(row.HomeTeam || row.homeTeam || "").trim();
      const awayName = String(row.AwayTeam || row.awayTeam || "").trim();
      if (!homeName || !awayName) continue;
      if (isWomenContext(leagueInfo.label, homeName, awayName) || isYouthContext(leagueInfo.label, homeName, awayName)) continue;

      const id = `fd-${marketCode}-${dateISO}-${normalizeName(homeName)}-${normalizeName(awayName)}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const homeGoals = toNumber(row.FTHG);
      const awayGoals = toNumber(row.FTAG);
      const finished = Number.isFinite(homeGoals) && Number.isFinite(awayGoals);

      fallbackEvents.push({
        id,
        startTimestamp: Math.floor(new Date(buildFootballDataKickoffIso(dateISO, row.Time)).getTime() / 1000),
        homeTeam: { id: "", name: homeName, country: { name: leagueInfo.country || "" } },
        awayTeam: { id: "", name: awayName, country: { name: leagueInfo.country || "" } },
        uniqueTournament: { id: null, name: leagueInfo.name },
        tournament: {
          id: null,
          name: leagueInfo.name,
          category: { name: leagueInfo.country || "" },
          uniqueTournament: { id: null },
        },
        season: { id: null },
        status: { type: finished ? "finished" : "notstarted" },
        homeScore: finished ? { current: homeGoals } : {},
        awayScore: finished ? { current: awayGoals } : {},
        source: "football-data-fixture-fallback",
      });
    }
  }

  return fallbackEvents;
}

function dedupeFallbackEvents(events) {
  const hasScore = (event) => event?.homeScore?.current != null && event?.awayScore?.current != null;
  const hasLogos = (event) => Boolean(event?.homeTeam?.logoUrl) && Boolean(event?.awayTeam?.logoUrl);
  const quality = (event) => {
    const status = resolveAppStatus(event);
    const statusScore = status === "FT" ? 60 : status === "LIVE" || status === "HT" ? 50 : status === "RESULT_PENDING" ? 15 : 0;
    const scoreQuality = hasScore(event) ? 25 : 0;
    const logoQuality = Number(Boolean(event?.homeTeam?.logoUrl)) + Number(Boolean(event?.awayTeam?.logoUrl));
    const sourceQuality = String(event?.source || "").includes("espn")
      ? 8
      : String(event?.source || "").includes("thesportsdb")
        ? 6
        : String(event?.source || "").includes("openligadb")
          ? 4
          : 1;
    return statusScore + scoreQuality + logoQuality + sourceQuality;
  };
  const mergeEvent = (current, incoming) => {
    const incomingPreferred = quality(incoming) > quality(current);
    const preferred = incomingPreferred ? { ...incoming } : { ...current };
    const fallback = incomingPreferred ? current : incoming;

    preferred.homeTeam = {
      ...(fallback?.homeTeam || {}),
      ...(preferred?.homeTeam || {}),
      logoUrl: preferred?.homeTeam?.logoUrl || fallback?.homeTeam?.logoUrl || "",
    };
    preferred.awayTeam = {
      ...(fallback?.awayTeam || {}),
      ...(preferred?.awayTeam || {}),
      logoUrl: preferred?.awayTeam?.logoUrl || fallback?.awayTeam?.logoUrl || "",
    };

    if (!hasScore(preferred) && hasScore(fallback)) {
      preferred.homeScore = fallback.homeScore;
      preferred.awayScore = fallback.awayScore;
      preferred.status = fallback.status || preferred.status;
      preferred.time = fallback.time || preferred.time;
      preferred.period = fallback.period || preferred.period;
    }

    if (!hasLogos(preferred) && hasLogos(fallback)) {
      preferred.homeTeam.logoUrl = fallback.homeTeam.logoUrl;
      preferred.awayTeam.logoUrl = fallback.awayTeam.logoUrl;
    }

    preferred.source = [...new Set([preferred.source, fallback?.source].filter(Boolean))].join("+");
    return preferred;
  };
  const seen = new Map();
  for (const event of events || []) {
    const key = buildEventDedupeKey(event);
    if (!key) continue;
    const current = seen.get(key);
    if (!current) {
      seen.set(key, event);
      continue;
    }

    seen.set(key, mergeEvent(current, event));
  }
  return [...seen.values()];
}

function canonicalMatchTeamKey(name) {
  const raw = normalizeName(name || "");
  let key = canonicalTeamName(raw);
  if (!key) return "";
  const aliasBeforeCleanup = teamAliasLookup.get(key);
  if (aliasBeforeCleanup) key = aliasBeforeCleanup;
  key = key
    .replace(/\b(afc|fc|cf|sc|cd|ac|as|rc|sv|vfl|vfb|bk|fk|ik|if|club de|club|sport club)\b/g, " ")
    .replace(/\b1\s+fc\b/g, " ")
    .replace(/\b&\b/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const aliasAfterCleanup = teamAliasLookup.get(key);
  if (aliasAfterCleanup) return aliasAfterCleanup;
  if (raw && raw !== key) {
    const rawAlias = teamAliasLookup.get(raw);
    if (rawAlias) return rawAlias;
  }
  return key;
}

const LEAGUE_DEDUPE_ALIASES = new Map([
  ["europe uefa europa league", "europe europa league"],
  ["uefa europa league", "europe europa league"],
  ["europa league", "europe europa league"],
  ["europe uefa champions league", "europe champions league"],
  ["uefa champions league", "europe champions league"],
  ["champions league", "europe champions league"],
  ["europe uefa conference league", "europe conference league"],
  ["uefa conference league", "europe conference league"],
  ["conference league", "europe conference league"],
  ["england premier league", "england premier league"],
  ["premier league", "england premier league"],
  ["spain laliga", "spain laliga"],
  ["la liga", "spain laliga"],
  ["italy serie a", "italy serie a"],
  ["serie a", "italy serie a"],
  ["germany bundesliga", "germany bundesliga"],
  ["bundesliga", "germany bundesliga"],
  ["netherlands eredivisie", "netherlands eredivisie"],
  ["eredivisie", "netherlands eredivisie"],
]);

function canonicalLeagueKey(label) {
  const normalized = normalizeName(label || "")
    .replace(/\buefa\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return LEAGUE_DEDUPE_ALIASES.get(normalized) || normalized;
}

function buildEventDedupeKey(event) {
  const kickoff = Number(event?.startTimestamp || 0);
  const dateKey = Number.isFinite(kickoff) && kickoff > 0
    ? toAmsterdamDateKey(new Date(kickoff * 1000))
    : "";
  const league = getLeagueInfo(event)?.label || event?.uniqueTournament?.name || event?.tournament?.name || "";
  const home = canonicalMatchTeamKey(event?.homeTeam?.name || "");
  const away = canonicalMatchTeamKey(event?.awayTeam?.name || "");
  if (!dateKey || !home || !away) return "";
  return `${dateKey}|${canonicalLeagueKey(league)}|${home}|${away}`;
}

function buildStoredMatchDedupeKey(match) {
  const dateKey = String(match?.date || match?.kickoff || "").slice(0, 10);
  const home = canonicalMatchTeamKey(match?.homeTeamName || match?.homeTeam || "");
  const away = canonicalMatchTeamKey(match?.awayTeamName || match?.awayTeam || "");
  if (!dateKey || !home || !away) return "";
  return `${dateKey}|${canonicalLeagueKey(match?.league || "")}|${home}|${away}`;
}

function storedMatchQuality(match) {
  const status = String(match?.status || "").toUpperCase();
  const hasScore = Number.isFinite(Number(match?.homeScore)) && Number.isFinite(Number(match?.awayScore));
  const statusScore =
    status === "FT" ? 70 :
    status === "LIVE" || status === "HT" ? 55 :
    status === "RESULT_PENDING" ? 20 :
    status === "NS" ? 8 :
    0;
  const scoreScore = hasScore ? 35 : 0;
  const logoScore = Number(Boolean(match?.homeLogo)) + Number(Boolean(match?.awayLogo));
  const sourceText = String(match?.dataSource || "");
  const sourceScore =
    /espn/i.test(sourceText) ? 9 :
    /thesportsdb/i.test(sourceText) ? 7 :
    /openligadb/i.test(sourceText) ? 5 :
    /football-data/i.test(sourceText) ? 4 :
    /bbc/i.test(sourceText) ? 2 :
    1;
  return statusScore + scoreScore + logoScore + sourceScore + Number(match?.dataCompletenessScore || 0) * 10;
}

function mergeStoredDuplicateMatch(current, incoming) {
  const incomingPreferred = storedMatchQuality(incoming) > storedMatchQuality(current);
  const preferred = incomingPreferred ? { ...incoming } : { ...current };
  const fallback = incomingPreferred ? current : incoming;

  preferred.homeLogo = preferred.homeLogo || fallback?.homeLogo || "";
  preferred.awayLogo = preferred.awayLogo || fallback?.awayLogo || "";
  preferred.homeTeamId = preferred.homeTeamId || fallback?.homeTeamId || "";
  preferred.awayTeamId = preferred.awayTeamId || fallback?.awayTeamId || "";
  preferred.h2h = Number(preferred?.h2h?.played || 0) >= Number(fallback?.h2h?.played || 0) ? preferred.h2h : fallback?.h2h;
  preferred.homeRecent = preferred.homeRecent || fallback?.homeRecent || null;
  preferred.awayRecent = preferred.awayRecent || fallback?.awayRecent || null;
  preferred.dataSource = [...new Set([preferred.dataSource, fallback?.dataSource].filter(Boolean))].join("+");

  const preferredHasScore = Number.isFinite(Number(preferred.homeScore)) && Number.isFinite(Number(preferred.awayScore));
  const fallbackHasScore = Number.isFinite(Number(fallback?.homeScore)) && Number.isFinite(Number(fallback?.awayScore));
  if (!preferredHasScore && fallbackHasScore) {
    preferred.homeScore = fallback.homeScore;
    preferred.awayScore = fallback.awayScore;
    preferred.score = fallback.score;
    preferred.status = fallback.status || preferred.status;
  }
  return preferred;
}

function dedupeStoredMatches(matches = []) {
  const seen = new Map();
  for (const match of matches || []) {
    const key = buildStoredMatchDedupeKey(match);
    if (!key) continue;
    const current = seen.get(key);
    seen.set(key, current ? mergeStoredDuplicateMatch(current, match) : match);
  }
  return [...seen.values()];
}

function dedupeStoredPredictions(predictions = [], matches = []) {
  const keptMatchIds = new Set(matches.map((match) => String(match?.id || "")).filter(Boolean));
  const byDedupeKey = new Map();
  for (const match of matches) {
    const key = buildStoredMatchDedupeKey(match);
    if (key && match?.id) byDedupeKey.set(key, String(match.id));
  }
  const seen = new Set();
  const output = [];
  for (const prediction of predictions || []) {
    const predictionKey = `${String(prediction?.date || "").slice(0, 10)}|${canonicalLeagueKey(prediction?.league || "")}|${canonicalMatchTeamKey(prediction?.homeTeam || prediction?.homeTeamName || "")}|${canonicalMatchTeamKey(prediction?.awayTeam || prediction?.awayTeamName || "")}`;
    const canonicalMatchId = byDedupeKey.get(predictionKey) || prediction?.matchId;
    if (canonicalMatchId && !keptMatchIds.has(String(canonicalMatchId))) continue;
    const unique = canonicalMatchId || predictionKey || prediction?.matchId;
    if (seen.has(unique)) continue;
    seen.add(unique);
    output.push({ ...prediction, matchId: canonicalMatchId || prediction.matchId });
  }
  return output;
}

function getSportsDbSeasonLabel(dateISO) {
  const base = new Date(`${dateISO}T12:00:00Z`);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  return month >= 6 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}


function fetchCuratedFixtureBackfill(dateISO) {
  return CURATED_FIXTURE_BACKFILL
    .filter((item) => item.date === dateISO)
    .map((item) => {
      const leagueInfo = LEAGUES.find((league) => league.label === item.league) || {
        label: item.league,
        name: item.tournament,
        country: item.country,
        type: item.league.includes("Champions") ? "cup" : "league",
      };
      const kickoffIso = buildFootballDataKickoffIso(dateISO, item.time);
      const id = `curated-${dateISO}-${normalizeName(item.home)}-${normalizeName(item.away)}`;
      return {
        id,
        startTimestamp: Math.floor(new Date(kickoffIso).getTime() / 1000),
        homeTeam: { id: "", name: item.home, country: { name: item.country || leagueInfo.country || "" } },
        awayTeam: { id: "", name: item.away, country: { name: item.country || leagueInfo.country || "" } },
        uniqueTournament: { id: null, name: item.tournament || leagueInfo.name },
        tournament: {
          id: null,
          name: item.tournament || leagueInfo.name,
          category: { name: item.country || leagueInfo.country || "" },
          uniqueTournament: { id: null },
        },
        season: { id: null },
        roundInfo: item.round ? { name: item.round, roundType: item.round } : null,
        status: { type: "notstarted" },
        homeScore: {},
        awayScore: {},
        curatedMeta: {
          sourceNote: item.sourceNote || "curated fixture backfill",
          aggregateLabel: item.aggregateLabel || null,
        },
        source: "curated-fixture-fallback",
      };
    });
}

function applyCuratedResultBackfill(event, dateISO) {
  const result = lookupCuratedResultBackfill(
    CURATED_RESULT_BACKFILL,
    buildPairKey,
    dateISO,
    event?.homeTeam?.name || "",
    event?.awayTeam?.name || ""
  );
  if (!result) return event;

  if (["POSTPONED", "CANCELLED", "ABANDONED"].includes(String(result.status || "").toUpperCase())) {
    return {
      ...event,
      status: {
        ...(event.status || {}),
        type: "cancelled",
        description: String(result.status || "").toUpperCase(),
      },
      resultBackfillMeta: {
        sourceNote: result.sourceNote || "curated fixture status backfill",
      },
      source: `${event.source || "unknown"}+status-backfill`,
    };
  }

  const [homeGoals, awayGoals] = String(result.score || "").split("-").map(Number);
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return event;

  return {
    ...event,
    status: { ...(event.status || {}), type: "finished", description: "FT" },
    homeScore: { ...(event.homeScore || {}), current: homeGoals },
    awayScore: { ...(event.awayScore || {}), current: awayGoals },
    resultBackfillMeta: {
      sourceNote: result.sourceNote || "curated result backfill",
    },
    source: `${event.source || "unknown"}+result-backfill`,
  };
}

function inferPostKickoffStatus(event, appStatus, score, nowMs) {
  if (appStatus !== "NS" || score) return appStatus;
  const kickoffMs = Number(event?.startTimestamp || 0) * 1000;
  if (!Number.isFinite(kickoffMs) || kickoffMs <= 0) return appStatus;
  return nowMs - kickoffMs > 150 * 60 * 1000 ? "RESULT_PENDING" : appStatus;
}

function decodeHtmlText(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

async function fetchSportsDbScheduledEvents(dateISO) {
  const fallbackById = new Map();
  const appendEvent = (event, leagueLabel) => {
    const leagueInfo = LEAGUES.find((item) => item.label === leagueLabel);
    if (!leagueInfo) return;
    const homeName = String(event?.strHomeTeam || "").trim();
    const awayName = String(event?.strAwayTeam || "").trim();
    if (!homeName || !awayName) return;
    if (isWomenContext(leagueLabel, homeName, awayName) || isYouthContext(leagueLabel, homeName, awayName)) return;

    const eventId = `tsdb-${leagueLabel}-${event.idEvent || `${dateISO}-${normalizeName(homeName)}-${normalizeName(awayName)}`}`;

    const kickoff = event?.strTimestamp
      ? new Date(String(event.strTimestamp).replace(" ", "T") + "Z")
      : new Date(buildFootballDataKickoffIso(dateISO, event?.strTimeLocal || event?.strTime));
    const homeGoals = toNumber(event?.intHomeScore);
    const awayGoals = toNumber(event?.intAwayScore);
    const statusText = String(event?.strStatus || "").toLowerCase();
    const rawScoreAvailable = Number.isFinite(homeGoals) && Number.isFinite(awayGoals);
    const finished =
      statusText.includes("finished") ||
      statusText === "ft" ||
      statusText.includes("full time") ||
      (rawScoreAvailable && kickoff.getTime() + 150 * 60 * 1000 < Date.now());
    const statusType = finished
      ? "finished"
      : statusText.includes("half")
        ? "halftime"
        : statusText.includes("live") ||
            statusText.includes("progress") ||
            statusText.includes("1st") ||
            statusText.includes("2nd") ||
            statusText === "1h" ||
            statusText === "2h"
        ? "inprogress"
        : "notstarted";
    const scoreAvailable = rawScoreAvailable && statusType !== "notstarted";

    const mappedEvent = {
      id: eventId,
      startTimestamp: Math.floor(kickoff.getTime() / 1000),
      homeTeam: {
        id: "",
        name: homeName,
        country: { name: leagueInfo.country || "" },
        logoUrl: String(event?.strHomeTeamBadge || ""),
      },
      awayTeam: {
        id: "",
        name: awayName,
        country: { name: leagueInfo.country || "" },
        logoUrl: String(event?.strAwayTeamBadge || ""),
      },
      uniqueTournament: { id: null, name: leagueInfo.name },
      tournament: {
        id: null,
        name: leagueInfo.name,
        category: { name: leagueInfo.country || "" },
        uniqueTournament: { id: null },
      },
      season: { id: null },
      status: {
        type: statusType,
        description: statusType === "halftime" ? "HT" : event?.strStatus || "",
      },
      period: statusType === "halftime" ? "HT" : null,
      homeScore: scoreAvailable ? { current: homeGoals } : {},
      awayScore: scoreAvailable ? { current: awayGoals } : {},
      source: "thesportsdb-fixture-fallback",
    };

    const quality =
      (scoreAvailable ? 20 : 0) +
      (statusType === "finished" ? 12 : statusType === "halftime" ? 8 : statusType === "inprogress" ? 6 : 0) +
      (event?.strTimestamp ? 2 : 0);
    const existing = fallbackById.get(eventId);
    if (!existing || quality > existing.quality) {
      fallbackById.set(eventId, { quality, event: mappedEvent });
    }
  };

  try {
    const response = await fetch(`https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${dateISO}&s=Soccer`, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
      },
    });
    if (response.ok) {
      const json = await response.json();
      for (const event of Array.isArray(json?.events) ? json.events : []) {
        const leagueLabel = SPORTSDB_NAME_TO_LABEL[String(event?.strLeague || "")];
        if (leagueLabel) appendEvent(event, leagueLabel);
      }
    }
  } catch (error) {
    console.warn(`[worker] TheSportsDB eventsday fallback mislukt voor ${dateISO}: ${error?.message || error}`);
  }

  for (const [leagueLabel, leagueId] of Object.entries(SPORTSDB_LEAGUE_IDS)) {
    for (const endpoint of ["eventsnextleague", "eventspastleague"]) {
      try {
        const response = await fetch(`https://www.thesportsdb.com/api/v1/json/123/${endpoint}.php?id=${leagueId}`, {
          headers: {
            Accept: "application/json",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
          },
        });
        if (!response.ok) continue;
        const json = await response.json();
        for (const event of Array.isArray(json?.events) ? json.events : []) {
          if (String(event?.dateEvent || "") !== dateISO) continue;
          appendEvent(event, leagueLabel);
        }
      } catch (error) {
        console.warn(`[worker] TheSportsDB ${endpoint} fallback mislukt voor ${leagueLabel}: ${error?.message || error}`);
      }
    }
  }

  return Array.from(fallbackById.values()).map((item) => item.event);
}

async function fetchOpenLigaDbScheduledEvents(dateISO) {
  const fallbackEvents = [];
  const seen = new Set();

  for (const [leagueKey, leagueLabel] of Object.entries(OPENLIGADB_LEAGUES)) {
    try {
      const response = await fetch(`https://api.openligadb.de/getmatchdata/${leagueKey}`, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
        },
      });
      if (!response.ok) continue;

      const rows = await response.json();
      for (const row of Array.isArray(rows) ? rows : []) {
        const kickoffText = row?.matchDateTime || row?.matchDateTimeUTC || null;
        if (!kickoffText) continue;
        if (toAmsterdamDateKey(kickoffText) !== dateISO) continue;

        const homeName = String(row?.team1?.teamName || row?.team1?.shortName || "").trim();
        const awayName = String(row?.team2?.teamName || row?.team2?.shortName || "").trim();
        if (!homeName || !awayName) continue;
        if (isWomenContext(leagueLabel, homeName, awayName) || isYouthContext(leagueLabel, homeName, awayName)) continue;

        const uniqueKey = `${leagueLabel}|${normalizeName(homeName)}|${normalizeName(awayName)}|${kickoffText}`;
        if (seen.has(uniqueKey)) continue;
        seen.add(uniqueKey);

        const homeGoals = toNumber(row?.matchResults?.[0]?.pointsTeam1);
        const awayGoals = toNumber(row?.matchResults?.[0]?.pointsTeam2);
        const finished = Boolean(row?.matchIsFinished) || (Number.isFinite(homeGoals) && Number.isFinite(awayGoals));

        fallbackEvents.push({
          id: `oldb-${row?.matchID || uniqueKey}`,
          startTimestamp: Math.floor(new Date(kickoffText).getTime() / 1000),
          homeTeam: {
            id: "",
            name: homeName,
            country: { name: leagueLabel.split(" - ")[0] || "" },
            logoUrl: String(row?.team1?.teamIconUrl || ""),
          },
          awayTeam: {
            id: "",
            name: awayName,
            country: { name: leagueLabel.split(" - ")[0] || "" },
            logoUrl: String(row?.team2?.teamIconUrl || ""),
          },
          uniqueTournament: { id: null, name: leagueLabel },
          tournament: {
            id: null,
            name: leagueLabel,
            category: { name: leagueLabel.split(" - ")[0] || "" },
            uniqueTournament: { id: null },
          },
          season: { id: null },
          status: { type: finished ? "finished" : "notstarted" },
          homeScore: Number.isFinite(homeGoals) ? { current: homeGoals } : {},
          awayScore: Number.isFinite(awayGoals) ? { current: awayGoals } : {},
          source: "openligadb-fixture-fallback",
        });
      }
    } catch (error) {
      console.warn(`[worker] OpenLigaDB fallback mislukt voor ${leagueLabel}: ${error?.message || error}`);
    }
  }

  return fallbackEvents;
}

function toNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function pickOdds(row, keys) {
  for (const key of keys) {
    const value = toNumber(row?.[key]);
    if (value && value > 1.01) return value;
  }
  return null;
}

function pickOddsWithMeta(row, closingKeys, openingKeys) {
  for (const key of closingKeys) {
    const value = toNumber(row?.[key]);
    if (value && value > 1.01) return { value, closing: true, key };
  }
  for (const key of openingKeys) {
    const value = toNumber(row?.[key]);
    if (value && value > 1.01) return { value, closing: false, key };
  }
  return { value: null, closing: false, key: null };
}

function extractRefereePenaltyCount(row) {
  const penaltyKeys = [
    "Penalties",
    "pens",
    "PEN",
    "HPen",
    "APen",
    "HomePens",
    "AwayPens",
    "PKH",
    "PKA",
  ];
  for (const key of penaltyKeys) {
    const value = toNumber(row?.[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

const BOOKMAKER_DEFS = [
  {
    key: "PS",
    label: "Pinnacle",
    closing: ["PSCH", "PSCD", "PSCA"],
    opening: ["PSH", "PSD", "PSA"],
  },
  {
    key: "B365",
    label: "Bet365",
    closing: ["B365CH", "B365CD", "B365CA"],
    opening: ["B365H", "B365D", "B365A"],
  },
  {
    key: "BW",
    label: "Bet&Win",
    closing: ["BWCH", "BWCD", "BWCA"],
    opening: ["BWH", "BWD", "BWA"],
  },
  {
    key: "IW",
    label: "Interwetten",
    closing: ["IWCH", "IWCD", "IWCA"],
    opening: ["IWH", "IWD", "IWA"],
  },
  {
    key: "WH",
    label: "William Hill",
    closing: ["WHCH", "WHCD", "WHCA"],
    opening: ["WHH", "WHD", "WHA"],
  },
  {
    key: "VC",
    label: "VC Bet",
    closing: ["VCCH", "VCCD", "VCCA"],
    opening: ["VCH", "VCD", "VCA"],
  },
  {
    key: "Avg",
    label: "Average",
    closing: ["AvgCH", "AvgCD", "AvgCA"],
    opening: ["AvgH", "AvgD", "AvgA"],
  },
  {
    key: "Max",
    label: "Max",
    closing: ["MaxCH", "MaxCD", "MaxCA"],
    opening: ["MaxH", "MaxD", "MaxA"],
  },
];

function buildRefereeAliasVariants(refereeName) {
  const normalized = normalizeName(refereeName);
  if (!normalized) return [];

  const parts = normalized.split(" ").filter(Boolean);
  const aliases = new Set([normalized]);
  const connectors = new Set(["de", "da", "del", "van", "von", "der", "den", "di", "la", "le"]);
  const filteredParts = parts.filter((part) => !connectors.has(part) && part !== "jr" && part !== "sr");
  const effectiveParts = filteredParts.length ? filteredParts : parts;
  const collapsed = effectiveParts.join(" ");
  if (collapsed) aliases.add(collapsed);
  const surname = parts.at(-1) || normalized;
  aliases.add(surname);
  const first = parts[0] || "";
  const firstInitial = first ? first[0] : "";
  const compact = normalized.replace(/\s+/g, "");
  const compactFiltered = collapsed.replace(/\s+/g, "");
  if (compact) aliases.add(compact);
  if (compactFiltered) aliases.add(compactFiltered);

  if (parts.length >= 2) {
    aliases.add(`${parts[0]} ${surname}`);
    aliases.add(`${parts[0][0]} ${surname}`);
    aliases.add(`${parts[0][0]}.${surname}`);
    aliases.add(`${surname} ${parts[0]}`);
    aliases.add(`${surname} ${parts[0][0]}`);
    aliases.add(`${surname} ${parts[0][0]}.`);
    aliases.add(`${parts[0][0]}-${surname}`);
    aliases.add(`${parts[0][0]}${surname}`);
    aliases.add(parts.slice(-2).join(" "));
  }

  if (parts.length >= 3) {
    aliases.add(`${parts[0]} ${parts[1]} ${surname}`);
    aliases.add(`${parts[0][0]} ${parts[1][0]} ${surname}`);
    aliases.add(`${parts[0][0]}.${parts[1][0]}. ${surname}`);
    aliases.add(`${surname} ${parts[0][0]} ${parts[1][0]}`);
  }

  if (effectiveParts.length >= 2) {
    aliases.add(`${effectiveParts[0]} ${effectiveParts.at(-1)}`);
    aliases.add(`${effectiveParts[0][0]} ${effectiveParts.at(-1)}`);
    aliases.add(`${effectiveParts[0][0]}.${effectiveParts.at(-1)}`);
    aliases.add(effectiveParts.slice(-2).join(" "));
    aliases.add(`${effectiveParts.at(-1)} ${effectiveParts[0]}`);
    aliases.add(`${effectiveParts.at(-1)} ${effectiveParts[0][0]}`);
  }

  if (effectiveParts.length >= 3) {
    aliases.add(effectiveParts.slice(-3).join(" "));
    aliases.add(`${effectiveParts.slice(0, -1).join(" ")} ${effectiveParts.at(-1)}`);
    aliases.add(`${effectiveParts[0][0]} ${effectiveParts[1][0]} ${effectiveParts.at(-1)}`);
  }

  if (surname && firstInitial) {
    aliases.add(`${firstInitial}.${surname}`);
    aliases.add(`${firstInitial} ${surname}`);
    aliases.add(`${surname}, ${firstInitial}`);
  }

  return [...aliases].filter(Boolean);
}

function getMarketLeagueFamilyCodes(leagueLabel) {
  const direct = MARKET_LEAGUE_CODES[leagueLabel];
  const countryPrefix = String(leagueLabel || "").split(" - ")[0] || "";
  const codes = new Set();
  if (direct) codes.add(direct);
  if (countryPrefix) {
    for (const [label, code] of Object.entries(MARKET_LEAGUE_CODES)) {
      if (!code) continue;
      if (String(label).startsWith(`${countryPrefix} - `)) codes.add(code);
    }
  }
  return [...codes];
}

function mergeRefereeArchives(profiles) {
  const merged = { referees: {}, refereeAliases: {} };
  for (const profile of profiles || []) {
    for (const [key, value] of Object.entries(profile?.referees || {})) {
      const existing = merged.referees[key];
      if (!existing || Number(value?.matches || 0) > Number(existing?.matches || 0)) {
        merged.referees[key] = value;
      }
    }
    for (const [alias, key] of Object.entries(profile?.refereeAliases || {})) {
      if (!merged.refereeAliases[alias]) merged.refereeAliases[alias] = key;
    }
  }
  return merged;
}

function outcomeFromGoals(homeGoals, awayGoals) {
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
  if (homeGoals > awayGoals) return "H";
  if (homeGoals < awayGoals) return "A";
  return "D";
}

function normalizeProbabilities(home, draw, away) {
  const sum = Number(home || 0) + Number(draw || 0) + Number(away || 0);
  if (!sum) {
    return { home: 0.33, draw: 0.34, away: 0.33 };
  }
  return {
    home: Number((home / sum).toFixed(4)),
    draw: Number((draw / sum).toFixed(4)),
    away: Number((away / sum).toFixed(4)),
  };
}

function buildPairKey(homeTeam, awayTeam) {
  return [normalizeName(homeTeam), normalizeName(awayTeam)].filter(Boolean).sort().join("__");
}

function hashString(value) {
  const text = String(value || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function escapeSvgText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getTeamInitials(name) {
  const words = String(name || "Team")
    .replace(/\b(fc|sc|sv|cf|afc|ac|as|cd|rc|ud|1\.|club|united|city)\b/gi, " ")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  const initials = (words.length >= 2 ? words[0][0] + words[1][0] : (words[0] || "T").slice(0, 2)).toUpperCase();
  return initials || "FC";
}

function createGeneratedTeamLogo(name) {
  const cleanName = String(name || "Team").trim() || "Team";
  const palettes = [
    ["#11244d", "#37d5ff", "#f7c600"],
    ["#141a3a", "#7cf6b2", "#f35b8f"],
    ["#1d2240", "#f8b73e", "#47c7ff"],
    ["#122b25", "#71f6c2", "#f8e25c"],
    ["#251a3d", "#b47cff", "#50e3c2"],
    ["#302018", "#ff8f3d", "#67d5ff"],
  ];
  const [bg, accent, accent2] = palettes[hashString(cleanName) % palettes.length];
  const initials = escapeSvgText(getTeamInitials(cleanName));
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <defs>
        <radialGradient id="g" cx="35%" cy="25%" r="75%">
          <stop offset="0%" stop-color="${accent}" stop-opacity=".85"/>
          <stop offset="48%" stop-color="${bg}"/>
          <stop offset="100%" stop-color="#050914"/>
        </radialGradient>
        <filter id="glow" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <circle cx="64" cy="64" r="59" fill="url(#g)" stroke="${accent}" stroke-width="3"/>
      <path d="M28 42 Q64 18 100 42 L92 94 Q64 112 36 94 Z" fill="none" stroke="${accent2}" stroke-width="4" opacity=".45"/>
      <text x="64" y="76" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="800" fill="#ffffff" filter="url(#glow)">${initials}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}`;
}

function isEspnDataSource(source) {
  return /espn/i.test(String(source || ""));
}

function isSofaScoreDataSource(source) {
  const text = String(source || "");
  return /sofascore|sofa-score/i.test(text) && !isEspnDataSource(text);
}

function isSofaScoreLogoUrl(url) {
  return /api\.sofascore\.(?:app|com)\/api\/v1\/team\/\d+\/image/i.test(String(url || ""));
}

function resolveEspnTeamLogoById(teamId) {
  const id = String(teamId || "").trim();
  if (!/^\d+$/.test(id)) return "";
  return `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`;
}

function resolveTeamLogoUrl(team, teamId, teamName, source) {
  const directLogo = String(team?.logoUrl || team?.logo || team?.logos?.[0]?.href || "").trim();
  if (directLogo) return directLogo;
  if (isEspnDataSource(source)) {
    const espnLogo = resolveEspnTeamLogoById(teamId);
    if (espnLogo) return espnLogo;
  }
  if (isSofaScoreDataSource(source) && teamId && /^\d+$/.test(String(teamId))) {
    return `https://api.sofascore.app/api/v1/team/${teamId}/image`;
  }
  return createGeneratedTeamLogo(team?.name || teamName || "Team");
}

async function repairStoredLogos(store) {
  const logoDeps = {
    espnScoreboardLeagues: ESPN_SCOREBOARD_LEAGUES,
    buildLogoLookupNames,
    normalizeName,
    sleep,
  };
  const days = Object.keys(store.matches || {});
  for (const day of days) {
    const matches = Array.isArray(store.matches?.[day]) ? store.matches[day] : [];
    for (const match of matches) {
      const [homeOfficialLogo, awayOfficialLogo] = await Promise.all([
        resolveEspnTeamLogoByNameSource(match.homeTeamName, logoDeps),
        resolveEspnTeamLogoByNameSource(match.awayTeamName, logoDeps),
      ]);
      const dataSource = String(match.dataSource || match.source || "");
      const homeCurrentLogo = String(match.homeLogo || "").trim();
      const awayCurrentLogo = String(match.awayLogo || "").trim();
      const homeTrustedCurrentLogo = homeCurrentLogo && !(isEspnDataSource(dataSource) && isSofaScoreLogoUrl(homeCurrentLogo))
        ? homeCurrentLogo
        : "";
      const awayTrustedCurrentLogo = awayCurrentLogo && !(isEspnDataSource(dataSource) && isSofaScoreLogoUrl(awayCurrentLogo))
        ? awayCurrentLogo
        : "";
      const homeEspnLogo = isEspnDataSource(dataSource) ? resolveEspnTeamLogoById(match.homeTeamId) : "";
      const awayEspnLogo = isEspnDataSource(dataSource) ? resolveEspnTeamLogoById(match.awayTeamId) : "";
      const homeSofaLogo = isSofaScoreDataSource(dataSource) && match.homeTeamId && /^\d+$/.test(String(match.homeTeamId))
        ? `https://api.sofascore.app/api/v1/team/${match.homeTeamId}/image`
        : "";
      const awaySofaLogo = isSofaScoreDataSource(dataSource) && match.awayTeamId && /^\d+$/.test(String(match.awayTeamId))
        ? `https://api.sofascore.app/api/v1/team/${match.awayTeamId}/image`
        : "";
      match.homeLogo =
        homeEspnLogo || homeOfficialLogo || homeTrustedCurrentLogo || homeSofaLogo || createGeneratedTeamLogo(match.homeTeamName);
      match.awayLogo =
        awayEspnLogo || awayOfficialLogo || awayTrustedCurrentLogo || awaySofaLogo || createGeneratedTeamLogo(match.awayTeamName);
    }
  }
}

function repairStoredPredictionScoreSelections(store) {
  let repaired = 0;
  for (const predictions of Object.values(store.predictions || {})) {
    if (!Array.isArray(predictions)) continue;
    for (const prediction of predictions) {
      const topScore = Object.entries(prediction?.scoreMatrix || {})
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0];
      if (!topScore) continue;
      const [score, probability] = topScore;
      const [homeGoals, awayGoals] = score.split("-").map(Number);
      if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
      const currentScore = `${Number(prediction.predHomeGoals || 0)}-${Number(prediction.predAwayGoals || 0)}`;
      if (currentScore === score) continue;
      prediction.predHomeGoals = homeGoals;
      prediction.predAwayGoals = awayGoals;
      prediction.exactProb = Number(probability || 0);
      if (!prediction.modelEdges || typeof prediction.modelEdges !== "object") prediction.modelEdges = {};
      prediction.modelEdges.scoreSelection = {
        ...(prediction.modelEdges.scoreSelection || {}),
        rawBestScore: score,
        selectedScore: score,
        reason: "hoogste exacte scorematrix-kans",
        repairedFrom: currentScore,
      };
      repaired += 1;
    }
  }
  if (repaired > 0) console.log(`[worker] ${repaired} oude voorspellingen gelijkgetrokken met scorematrix`);
}

function parseHistoricalRowDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const year = Number(slash[3]) < 100 ? 2000 + Number(slash[3]) : Number(slash[3]);
    const iso = `${year}-${String(slash[2]).padStart(2, "0")}-${String(slash[1]).padStart(2, "0")}`;
    return iso;
  }
  const dash = new Date(text);
  if (!Number.isNaN(dash.getTime())) return dash.toISOString().slice(0, 10);
  return null;
}

function h2hCompareKeys(homeName, awayName, homeId, awayId) {
  return {
    home: String(homeId || normalizeName(homeName)),
    away: String(awayId || normalizeName(awayName)),
  };
}

function normalizeH2HWinnerId(item, homeName, awayName, homeId, awayId) {
  const keys = h2hCompareKeys(homeName, awayName, homeId, awayId);
  const winner = String(item?.winnerId || "");
  if (!winner) return "";
  if (winner === String(homeId || "") || winner === normalizeName(homeName)) return keys.home;
  if (winner === String(awayId || "") || winner === normalizeName(awayName)) return keys.away;
  return winner;
}

function summarizeH2HResults(results, homeName, awayName, homeId, awayId, status, sameCompetitionPlayed = 0) {
  const keys = h2hCompareKeys(homeName, awayName, homeId, awayId);
  const asOf =
    (results || []).find((item) => item?.sourceTimestamp || item?.asOf)?.sourceTimestamp ||
    (results || []).find((item) => item?.sourceTimestamp || item?.asOf)?.asOf ||
    new Date().toISOString();
  const normalizedResults = (results || [])
    .map((item) => ({
      ...item,
      winnerId: normalizeH2HWinnerId(item, homeName, awayName, homeId, awayId),
    }))
    .filter((item) => item?.score)
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")))
    .slice(-5);

  return {
    played: normalizedResults.length,
    homeWins: normalizedResults.filter((item) => String(item.winnerId || "") === keys.home).length,
    draws: normalizedResults.filter((item) => !item.winnerId).length,
    awayWins: normalizedResults.filter((item) => String(item.winnerId || "") === keys.away).length,
    sameCompetitionPlayed,
    weightedRecentBalance: calculateRecentH2HBalance({ results: normalizedResults }, keys.home, keys.away),
    results: normalizedResults,
    status: status || "h2h-agent",
    source: status || "h2h-agent",
    asOf,
    sourceTimestamp: asOf,
  };
}

function buildMarketProfiles(rows) {
  const teams = {};
  const referees = {};
  const refereeAliases = {};
  const h2hPairs = {};
  let closingRows = 0;
  let fallbackRows = 0;
  let validRows = 0;

  for (const row of rows || []) {
    const homeTeam = String(row.HomeTeam || row.homeTeam || "").trim();
    const awayTeam = String(row.AwayTeam || row.awayTeam || "").trim();
    const homeGoals = toNumber(row.FTHG);
    const awayGoals = toNumber(row.FTAG);
    const result = String(row.FTR || outcomeFromGoals(homeGoals, awayGoals) || "");
    const homeOddsMeta = pickOddsWithMeta(row, ["PSCH", "AvgCH", "MaxCH", "B365CH"], ["PSH", "AvgH", "MaxH", "B365H"]);
    const drawOddsMeta = pickOddsWithMeta(row, ["PSCD", "AvgCD", "MaxCD", "B365CD"], ["PSD", "AvgD", "MaxD", "B365D"]);
    const awayOddsMeta = pickOddsWithMeta(row, ["PSCA", "AvgCA", "MaxCA", "B365CA"], ["PSA", "AvgA", "MaxA", "B365A"]);
    const homeOdds = homeOddsMeta.value;
    const drawOdds = drawOddsMeta.value;
    const awayOdds = awayOddsMeta.value;

    if (!homeTeam || !awayTeam || !homeOdds || !drawOdds || !awayOdds || !result) continue;

    validRows += 1;
    const usedClosing = [homeOddsMeta, drawOddsMeta, awayOddsMeta].filter((item) => item.closing).length >= 2;
    if (usedClosing) closingRows += 1;
    else fallbackRows += 1;

    const implied = normalizeProbabilities(1 / homeOdds, 1 / drawOdds, 1 / awayOdds);
    const actualHomePoints = result === "H" ? 3 : result === "D" ? 1 : 0;
    const actualAwayPoints = result === "A" ? 3 : result === "D" ? 1 : 0;
    const impliedHomePoints = implied.home * 3 + implied.draw;
    const impliedAwayPoints = implied.away * 3 + implied.draw;

    const homeKey = normalizeName(homeTeam);
    const awayKey = normalizeName(awayTeam);
    if (!teams[homeKey]) {
      teams[homeKey] = {
        teamName: homeTeam,
        homeGames: 0,
        awayGames: 0,
        totalGames: 0,
        homeActualPoints: 0,
        awayActualPoints: 0,
        homeImpliedPoints: 0,
        awayImpliedPoints: 0,
        shotsFor: 0,
        shotsAgainst: 0,
        shotsOnFor: 0,
        shotsOnAgainst: 0,
        cornersFor: 0,
        cornersAgainst: 0,
        yellowCards: 0,
        redCards: 0,
        cleanSheets: 0,
        failedToScore: 0,
        bttsMatches: 0,
        over25Matches: 0,
        statsRows: 0,
        recentMatches: [],
        bookmakers: {},
      };
    }
    if (!teams[awayKey]) {
      teams[awayKey] = {
        teamName: awayTeam,
        homeGames: 0,
        awayGames: 0,
        totalGames: 0,
        homeActualPoints: 0,
        awayActualPoints: 0,
        homeImpliedPoints: 0,
        awayImpliedPoints: 0,
        shotsFor: 0,
        shotsAgainst: 0,
        shotsOnFor: 0,
        shotsOnAgainst: 0,
        cornersFor: 0,
        cornersAgainst: 0,
        yellowCards: 0,
        redCards: 0,
        cleanSheets: 0,
        failedToScore: 0,
        bttsMatches: 0,
        over25Matches: 0,
        statsRows: 0,
        recentMatches: [],
        bookmakers: {},
      };
    }

    teams[homeKey].homeGames += 1;
    teams[homeKey].totalGames += 1;
    teams[homeKey].homeActualPoints += actualHomePoints;
    teams[homeKey].homeImpliedPoints += impliedHomePoints;

    teams[awayKey].awayGames += 1;
    teams[awayKey].totalGames += 1;
    teams[awayKey].awayActualPoints += actualAwayPoints;
    teams[awayKey].awayImpliedPoints += impliedAwayPoints;

    const homeShots = toNumber(row.HS);
    const awayShots = toNumber(row.AS);
    const homeShotsOn = toNumber(row.HST);
    const awayShotsOn = toNumber(row.AST);
    const homeCorners = toNumber(row.HC);
    const awayCorners = toNumber(row.AC);
    const homeYellow = toNumber(row.HY);
    const awayYellow = toNumber(row.AY);
    const homeRed = toNumber(row.HR);
    const awayRed = toNumber(row.AR);
    const hasStats =
      Number.isFinite(homeShots) ||
      Number.isFinite(awayShots) ||
      Number.isFinite(homeShotsOn) ||
      Number.isFinite(awayShotsOn) ||
      Number.isFinite(homeCorners) ||
      Number.isFinite(awayCorners);

    if (hasStats) {
      teams[homeKey].statsRows += 1;
      teams[awayKey].statsRows += 1;
      teams[homeKey].shotsFor += Number(homeShots || 0);
      teams[homeKey].shotsAgainst += Number(awayShots || 0);
      teams[awayKey].shotsFor += Number(awayShots || 0);
      teams[awayKey].shotsAgainst += Number(homeShots || 0);
      teams[homeKey].shotsOnFor += Number(homeShotsOn || 0);
      teams[homeKey].shotsOnAgainst += Number(awayShotsOn || 0);
      teams[awayKey].shotsOnFor += Number(awayShotsOn || 0);
      teams[awayKey].shotsOnAgainst += Number(homeShotsOn || 0);
      teams[homeKey].cornersFor += Number(homeCorners || 0);
      teams[homeKey].cornersAgainst += Number(awayCorners || 0);
      teams[awayKey].cornersFor += Number(awayCorners || 0);
      teams[awayKey].cornersAgainst += Number(homeCorners || 0);
    }

    teams[homeKey].yellowCards += Number(homeYellow || 0);
    teams[awayKey].yellowCards += Number(awayYellow || 0);
    teams[homeKey].redCards += Number(homeRed || 0);
    teams[awayKey].redCards += Number(awayRed || 0);
    if (Number.isFinite(homeGoals) && Number.isFinite(awayGoals)) {
      if (awayGoals === 0) teams[homeKey].cleanSheets += 1;
      if (homeGoals === 0) teams[awayKey].cleanSheets += 1;
      if (homeGoals === 0) teams[homeKey].failedToScore += 1;
      if (awayGoals === 0) teams[awayKey].failedToScore += 1;
      if (homeGoals > 0 && awayGoals > 0) {
        teams[homeKey].bttsMatches += 1;
        teams[awayKey].bttsMatches += 1;
      }
      if (homeGoals + awayGoals > 2.5) {
        teams[homeKey].over25Matches += 1;
        teams[awayKey].over25Matches += 1;
      }

      const rowDate = parseHistoricalRowDate(row.Date);
      teams[homeKey].recentMatches.push({
        date: rowDate,
        league: row.Div || row.League || null,
        venue: "H",
        opponent: awayTeam,
        opponentId: "",
        score: `${homeGoals}-${awayGoals}`,
        goalsFor: homeGoals,
        goalsAgainst: awayGoals,
        result: homeGoals > awayGoals ? "W" : homeGoals === awayGoals ? "D" : "L",
        source: "football-data.co.uk",
      });
      teams[awayKey].recentMatches.push({
        date: rowDate,
        league: row.Div || row.League || null,
        venue: "A",
        opponent: homeTeam,
        opponentId: "",
        score: `${awayGoals}-${homeGoals}`,
        goalsFor: awayGoals,
        goalsAgainst: homeGoals,
        result: awayGoals > homeGoals ? "W" : awayGoals === homeGoals ? "D" : "L",
        source: "football-data.co.uk",
      });
    }

    const pairKey = buildPairKey(homeTeam, awayTeam);
    if (!h2hPairs[pairKey]) h2hPairs[pairKey] = [];
    const winnerId = result === "H" ? homeKey : result === "A" ? awayKey : "";
    h2hPairs[pairKey].push({
      date: parseHistoricalRowDate(row.Date),
      home: homeTeam,
      away: awayTeam,
      homeTeamId: "",
      awayTeamId: "",
      score: Number.isFinite(homeGoals) && Number.isFinite(awayGoals) ? `${homeGoals}-${awayGoals}` : "-",
      winnerId,
      source: "football-data.co.uk",
    });

    for (const bookmaker of BOOKMAKER_DEFS) {
      const homeBookMeta = pickOddsWithMeta(row, [bookmaker.closing[0]], [bookmaker.opening[0]]);
      const drawBookMeta = pickOddsWithMeta(row, [bookmaker.closing[1]], [bookmaker.opening[1]]);
      const awayBookMeta = pickOddsWithMeta(row, [bookmaker.closing[2]], [bookmaker.opening[2]]);
      if (!homeBookMeta.value || !drawBookMeta.value || !awayBookMeta.value) continue;

      const usedBookClosing = [homeBookMeta, drawBookMeta, awayBookMeta].filter((item) => item.closing).length >= 2;
      const bookmakerImplied = normalizeProbabilities(1 / homeBookMeta.value, 1 / drawBookMeta.value, 1 / awayBookMeta.value);

      if (!teams[homeKey].bookmakers[bookmaker.key]) {
        teams[homeKey].bookmakers[bookmaker.key] = {
          bookmaker: bookmaker.label,
          homeGames: 0,
          awayGames: 0,
          homeActualPoints: 0,
          awayActualPoints: 0,
          homeImpliedPoints: 0,
          awayImpliedPoints: 0,
          closingRows: 0,
          fallbackRows: 0,
        };
      }
      if (!teams[awayKey].bookmakers[bookmaker.key]) {
        teams[awayKey].bookmakers[bookmaker.key] = {
          bookmaker: bookmaker.label,
          homeGames: 0,
          awayGames: 0,
          homeActualPoints: 0,
          awayActualPoints: 0,
          homeImpliedPoints: 0,
          awayImpliedPoints: 0,
          closingRows: 0,
          fallbackRows: 0,
        };
      }

      teams[homeKey].bookmakers[bookmaker.key].homeGames += 1;
      teams[homeKey].bookmakers[bookmaker.key].homeActualPoints += actualHomePoints;
      teams[homeKey].bookmakers[bookmaker.key].homeImpliedPoints += bookmakerImplied.home * 3 + bookmakerImplied.draw;
      teams[awayKey].bookmakers[bookmaker.key].awayGames += 1;
      teams[awayKey].bookmakers[bookmaker.key].awayActualPoints += actualAwayPoints;
      teams[awayKey].bookmakers[bookmaker.key].awayImpliedPoints += bookmakerImplied.away * 3 + bookmakerImplied.draw;

      if (usedBookClosing) {
        teams[homeKey].bookmakers[bookmaker.key].closingRows += 1;
        teams[awayKey].bookmakers[bookmaker.key].closingRows += 1;
      } else {
        teams[homeKey].bookmakers[bookmaker.key].fallbackRows += 1;
        teams[awayKey].bookmakers[bookmaker.key].fallbackRows += 1;
      }
    }

    const refereeName = String(row.Referee || row.referee || "").trim();
    if (refereeName) {
      const refereeKey = normalizeName(refereeName);
      const yellowCards = Number(toNumber(row.HY) || 0) + Number(toNumber(row.AY) || 0);
      const redCards = Number(toNumber(row.HR) || 0) + Number(toNumber(row.AR) || 0);
      const totalCards = Number((yellowCards + redCards * 2).toFixed(2));
      const penaltyCount = extractRefereePenaltyCount(row);
      if (!referees[refereeKey]) {
        referees[refereeKey] = {
          refereeName,
          matches: 0,
          yellowCards: 0,
          redCards: 0,
          totalCards: 0,
          penaltyEvents: 0,
          penaltyMatches: 0,
        };
      }
      referees[refereeKey].matches += 1;
      referees[refereeKey].yellowCards += yellowCards;
      referees[refereeKey].redCards += redCards;
      referees[refereeKey].totalCards += totalCards;
      if (penaltyCount != null) {
        referees[refereeKey].penaltyEvents += Number(penaltyCount || 0);
        referees[refereeKey].penaltyMatches += 1;
      }
    }
  }

  const formattedTeams = {};
  for (const [key, value] of Object.entries(teams)) {
    const homeActualPpg = value.homeGames ? value.homeActualPoints / value.homeGames : 0;
    const awayActualPpg = value.awayGames ? value.awayActualPoints / value.awayGames : 0;
    const homeImpliedPpg = value.homeGames ? value.homeImpliedPoints / value.homeGames : 0;
    const awayImpliedPpg = value.awayGames ? value.awayImpliedPoints / value.awayGames : 0;
    const statsRows = Math.max(Number(value.statsRows || 0), 1);
    const games = Math.max(Number(value.totalGames || 0), 1);
    const avgShots = Number((Number(value.shotsFor || 0) / statsRows).toFixed(2));
    const avgShotsAgainst = Number((Number(value.shotsAgainst || 0) / statsRows).toFixed(2));
    const avgShotsOn = Number((Number(value.shotsOnFor || 0) / statsRows).toFixed(2));
    const avgShotsOnAgainst = Number((Number(value.shotsOnAgainst || 0) / statsRows).toFixed(2));
    const avgCorners = Number((Number(value.cornersFor || 0) / statsRows).toFixed(2));
    const avgCornersAgainst = Number((Number(value.cornersAgainst || 0) / statsRows).toFixed(2));
    const dominanceScore = Number(
      (
        (avgShots - avgShotsAgainst) * 0.055 +
        (avgShotsOn - avgShotsOnAgainst) * 0.13 +
        (avgCorners - avgCornersAgainst) * 0.035
      ).toFixed(2)
    );
    formattedTeams[key] = {
      teamName: value.teamName,
      totalGames: value.totalGames,
      homeGames: value.homeGames,
      awayGames: value.awayGames,
      homeActualPpg: Number(homeActualPpg.toFixed(2)),
      awayActualPpg: Number(awayActualPpg.toFixed(2)),
      homeImpliedPpg: Number(homeImpliedPpg.toFixed(2)),
      awayImpliedPpg: Number(awayImpliedPpg.toFixed(2)),
      homeOverperformance: Number((homeActualPpg - homeImpliedPpg).toFixed(2)),
      awayOverperformance: Number((awayActualPpg - awayImpliedPpg).toFixed(2)),
      historicalStats: {
        source: "football-data.co.uk",
        seasons: 5,
        games: Number(value.totalGames || 0),
        statsRows: Number(value.statsRows || 0),
        avgShots,
        avgShotsAgainst,
        avgShotsOn,
        avgShotsOnAgainst,
        avgCorners,
        avgCornersAgainst,
        yellowCardRate: Number((Number(value.yellowCards || 0) / games).toFixed(2)),
        redCardRate: Number((Number(value.redCards || 0) / games).toFixed(2)),
        cleanSheetRate: Number((Number(value.cleanSheets || 0) / games).toFixed(2)),
        failToScoreRate: Number((Number(value.failedToScore || 0) / games).toFixed(2)),
        bttsRate: Number((Number(value.bttsMatches || 0) / games).toFixed(2)),
        over25Rate: Number((Number(value.over25Matches || 0) / games).toFixed(2)),
        dominanceScore,
      },
      recentMatches: (value.recentMatches || [])
        .filter((item) => item?.score)
        .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")))
        .slice(-TEAM_RECENT_MATCH_WINDOW),
      bookmakers: Object.fromEntries(
        Object.entries(value.bookmakers || {}).map(([bookKey, bookValue]) => {
          const bookHomeActualPpg = bookValue.homeGames ? bookValue.homeActualPoints / bookValue.homeGames : 0;
          const bookAwayActualPpg = bookValue.awayGames ? bookValue.awayActualPoints / bookValue.awayGames : 0;
          const bookHomeImpliedPpg = bookValue.homeGames ? bookValue.homeImpliedPoints / bookValue.homeGames : 0;
          const bookAwayImpliedPpg = bookValue.awayGames ? bookValue.awayImpliedPoints / bookValue.awayGames : 0;
          const totalBookRows = Number(bookValue.closingRows || 0) + Number(bookValue.fallbackRows || 0);
          return [
            bookKey,
            {
              bookmaker: bookValue.bookmaker,
              homeGames: Number(bookValue.homeGames || 0),
              awayGames: Number(bookValue.awayGames || 0),
              homeActualPpg: Number(bookHomeActualPpg.toFixed(2)),
              awayActualPpg: Number(bookAwayActualPpg.toFixed(2)),
              homeImpliedPpg: Number(bookHomeImpliedPpg.toFixed(2)),
              awayImpliedPpg: Number(bookAwayImpliedPpg.toFixed(2)),
              homeOverperformance: Number((bookHomeActualPpg - bookHomeImpliedPpg).toFixed(2)),
              awayOverperformance: Number((bookAwayActualPpg - bookAwayImpliedPpg).toFixed(2)),
              closingCoverage: totalBookRows ? Number((Number(bookValue.closingRows || 0) / totalBookRows).toFixed(2)) : 0,
            },
          ];
        })
      ),
    };
  }

  const formattedReferees = {};
  for (const [key, value] of Object.entries(referees)) {
    const matches = Math.max(Number(value.matches || 0), 1);
    const avgCards = Number((Number(value.totalCards || 0) / matches).toFixed(2));
    const redRate = Number((Number(value.redCards || 0) / matches).toFixed(2));
    const penaltyRate =
      Number(value.penaltyMatches || 0) > 0
        ? Number((Number(value.penaltyEvents || 0) / Number(value.penaltyMatches || 1)).toFixed(2))
        : null;
    formattedReferees[key] = {
      refereeName: value.refereeName,
      matches: Number(value.matches || 0),
      avgCards,
      redRate,
      penaltyRate,
      aliases: buildRefereeAliasVariants(value.refereeName),
      summary: `${value.refereeName}: ${avgCards} kaarten gem. over ${value.matches} duels`,
    };
    for (const alias of buildRefereeAliasVariants(value.refereeName)) {
      if (!refereeAliases[alias]) refereeAliases[alias] = key;
    }
  }

  return {
    updatedAt: Date.now(),
    sampleSize: rows.length,
    leagueMeta: {
      validRows,
      closingRows,
      fallbackRows,
      closingCoverage: validRows ? Number((closingRows / validRows).toFixed(2)) : 0,
    },
    teams: formattedTeams,
    referees: formattedReferees,
    refereeAliases,
    h2hPairs: Object.fromEntries(
      Object.entries(h2hPairs).map(([key, values]) => [key, values.sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || ""))).slice(-12)])
    ),
  };
}

async function fetchHistoricalMarketProfile(leagueLabel, dateISO) {
  const codes = getMarketLeagueFamilyCodes(leagueLabel);
  if (!codes.length) return null;

  const seasonFolders = getSeasonFolders(dateISO, 5);
  const allRows = [];
  for (const seasonFolder of seasonFolders) {
    for (const code of codes) {
      const url = `https://www.football-data.co.uk/mmz4281/${seasonFolder}/${code}.csv`;
      const csvText = await fetchText(url);
      if (!csvText) continue;
      const rows = parseCsv(csvText);
      if (rows.length) allRows.push(...rows);
    }
  }
  if (!allRows.length) return null;
  return buildMarketProfiles(allRows);
}

function buildH2HProfileFromResults(results, source) {
  const h2hPairs = {};
  const teams = {};
  for (const item of results || []) {
    const home = String(item.home || "").trim();
    const away = String(item.away || "").trim();
    const homeGoals = toNumber(item.homeGoals);
    const awayGoals = toNumber(item.awayGoals);
    if (!home || !away || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
    const pairKey = buildPairKey(home, away);
    if (!h2hPairs[pairKey]) h2hPairs[pairKey] = [];
    const homeKey = normalizeName(home);
    const awayKey = normalizeName(away);
    const winnerId = homeGoals > awayGoals ? normalizeName(home) : awayGoals > homeGoals ? normalizeName(away) : "";
    h2hPairs[pairKey].push({
      date: item.date || null,
      home,
      away,
      homeTeamId: "",
      awayTeamId: "",
      score: `${homeGoals}-${awayGoals}`,
      winnerId,
      source,
    });

    if (!teams[homeKey]) teams[homeKey] = { teamName: home, recentMatches: [] };
    if (!teams[awayKey]) teams[awayKey] = { teamName: away, recentMatches: [] };
    teams[homeKey].recentMatches.push({
      date: item.date || null,
      league: item.league || null,
      venue: "H",
      opponent: away,
      opponentId: "",
      score: `${homeGoals}-${awayGoals}`,
      goalsFor: homeGoals,
      goalsAgainst: awayGoals,
      result: homeGoals > awayGoals ? "W" : homeGoals === awayGoals ? "D" : "L",
      source,
    });
    teams[awayKey].recentMatches.push({
      date: item.date || null,
      league: item.league || null,
      venue: "A",
      opponent: home,
      opponentId: "",
      score: `${awayGoals}-${homeGoals}`,
      goalsFor: awayGoals,
      goalsAgainst: homeGoals,
      result: awayGoals > homeGoals ? "W" : awayGoals === homeGoals ? "D" : "L",
      source,
    });
  }

  return {
    updatedAt: Date.now(),
    source,
    sampleSize: results.length,
    teams: Object.fromEntries(
      Object.entries(teams).map(([key, value]) => [
        key,
        {
          teamName: value.teamName,
          recentMatches: value.recentMatches
            .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")))
            .slice(-TEAM_RECENT_MATCH_WINDOW),
        },
      ])
    ),
    h2hPairs: Object.fromEntries(
      Object.entries(h2hPairs).map(([key, values]) => [
        key,
        values.sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || ""))).slice(-16),
      ])
    ),
  };
}

function lookupSnapshotTeam(snapshot, teamName) {
  const teams = snapshot?.teams || {};
  for (const variant of buildPossibleNames(teamName)) {
    if (teams[variant]) return teams[variant];
  }
  return null;
}

function mergeSeasonStatsWithSnapshots(baseStats, teamName, leagueLabel, store) {
  const understat = lookupSnapshotTeam(store.understatSnapshots?.[leagueLabel], teamName);
  const fbref = lookupSnapshotTeam(store.fbrefSnapshots?.[leagueLabel], teamName);
  const marketTeam = lookupMarketTeamProfile(store.marketProfiles?.[leagueLabel], teamName);
  const historicalStats = marketTeam?.historicalStats || null;
  const externalSources = [];
  const merged = { ...(baseStats || {}) };

  if (historicalStats && Number(historicalStats.statsRows || 0) >= 8) {
    externalSources.push("football-data-history");
    merged.avgShots = merged.avgShots ?? historicalStats.avgShots ?? null;
    merged.avgShotsAgainst = merged.avgShotsAgainst ?? historicalStats.avgShotsAgainst ?? null;
    merged.avgShotsOn = merged.avgShotsOn ?? historicalStats.avgShotsOn ?? null;
    merged.avgShotsOnAgainst = merged.avgShotsOnAgainst ?? historicalStats.avgShotsOnAgainst ?? null;
    merged.avgCorners = merged.avgCorners ?? historicalStats.avgCorners ?? null;
    merged.avgCornersAgainst = merged.avgCornersAgainst ?? historicalStats.avgCornersAgainst ?? null;
    merged.cleanSheetRate = merged.cleanSheetRate ?? historicalStats.cleanSheetRate ?? null;
    merged.failToScoreRate = merged.failToScoreRate ?? historicalStats.failToScoreRate ?? null;
    merged.bttsRate = merged.bttsRate ?? historicalStats.bttsRate ?? null;
    merged.over25Rate = merged.over25Rate ?? historicalStats.over25Rate ?? null;
    merged.yellowCardRate = merged.yellowCardRate ?? historicalStats.yellowCardRate ?? null;
    merged.redCardRate = merged.redCardRate ?? historicalStats.redCardRate ?? null;
    merged.dominanceScore = merged.dominanceScore ?? historicalStats.dominanceScore ?? null;
    merged.historicalGames = historicalStats.games ?? merged.historicalGames ?? null;
  }

  if (understat) {
    externalSources.push("Understat");
    merged.xG = understat.avgXG ?? merged.xG ?? null;
    merged.xGAgainst = understat.avgXGA ?? merged.xGAgainst ?? null;
    merged.npxG = understat.avgNpxG ?? merged.npxG ?? null;
    merged.npxGAgainst = understat.avgNpxGA ?? merged.npxGAgainst ?? null;
    merged.homeXG = understat.homeXG ?? merged.homeXG ?? null;
    merged.awayXG = understat.awayXG ?? merged.awayXG ?? null;
    merged.homeXGA = understat.homeXGA ?? merged.homeXGA ?? null;
    merged.awayXGA = understat.awayXGA ?? merged.awayXGA ?? null;
    merged.ppda = understat.ppda ?? merged.ppda ?? null;
    merged.deep = understat.deep ?? merged.deep ?? null;
  }

  if (fbref) {
    externalSources.push("FBref");
    merged.avgShots = merged.avgShots ?? fbref.avgShots ?? null;
    merged.avgShotsOn = merged.avgShotsOn ?? fbref.avgShotsOn ?? null;
    merged.xG = merged.xG ?? fbref.avgXG ?? null;
    merged.npxG = merged.npxG ?? fbref.avgNpxG ?? null;
    merged.homeShots = fbref.homeShots ?? merged.homeShots ?? null;
    merged.awayShots = fbref.awayShots ?? merged.awayShots ?? null;
    merged.homeXG = merged.homeXG ?? fbref.homeXG ?? null;
    merged.awayXG = merged.awayXG ?? fbref.awayXG ?? null;
  }

  if (externalSources.length) {
    merged.externalSources = Array.from(new Set([...(merged.externalSources || []), ...externalSources]));
    merged.sourceQuality = Number(Math.min(1, 0.42 + merged.externalSources.length * 0.18 + Math.min(Number(merged.historicalGames || 0) / 120, 1) * 0.12).toFixed(2));
  }

  return Object.keys(merged).length ? merged : null;
}

function lookupHistoricalH2HBackfill(leagueMarketProfile, homeName, awayName, currentHomeId, currentAwayId) {
  const pairs = leagueMarketProfile?.h2hPairs || {};
  const homeVariants = buildPossibleNames(homeName);
  const awayVariants = buildPossibleNames(awayName);
  let raw = [];
  for (const homeVariant of homeVariants) {
    for (const awayVariant of awayVariants) {
      const variantKey = buildPairKey(homeVariant, awayVariant);
      if (Array.isArray(pairs[variantKey]) && pairs[variantKey].length) {
        raw = pairs[variantKey];
        break;
      }
    }
    if (raw.length) break;
  }
  const homeWinnerId = String(currentHomeId || normalizeName(homeName));
  const awayWinnerId = String(currentAwayId || normalizeName(awayName));
  const results = raw
    .map((item) => ({
      ...item,
      homeTeamId: item.homeTeamId || "",
      awayTeamId: item.awayTeamId || "",
      winnerId:
        homeVariants.includes(String(item.winnerId || ""))
          ? homeWinnerId
          : awayVariants.includes(String(item.winnerId || ""))
            ? awayWinnerId
            : "",
    }))
    .slice(-5);

  if (!results.length) return null;

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  for (const result of results) {
    if (!result.winnerId) draws += 1;
    else if (String(result.winnerId) === String(currentHomeId || "")) homeWins += 1;
    else if (String(result.winnerId) === String(currentAwayId || "")) awayWins += 1;
  }

  return {
    played: results.length,
    homeWins,
    draws,
    awayWins,
    sameCompetitionPlayed: results.length,
    weightedRecentBalance: calculateRecentH2HBalance({ results }, currentHomeId, currentAwayId),
    results,
    status: leagueMarketProfile?.source === "openfootball" ? "openfootball-historical" : "historical-competition",
  };
}

function orientHistoricalScore(item, homeName, awayName) {
  const scoreParts = String(item?.score || "").split("-").map(Number);
  if (scoreParts.length !== 2 || !scoreParts.every(Number.isFinite)) return null;
  const homeVariants = new Set(buildPossibleNames(homeName));
  const awayVariants = new Set(buildPossibleNames(awayName));
  const itemHome = normalizeName(item?.home || item?.homeTeam || "");
  const itemAway = normalizeName(item?.away || item?.awayTeam || "");
  if (homeVariants.has(itemHome) && awayVariants.has(itemAway)) {
    return { homeScore: scoreParts[0], awayScore: scoreParts[1], score: `${scoreParts[0]}-${scoreParts[1]}` };
  }
  if (homeVariants.has(itemAway) && awayVariants.has(itemHome)) {
    return { homeScore: scoreParts[1], awayScore: scoreParts[0], score: `${scoreParts[1]}-${scoreParts[0]}` };
  }
  return null;
}

function lookupStoredMatchH2HBackfill(store, match, dateKey) {
  if (!store || !match || !dateKey) return null;
  const homeName = match.homeTeamName || match.homeTeam;
  const awayName = match.awayTeamName || match.awayTeam;
  const homeVariants = new Set(buildPossibleNames(homeName));
  const awayVariants = new Set(buildPossibleNames(awayName));
  const results = [];
  for (const [storedDate, matches] of Object.entries(store.matches || {})) {
    if (String(storedDate || "") >= String(dateKey || "")) continue;
    for (const candidate of matches || []) {
      if (!matchHasFinalScore(candidate)) continue;
      const candidateHome = normalizeName(candidate.homeTeamName || candidate.homeTeam || "");
      const candidateAway = normalizeName(candidate.awayTeamName || candidate.awayTeam || "");
      const sameOrder = homeVariants.has(candidateHome) && awayVariants.has(candidateAway);
      const reversed = homeVariants.has(candidateAway) && awayVariants.has(candidateHome);
      if (!sameOrder && !reversed) continue;
      const score = String(candidate.score || `${candidate.homeScore}-${candidate.awayScore}`);
      const [homeScore, awayScore] = score.split("-").map(Number);
      if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;
      const winnerId =
        homeScore === awayScore
          ? ""
          : (sameOrder ? homeScore > awayScore : awayScore > homeScore)
            ? String(match.homeTeamId || normalizeName(homeName))
            : String(match.awayTeamId || normalizeName(awayName));
      results.push({
        date: String(storedDate || candidate.date || "").slice(0, 10),
        home: sameOrder ? homeName : awayName,
        away: sameOrder ? awayName : homeName,
        score: sameOrder ? `${homeScore}-${awayScore}` : `${awayScore}-${homeScore}`,
        homeTeamId: sameOrder ? match.homeTeamId || "" : match.awayTeamId || "",
        awayTeamId: sameOrder ? match.awayTeamId || "" : match.homeTeamId || "",
        winnerId,
        source: candidate.resultBackfillSource || candidate.source || "stored-match-history",
        sourceTimestamp: candidate.sourceAsOf?.result || candidate.sourceAsOf?.fixture || isoFromMs(Date.now()),
      });
    }
  }
  if (!results.length) return null;
  return summarizeH2HResults(
    results.slice(-5),
    homeName,
    awayName,
    match.homeTeamId,
    match.awayTeamId,
    "stored-match-history",
    results.length
  );
}

function lookupMarketTeamProfile(leagueMarketProfile, teamName) {
  const teams = leagueMarketProfile?.teams || {};
  for (const variant of buildPossibleNames(teamName)) {
    if (teams[variant]) return teams[variant];
  }
  return null;
}

function lookupHistoricalRefereeProfile(leagueMarketProfile, refereeName, globalArchive = null) {
  if (!refereeName) return null;
  const referees = leagueMarketProfile?.referees || {};
  const aliasMap = leagueMarketProfile?.refereeAliases || {};
  const globalReferees = globalArchive?.referees || {};
  const globalAliasMap = globalArchive?.refereeAliases || {};
  const normalizedRef = normalizeName(refereeName);
  const aliasHit = aliasMap[normalizedRef];
  if (aliasHit && referees[aliasHit]) return referees[aliasHit];
  const direct = referees[normalizedRef];
  if (direct) return direct;
  const globalAliasHit = globalAliasMap[normalizedRef];
  if (globalAliasHit && globalReferees[globalAliasHit]) return globalReferees[globalAliasHit];
  if (globalReferees[normalizedRef]) return globalReferees[normalizedRef];
  const aliases = buildRefereeAliasVariants(refereeName);
  for (const alias of aliases) {
    const aliasKey = aliasMap[alias];
    if (aliasKey && referees[aliasKey]) return referees[aliasKey];
    const globalKey = globalAliasMap[alias];
    if (globalKey && globalReferees[globalKey]) return globalReferees[globalKey];
  }
  const surname = normalizedRef.split(" ").filter(Boolean).slice(-1)[0] || normalizedRef;
  return (
    [...Object.values(referees), ...Object.values(globalReferees)].find((entry) => {
      const candidate = normalizeName(entry?.refereeName || "");
      if (candidate === normalizedRef) return true;
      if (!surname) return false;
      const candidateAliases = Array.isArray(entry?.aliases) ? entry.aliases : buildRefereeAliasVariants(entry?.refereeName || "");
      const candidateSurname = candidate.split(" ").filter(Boolean).slice(-1)[0] || candidate;
      return (
        candidate.includes(normalizedRef) ||
        normalizedRef.includes(candidate) ||
        candidateSurname === surname ||
        candidateAliases.some((alias) => aliases.includes(alias))
      );
    }) || null
  );
}

function flattenOddsContainers(node, bucket = []) {
  if (!node) return bucket;
  if (Array.isArray(node)) {
    for (const item of node) flattenOddsContainers(item, bucket);
    return bucket;
  }
  if (typeof node !== "object") return bucket;

  const maybeHome = Number(node.home || node.homeOdds || node.homeValue || node.oddsHome || node.choice1?.value || 0);
  const maybeDraw = Number(node.draw || node.drawOdds || node.drawValue || node.oddsDraw || node.choiceX?.value || 0);
  const maybeAway = Number(node.away || node.awayOdds || node.awayValue || node.oddsAway || node.choice2?.value || 0);
  const bookmaker =
    node.bookmaker?.name ||
    node.bookmakerName ||
    node.provider ||
    node.name ||
    node.marketName ||
    "";

  if (maybeHome > 1.01 && maybeDraw > 1.01 && maybeAway > 1.01) {
    bucket.push({
      bookmaker: String(bookmaker || "Sofascore"),
      home: maybeHome,
      draw: maybeDraw,
      away: maybeAway,
    });
  }

  for (const value of Object.values(node)) flattenOddsContainers(value, bucket);
  return bucket;
}

async function fetchEventBookmakerOdds(eventId) {
  const urls = [
    `${SOFA}/event/${eventId}/odds/1/all`,
    `${SOFA}/event/${eventId}/odds/1`,
    `${SOFA}/event/${eventId}/odds`,
  ];

  for (const url of urls) {
    const json = await safeFetch(url);
    const rows = flattenOddsContainers(json, []);
    if (!rows.length) continue;

    const byBook = {};
    for (const row of rows) {
      const key = normalizeName(row.bookmaker);
      if (!key || byBook[key]) continue;
      byBook[key] = row;
    }

    const signals = Object.values(byBook).slice(0, 8).map((row) => {
      const implied = normalizeProbabilities(1 / row.home, 1 / row.draw, 1 / row.away);
      const lean = implied.home >= implied.away && implied.home >= implied.draw ? "home" : implied.away >= implied.draw ? "away" : "neutral";
      return {
        key: normalizeName(row.bookmaker),
        bookmaker: row.bookmaker,
        diff: Number((implied.home - implied.away).toFixed(2)),
        strength: Number((Math.max(implied.home, implied.draw, implied.away) * 0.9).toFixed(2)),
        closingCoverage: 1,
        lean,
        source: "sofascore-odds",
      };
    });

    return {
      source: "Sofascore current odds",
      bookmakerSignals: signals,
      bookmakerAgreement:
        signals.length > 0
          ? Number((signals.filter((item) => item.lean === "home" || item.lean === "away").length / signals.length).toFixed(2))
          : 0,
      closingCoverage: signals.length > 0 ? 1 : 0,
    };
  }

  return null;
}

async function fetchTransfermarktNationalTeamAvailability(teamName) {
  const query = encodeURIComponent(teamName);
  const searchUrl = `https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query=${query}`;
  const searchText = await safeFetchText(searchUrl);
  if (!searchText) return null;

  const teamPattern = /href="\/([^"/]+)\/startseite\/verein\/(\d+)"[^>]*>([^<]+)</gi;
  let match = null;
  let candidate = null;
  const normalizedQuery = normalizeName(teamName);
  while ((match = teamPattern.exec(searchText))) {
    const name = String(match[3] || "").trim();
    const normalizedName = normalizeName(name);
    if (!normalizedName) continue;
    if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) {
      candidate = { slug: match[1], id: match[2], name };
      break;
    }
  }
  if (!candidate) return null;

  const availabilityUrl = `https://www.transfermarkt.com/${candidate.slug}/sperrenundverletzungen/verein/${candidate.id}`;
  const html = await safeFetchText(availabilityUrl);
  if (!html) return null;

  const names = [...html.matchAll(/spielerprofil[^>]*>([^<]+)</gi)].map((item) => String(item[1] || "").trim()).filter(Boolean);
  const suspensionHits = [...html.matchAll(/sperre|suspended|suspension/gi)].length;
  const injuryHits = [...html.matchAll(/verletz|injur|knock|muscular|ankle|illness/gi)].length;
  const doubtHits = [...html.matchAll(/fraglich|doubt|questionable/gi)].length;

  if (!injuryHits && !suspensionHits && !doubtHits) return null;

  return {
    injuredCount: Math.min(injuryHits, Math.max(names.length, injuryHits)),
    suspendedCount: suspensionHits,
    doubtsCount: doubtHits,
    source: "Transfermarkt availability",
    keyPlayersMissing: names.slice(0, 4),
    suspendedPlayers: names.slice(0, Math.min(3, suspensionHits || 0)),
  };
}

function mergeAvailability(baseAvailability, extraAvailability) {
  if (!extraAvailability) return baseAvailability;
  return {
    ...baseAvailability,
    injuredCount: Math.max(Number(baseAvailability?.injuredCount || 0), Number(extraAvailability?.injuredCount || 0)),
    suspendedCount: Math.max(Number(baseAvailability?.suspendedCount || 0), Number(extraAvailability?.suspendedCount || 0)),
    doubtsCount: Math.max(Number(baseAvailability?.doubtsCount || 0), Number(extraAvailability?.doubtsCount || 0)),
    injuredRating: Number(baseAvailability?.injuredRating || 0),
    keyPlayersMissing: [...new Set([...(baseAvailability?.keyPlayersMissing || []), ...(extraAvailability?.keyPlayersMissing || [])])].slice(0, 5),
    suspendedPlayers: [...new Set([...(baseAvailability?.suspendedPlayers || []), ...(extraAvailability?.suspendedPlayers || [])])].slice(0, 4),
    source: extraAvailability?.source || baseAvailability?.source || "Sofascore players",
  };
}

function getPredictedOutcome(prediction) {
  const homeProb = Number(prediction?.homeProb || 0);
  const drawProb = Number(prediction?.drawProb || 0);
  const awayProb = Number(prediction?.awayProb || 0);
  if (homeProb >= drawProb && homeProb >= awayProb) return "H";
  if (awayProb >= drawProb && awayProb >= homeProb) return "A";
  return "D";
}

function buildPostMatchReview(match, prediction) {
  if (String(match?.status || "").toUpperCase() !== "FT" || !String(match?.score || "").includes("-")) return null;
  if (!prediction) return null;

  const [actualHomeGoals, actualAwayGoals] = String(match.score).split("-").map(Number);
  if (!Number.isFinite(actualHomeGoals) || !Number.isFinite(actualAwayGoals)) return null;

  const predHomeGoals = Number(prediction.predHomeGoals || 0);
  const predAwayGoals = Number(prediction.predAwayGoals || 0);
  const predictedOutcome = outcomeFromGoals(predHomeGoals, predAwayGoals);
  const probabilityOutcome = getPredictedOutcome(prediction);
  const actualOutcome = outcomeFromGoals(actualHomeGoals, actualAwayGoals);
  const totalGoalError = Math.abs(predHomeGoals - actualHomeGoals) + Math.abs(predAwayGoals - actualAwayGoals);
  const predictedTotalGoals = predHomeGoals + predAwayGoals;
  const actualTotalGoals = actualHomeGoals + actualAwayGoals;
  const predictedBtts =
    prediction?.btts != null ? Number(prediction.btts) >= 0.5 : predHomeGoals > 0 && predAwayGoals > 0;
  const actualBtts = actualHomeGoals > 0 && actualAwayGoals > 0;
  const predictedOver25 =
    prediction?.over25 != null ? Number(prediction.over25) >= 0.5 : predictedTotalGoals >= 3;
  const actualOver25 = actualTotalGoals >= 3;
  const totalGoalBias = Number(
    ((actualHomeGoals + actualAwayGoals) - (predHomeGoals + predAwayGoals)).toFixed(2)
  );
  const oddsDiagnostics = normalizeOddsAtPrediction(prediction);
  const brierScore = calculateBrierScore(prediction, actualOutcome);
  const logLoss = calculateLogLoss(prediction, actualOutcome);
  const roi = calculateRoi({ ...prediction, oddsAtPrediction: oddsDiagnostics.oddsAtPrediction }, probabilityOutcome, actualOutcome);
  const clv = prediction?.clv ?? calculateClv({ ...prediction, oddsAtPrediction: oddsDiagnostics.oddsAtPrediction }, probabilityOutcome);
  const leakageGuard = prediction?.leakageGuard || buildLeakageGuard(match, prediction, {
    generatedAt: prediction?.generatedAt || null,
    cutoffAt: prediction?.cutoffAt || prediction?.generatedAt || null,
    snapshotBacked: prediction?.evaluationSource === "prediction_snapshot",
    snapshotStatus: prediction?.evaluationSource === "prediction_snapshot" ? "pre_match" : "fallback",
    featureSourceMetadata: prediction?.featureSourceMetadata || null,
  });

  const failureSignals = [];
  if (predictedOutcome !== actualOutcome) {
    if (Math.abs(Number(prediction?.modelEdges?.clubEloDiff || 0)) >= 80) failureSignals.push("clubelo_misread");
    if (!prediction?.modelEdges?.lineupConfirmed) failureSignals.push("open_lineups");
    if (prediction?.weatherRisk === "high" || prediction?.modelEdges?.weatherRisk === "high") failureSignals.push("weather_risk");
    if (Math.abs(Number(prediction?.modelEdges?.rest || 0)) >= 2) failureSignals.push("rest_gap");
    if (match?.h2h?.results?.length >= 3) failureSignals.push("h2h_signal");
    if (Math.abs(Number(prediction?.modelEdges?.marketCalibration?.overperformanceDiff || 0)) >= 0.45) failureSignals.push("market_misread");
    if (Number(prediction?.modelEdges?.modelAgreement || 0) < 0.45) failureSignals.push("low_model_agreement");
  }

  return {
    matchId: match.id,
    predictionId: prediction.predictionId || null,
    date: match.date,
    league: match.league,
    dataSource: match.dataSource || prediction?.dataSource || "sofascore",
    phaseBucket: getReliabilityBucket(match),
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    homeTeamName: match.homeTeamName,
    awayTeamName: match.awayTeamName,
    predictedScore: `${predHomeGoals}-${predAwayGoals}`,
    actualScore: match.score,
    predictedOutcome,
    probabilityOutcome,
    actualOutcome,
    predictedBtts,
    actualBtts,
    bttsHit: predictedBtts === actualBtts,
    predictedOver25,
    actualOver25,
    over25Hit: predictedOver25 === actualOver25,
    predictedTotalGoals,
    actualTotalGoals,
    modelName: prediction?.modelEdges?.model || prediction?.modelEdges?.modelName || prediction?.modelLabel || "ensemble",
    riskProfile: prediction?.modelEdges?.riskProfile || prediction?.riskProfile || "unknown",
    modelAgreement: Number(prediction?.modelEdges?.modelAgreement || 0),
    confidence: Number(prediction.confidence || 0),
    exactScoreConfidence: Number(prediction.exactScoreConfidence || prediction.exactProb || 0),
    brierScore,
    logLoss,
    roi,
    roiStatus: roi == null ? "odds_missing" : "settled",
    clv,
    clvStatus: clv == null ? "closing_odds_missing" : "settled",
    oddsAtPrediction: oddsDiagnostics.oddsAtPrediction,
    oddsStatus: oddsDiagnostics.oddsStatus,
    oddsMissingReason: oddsDiagnostics.oddsMissingReason,
    featureSourceMetadata: prediction?.featureSourceMetadata || null,
    featureImportance: prediction?.featureImportance || prediction?.modelEdges?.featureImportance || [],
    sourceReliability: prediction?.modelEdges?.sourceReliability || null,
    qualityGate: prediction?.qualityGate || prediction?.modelEdges?.qualityGate || null,
    leagueCalibration: prediction?.modelEdges?.leagueCalibration || null,
    sourceTimestampCoverage: prediction?.featureSourceMetadata?.coverage?.timestampCoverage ?? null,
    modelVersion: prediction?.modelVersion || prediction?.ensembleMeta?.baseModel || null,
    featureSchemaVersion: prediction?.featureSchemaVersion || null,
    generatedAt: prediction?.generatedAt || null,
    cutoffAt: prediction?.cutoffAt || null,
    inputSnapshotHash: prediction?.inputSnapshotHash || null,
    evaluationSource: prediction?.evaluationSource || "current_prediction",
    leakageRisk: prediction?.leakageRisk || null,
    leakageGuard,
    outcomeHit: predictedOutcome === actualOutcome,
    probabilityOutcomeHit: probabilityOutcome === actualOutcome,
    exactHit: predHomeGoals === actualHomeGoals && predAwayGoals === actualAwayGoals,
    totalGoalError,
    totalGoalBias,
    homeGoalBias: Number((actualHomeGoals - predHomeGoals).toFixed(2)),
    awayGoalBias: Number((actualAwayGoals - predAwayGoals).toFixed(2)),
    bestBetRank: Number(prediction?.bestBetRank || 0) || null,
    topConfidencePick: Number(prediction?.bestBetRank || 0) > 0 && Number(prediction?.bestBetRank || 0) <= 5,
    topExactScorePick: Number(prediction?.bestBetRank || 0) > 0 && Number(prediction?.bestBetRank || 0) <= 5,
    topExactReasons: prediction?.exactScoreReasons || [],
    failureSignals,
    createdAt: Date.now(),
  };
}

function buildTeamLearningFromReviews(reviews) {
  const learning = {};

  function ensureTeam(teamId, teamName) {
    const key = teamId ? `id:${teamId}` : `name:${normalizeName(teamName)}`;
    if (!learning[key]) {
      learning[key] = {
        teamId: teamId || "",
        teamName: teamName || "Unknown",
        reviewedMatches: 0,
        outcomeHits: 0,
        exactHits: 0,
        totalGoalError: 0,
        homeGoalBias: 0,
        awayGoalBias: 0,
        overvaluedHome: 0,
        overvaluedAway: 0,
        undervaluedHome: 0,
        undervaluedAway: 0,
        openLineupMisses: 0,
        weatherMisses: 0,
        h2hMisses: 0,
      };
    }
    return learning[key];
  }

  for (const review of Object.values(reviews || {})) {
    const home = ensureTeam(review.homeTeamId, review.homeTeamName);
    const away = ensureTeam(review.awayTeamId, review.awayTeamName);

    for (const team of [home, away]) {
      team.reviewedMatches += 1;
      if (review.outcomeHit) team.outcomeHits += 1;
      if (review.exactHit) team.exactHits += 1;
      team.totalGoalError += Number(review.totalGoalError || 0);
    }

    home.homeGoalBias += Number(review.homeGoalBias || 0);
    away.awayGoalBias += Number(review.awayGoalBias || 0);

    if (review.predictedOutcome === "H" && review.actualOutcome !== "H") home.overvaluedHome += 1;
    if (review.predictedOutcome !== "H" && review.actualOutcome === "H") home.undervaluedHome += 1;
    if (review.predictedOutcome === "A" && review.actualOutcome !== "A") away.overvaluedAway += 1;
    if (review.predictedOutcome !== "A" && review.actualOutcome === "A") away.undervaluedAway += 1;

    if ((review.failureSignals || []).includes("open_lineups")) {
      home.openLineupMisses += 1;
      away.openLineupMisses += 1;
    }
    if ((review.failureSignals || []).includes("weather_risk")) {
      home.weatherMisses += 1;
      away.weatherMisses += 1;
    }
    if ((review.failureSignals || []).includes("h2h_signal")) {
      home.h2hMisses += 1;
      away.h2hMisses += 1;
    }
  }

  for (const team of Object.values(learning)) {
    const games = Math.max(Number(team.reviewedMatches || 0), 1);
    team.outcomeHitRate = Number((team.outcomeHits / games).toFixed(2));
    team.exactHitRate = Number((team.exactHits / games).toFixed(2));
    team.avgGoalError = Number((team.totalGoalError / games).toFixed(2));
    team.homeGoalBias = Number((team.homeGoalBias / games).toFixed(2));
    team.awayGoalBias = Number((team.awayGoalBias / games).toFixed(2));
    team.homeOutcomeBias = Number(((team.undervaluedHome - team.overvaluedHome) / games).toFixed(2));
    team.awayOutcomeBias = Number(((team.undervaluedAway - team.overvaluedAway) / games).toFixed(2));
    team.summary =
      team.reviewedMatches >= 3
        ? `${team.teamName}: hitrate ${Math.round(team.outcomeHitRate * 100)}%, goal error ${team.avgGoalError}, home bias ${team.homeOutcomeBias}, away bias ${team.awayOutcomeBias}`
        : `${team.teamName}: nog te weinig reviewdata`;
  }

  return learning;
}

function rebuildReviewsAndLearning(store) {
  const reviews = { ...(store.postMatchReviews || {}) };

  for (const date of Object.keys(store.matches || {})) {
    const matches = store.matches?.[date] || [];
    const predictions = Object.fromEntries(
      (store.predictions?.[date] || []).map((prediction) => [prediction.matchId, prediction])
    );

    for (const match of matches) {
      const reviewPrediction = selectPredictionForReview(store, match, predictions[match.id]);
      const review = buildPostMatchReview(match, reviewPrediction);
      if (review) reviews[match.id] = review;
    }
  }

  store.postMatchReviews = reviews;
  store.teamLearning = buildTeamLearningFromReviews(reviews);
  store.leagueReliability = buildLeagueReliabilityFromReviews(reviews);
  store.phaseReliability = buildPhaseReliabilityFromReviews(reviews);
  store.featureDiagnostics = buildFeatureDiagnosticsFromReviews(reviews);
  store.modelPerformance = buildModelPerformanceFromReviews(reviews);
  store.backtestSummary = buildBacktestSummaryFromReviews(reviews);
}

function buildExactScoreTipScore(prediction, match) {
  const exactProb = Number(prediction?.exactProb || 0);
  const confidence = Number(prediction?.confidence || 0);
  const modelAgreement = Number(prediction?.modelEdges?.modelAgreement || 0);
  const dataCompleteness = Number(
    prediction?.dataCompletenessScore ??
      prediction?.modelEdges?.dataCompleteness?.score ??
      match?.dataCompletenessScore ??
      0
  );
  const leagueReliability = prediction?.modelEdges?.leagueReliability || match?.competitionReliability || null;
  const phaseReliability = prediction?.modelEdges?.phaseReliability || match?.phaseReliability || null;
  const sourceQuality = Math.max(
    Number(match?.homeSeasonStats?.sourceQuality || 0),
    Number(match?.awaySeasonStats?.sourceQuality || 0),
    Number(prediction?.modelEdges?.marketCalibration?.closingCoverage || 0)
  );
  const lineupBonus = prediction?.lineupSummary?.confirmed || match?.lineupSummary?.confirmed ? 0.025 : 0;
  const h2hBonus = Number(match?.h2h?.played || prediction?.h2h?.played || 0) >= 3 ? 0.018 : 0;
  const reliabilityBonus = clamp(
    (Number(leagueReliability?.reliabilityScore || 0) +
      Number(phaseReliability?.reliabilityScore || 0)) / 2,
    0,
    1
  ) * 0.045;
  const exactReliability = clamp(
    (Number(leagueReliability?.exactHitRate || 0) + Number(phaseReliability?.exactHitRate || 0)) / 2,
    0,
    1
  );
  const exactReliabilityBonus = clamp((exactReliability - 0.12) * 0.24, -0.025, 0.05);
  const avgGoalError = Number(
    (
      (Number(leagueReliability?.avgGoalError || 0) + Number(phaseReliability?.avgGoalError || 0)) /
      ((leagueReliability?.avgGoalError != null ? 1 : 0) + (phaseReliability?.avgGoalError != null ? 1 : 0) || 1)
    ).toFixed(2)
  );
  const goalErrorPenalty = clamp((avgGoalError - 1.45) * 0.038, 0, 0.085);
  const learningEdge = prediction?.modelEdges?.learningEdge || match?.learningSummary || null;
  const learningGames = Number(learningEdge?.totalReviewedMatches || 0);
  const learningReliability = Number(learningEdge?.combinedReliability || 0);
  const learningBonus = learningGames >= 8 ? clamp((learningReliability - 0.48) * 0.12, -0.025, 0.035) : 0;
  const marketCoverage = Number(prediction?.modelEdges?.marketCalibration?.closingCoverage || 0);
  const marketBonus = marketCoverage >= 0.45 ? 0.026 : marketCoverage >= 0.18 ? 0.01 : marketCoverage <= 0.05 ? -0.02 : 0;
  const scoreSelectionReason = String(prediction?.modelEdges?.scoreSelection?.reason || "");
  const adjustedScoreBonus = scoreSelectionReason.includes("aangepast") ? 0.012 : 0;
  const completenessBonus = clamp((dataCompleteness - 0.55) * 0.18, -0.07, 0.075);
  const qualityGatePenalty = prediction?.qualityGate?.blockedHighConfidence || match?.qualityGate?.blockedHighConfidence ? 0.045 : 0;
  const riskPenalty = prediction?.modelEdges?.riskProfile === "high" ? 0.065 : prediction?.modelEdges?.riskProfile === "medium" ? 0.03 : 0;
  const agreementPenalty = modelAgreement < 0.42 ? 0.07 : modelAgreement < 0.55 ? 0.038 : 0;
  const score = clamp(
    exactProb * 2.85 +
      confidence * 0.1 +
      modelAgreement * 0.24 +
      sourceQuality * 0.17 +
      lineupBonus +
      h2hBonus +
      reliabilityBonus +
      exactReliabilityBonus +
      learningBonus +
      marketBonus +
      completenessBonus +
      adjustedScoreBonus -
      qualityGatePenalty -
      riskPenalty -
      agreementPenalty -
      goalErrorPenalty,
    0,
    0.99
  );
  const reasons = [];
  if (exactProb >= 0.12) reasons.push("sterke exacte-score kans");
  if (modelAgreement >= 0.68) reasons.push("modellen eensgezind");
  if (sourceQuality >= 0.55) reasons.push("rijke brondata");
  if (sourceQuality < 0.3) reasons.push("brondata dun meegewogen");
  if (dataCompleteness >= 0.68) reasons.push("kwaliteitsgate groen");
  if (dataCompleteness < 0.5) reasons.push("bronkwaliteit beperkt");
  if (lineupBonus) reasons.push("opstellingen bevestigd");
  if (h2hBonus) reasons.push("H2H gevuld");
  if (reliabilityBonus >= 0.025) reasons.push("competitie/fase betrouwbaar");
  if (exactReliabilityBonus >= 0.015) reasons.push("exact-score historie sterk");
  if (learningBonus >= 0.015) reasons.push("leerdata positief");
  if (marketBonus > 0) reasons.push("marktdekking sterk");
  if (adjustedScoreBonus) reasons.push("scoreselectie bijgestuurd");
  if (riskPenalty) reasons.push("risico meegewogen");
  if (agreementPenalty) reasons.push("modeltwijfel afgestraft");
  if (goalErrorPenalty) reasons.push("historische foutmarge meegewogen");
  return {
    score: Number(score.toFixed(3)),
    reasons: reasons.slice(0, 4),
  };
}

function assignTopConfidenceRanks(dayMatches, dayPredictions) {
  const matchMap = new Map((dayMatches || []).map((match) => [match.id, match]));
  const ranked = [...(dayPredictions || [])]
    .map((prediction) => {
      const match = matchMap.get(prediction.matchId);
      const exactScoreTip = buildExactScoreTipScore(prediction, match);
      prediction.exactScoreConfidence = exactScoreTip.score;
      prediction.exactScoreReasons = exactScoreTip.reasons;
      return {
        matchId: prediction.matchId,
        exactScoreConfidence: exactScoreTip.score,
      };
    })
    .sort((a, b) => b.exactScoreConfidence - a.exactScoreConfidence)
    .slice(0, 5);

  const rankMap = new Map(ranked.map((item, index) => [item.matchId, index + 1]));

  for (const prediction of dayPredictions || []) {
    const rank = rankMap.get(prediction.matchId) || null;
    prediction.bestBetRank = rank;
    prediction.topConfidencePick = rank != null;
    prediction.topExactScorePick = rank != null;
  }

  for (const match of dayMatches || []) {
    const prediction = (dayPredictions || []).find((item) => item.matchId === match.id);
    const rank = rankMap.get(match.id) || null;
    match.bestBetRank = rank;
    match.topConfidencePick = rank != null;
    match.topExactScorePick = rank != null;
    if (prediction?.exactScoreConfidence != null) match.exactScoreConfidence = prediction.exactScoreConfidence;
    if (prediction?.exactScoreReasons) match.exactScoreReasons = prediction.exactScoreReasons;
  }
}

function calibrateScoreMatrixWithReviewBias(scoreMatrix, input, selectedScore) {
  const leagueReliability = input?.leagueReliability || {};
  const phaseReliability = input?.phaseReliability || {};
  const exactHitRate = Math.max(Number(leagueReliability.exactHitRate || 0), Number(phaseReliability.exactHitRate || 0));
  const avgGoalError = Math.max(Number(leagueReliability.avgGoalError || 0), Number(phaseReliability.avgGoalError || 0));
  const matrix = { ...(scoreMatrix || {}) };
  const lowExactReliability = exactHitRate > 0 && exactHitRate < 0.1;
  const highGoalError = avgGoalError >= 1.75;
  const drawHeavyPick = ["0-0", "1-1"].includes(String(selectedScore || ""));

  if (!drawHeavyPick || (!lowExactReliability && !highGoalError)) {
    return {
      matrix,
      applied: false,
      reason: "scorematrix ongewijzigd",
    };
  }

  for (const score of ["0-0", "1-1"]) {
    if (matrix[score] != null) matrix[score] = Number((Number(matrix[score]) * 0.92).toFixed(4));
  }
  for (const score of ["1-0", "0-1", "2-1", "1-2"]) {
    if (matrix[score] != null) matrix[score] = Number((Number(matrix[score]) * 1.025).toFixed(4));
  }

  return {
    matrix,
    applied: true,
    reason: "historische exact-score foutmarge stuurt lage draw-picks licht bij",
  };
}

function getLeagueInfo(event) {
  if (shouldExcludeEvent(event)) return null;
  const tournament = String(
    event?.uniqueTournament?.name || event?.tournament?.name || ""
  ).toLowerCase();
  const country = String(event?.tournament?.category?.name || "").toLowerCase();
  const international = getInternationalLeagueInfo(event);
  if (international) return international;
  return LEAGUES.find(
    (league) =>
      (!league.country || country.includes(league.country)) &&
      (tournament === league.name || tournament.includes(league.name))
  ) || null;
}

function purgeExcludedContent(store) {
  const excludedTeamIds = new Set();

  for (const [date, matches] of Object.entries(store.matches || {})) {
    const safeMatches = [];
    for (const match of matches || []) {
      const excluded =
        isWomenContext(match?.league, match?.homeTeamName, match?.awayTeamName) ||
        isYouthContext(match?.league, match?.homeTeamName, match?.awayTeamName);
      if (excluded) {
        if (match?.homeTeamId) excludedTeamIds.add(String(match.homeTeamId));
        if (match?.awayTeamId) excludedTeamIds.add(String(match.awayTeamId));
      } else {
        safeMatches.push(match);
      }
    }
    store.matches[date] = safeMatches;
    store.predictions[date] = (store.predictions?.[date] || []).filter(
      (prediction) =>
        !isWomenContext(prediction?.league, prediction?.homeTeamName, prediction?.awayTeamName) &&
        !isYouthContext(prediction?.league, prediction?.homeTeamName, prediction?.awayTeamName)
    );
  }

  for (const key of Object.keys(store.teams || {})) {
    const team = store.teams[key];
    if (excludedTeamIds.has(String(team?.id || "")) || isWomenContext(team?.league, team?.name) || isYouthContext(team?.league, team?.name)) {
      delete store.teams[key];
    }
  }

  const keyedMaps = [
    "teamStats",
    "teamStatsUpdated",
    "teamInjuries",
    "teamInjuriesUpdated",
    "teamSeasonStats",
    "teamSeasonStatsUpdated",
  ];

  for (const mapName of keyedMaps) {
    if (!store[mapName]) continue;
    for (const key of Object.keys(store[mapName])) {
      if (excludedTeamIds.has(String(key))) delete store[mapName][key];
    }
  }
}

function deriveStandingMeta(label, rowsCount) {
  const rows = Number(rowsCount || 0);
  const zones = [];
  const notes = [];

  if (label.includes("Premier League") || label.includes("LaLiga") || label.includes("Serie A") || label.includes("Bundesliga") || label.includes("Ligue 1")) {
    zones.push(
      { key: "ucl", label: "Champions League", color: "blue", from: 1, to: 4 },
      { key: "europe", label: "Europees", color: "amber", from: 5, to: 6 },
      { key: "relegation", label: "Degradatie", color: "red", from: Math.max(rows - 2, 1), to: rows }
    );
  } else if (label.includes("Championship")) {
    zones.push(
      { key: "promotion", label: "Promotie", color: "blue", from: 1, to: 2 },
      { key: "playoffs", label: "Play-offs", color: "amber", from: 3, to: 6 },
      { key: "relegation", label: "Degradatie", color: "red", from: Math.max(rows - 2, 1), to: rows }
    );
    notes.push("Posities 3 tot en met 6 spelen promotie-play-offs.");
  } else if (label.includes("Eerste Divisie")) {
    zones.push(
      { key: "promotion", label: "Promotie", color: "blue", from: 1, to: 2 },
      { key: "period", label: "Play-off zone", color: "amber", from: 3, to: 8 }
    );
    notes.push("Eerste Divisie gebruikt periode- en play-offtickets.");
  } else if (label.includes("Eredivisie")) {
    zones.push(
      { key: "ucl", label: "Champions League", color: "blue", from: 1, to: 3 },
      { key: "playoffs", label: "Europees play-off", color: "amber", from: 4, to: 8 },
      { key: "relegation", label: "Degradatie / nacompetitie", color: "red", from: Math.max(rows - 2, 1), to: rows }
    );
  } else {
    zones.push(
      { key: "top", label: "Topzone", color: "blue", from: 1, to: Math.min(4, rows || 4) },
      { key: "bottom", label: "Gevarenzone", color: "red", from: Math.max(rows - 2, 1), to: rows || 1 }
    );
  }

  return {
    format: "league",
    zones,
    notes,
  };
}

function getZoneForPosition(meta, position) {
  if (!meta?.zones?.length || !position) return null;
  return meta.zones.find((zone) => position >= zone.from && position <= zone.to) || null;
}

function emptyStandingTeam(teamName, teamId = "") {
  return {
    team: teamName,
    teamId: String(teamId || ""),
    p: 0,
    w: 0,
    d: 0,
    l: 0,
    gf: 0,
    ga: 0,
    pts: 0,
  };
}

function buildStandingResultTeamKey(teamName) {
  const variants = buildPossibleNames(teamName)
    .map(normalizeName)
    .filter(Boolean)
    .filter((name) => !UNSAFE_LOGO_KEYS.has(name))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  return variants[0] || canonicalTeamName(teamName);
}

function buildStandingResultKey(date, home, away) {
  return `${date || ""}|${buildStandingResultTeamKey(home)}|${buildStandingResultTeamKey(away)}`;
}

function sortStandingRows(rows) {
  return [...(rows || [])]
    .sort((a, b) => {
      const aGd = Number(a.gf || 0) - Number(a.ga || 0);
      const bGd = Number(b.gf || 0) - Number(b.ga || 0);
      return (
        Number(b.pts || 0) - Number(a.pts || 0) ||
        bGd - aGd ||
        Number(b.gf || 0) - Number(a.gf || 0) ||
        String(a.team || "").localeCompare(String(b.team || ""))
      );
    })
    .map((row, index) => ({ ...row, pos: index + 1 }));
}

function findStandingRowIndex(rows, teamName, teamId = "") {
  if (!Array.isArray(rows)) return -1;
  if (teamId) {
    const byId = rows.findIndex((row) => String(row.teamId || "") === String(teamId || ""));
    if (byId >= 0) return byId;
  }
  const variants = buildPossibleNames(teamName);
  return rows.findIndex((row) => buildPossibleNames(row.team).some((name) => variants.includes(name)));
}

function ensureStandingRow(rows, teamName, teamId = "") {
  const index = findStandingRowIndex(rows, teamName, teamId);
  if (index >= 0) return rows[index];
  const next = emptyStandingTeam(teamName, teamId);
  rows.push(next);
  return next;
}

function applyResultToStandingRows(rows, item, options = {}) {
  const home = String(item.home || item.homeTeamName || "").trim();
  const away = String(item.away || item.awayTeamName || "").trim();
  const homeGoals = toNumber(item.homeGoals);
  const awayGoals = toNumber(item.awayGoals);
  if (!home || !away || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return false;

  if (options.requireKnownTeams) {
    const homeIndex = findStandingRowIndex(rows, home, item.homeTeamId || "");
    const awayIndex = findStandingRowIndex(rows, away, item.awayTeamId || "");
    if (homeIndex < 0 || awayIndex < 0) return false;
  }

  const homeRow = ensureStandingRow(rows, home, item.homeTeamId || "");
  const awayRow = ensureStandingRow(rows, away, item.awayTeamId || "");

  homeRow.p += 1;
  awayRow.p += 1;
  homeRow.gf += homeGoals;
  homeRow.ga += awayGoals;
  awayRow.gf += awayGoals;
  awayRow.ga += homeGoals;

  if (homeGoals > awayGoals) {
    homeRow.w += 1;
    homeRow.pts += 3;
    awayRow.l += 1;
  } else if (awayGoals > homeGoals) {
    awayRow.w += 1;
    awayRow.pts += 3;
    homeRow.l += 1;
  } else {
    homeRow.d += 1;
    awayRow.d += 1;
    homeRow.pts += 1;
    awayRow.pts += 1;
  }
  return true;
}

function buildStandingFromResultRows(label, results, source) {
  const table = new Map();
  const resultKeys = new Set();
  let lastResultDate = null;
  for (const item of results || []) {
    const home = String(item.home || "").trim();
    const away = String(item.away || "").trim();
    const homeGoals = toNumber(item.homeGoals);
    const awayGoals = toNumber(item.awayGoals);
    if (!home || !away || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;

    const homeKey = canonicalTeamName(home);
    const awayKey = canonicalTeamName(away);
    if (!homeKey || !awayKey) continue;
    const homeRow = table.get(homeKey) || emptyStandingTeam(home, item.homeTeamId || "");
    const awayRow = table.get(awayKey) || emptyStandingTeam(away, item.awayTeamId || "");

    homeRow.p += 1;
    awayRow.p += 1;
    homeRow.gf += homeGoals;
    homeRow.ga += awayGoals;
    awayRow.gf += awayGoals;
    awayRow.ga += homeGoals;

    if (homeGoals > awayGoals) {
      homeRow.w += 1;
      homeRow.pts += 3;
      awayRow.l += 1;
    } else if (awayGoals > homeGoals) {
      awayRow.w += 1;
      awayRow.pts += 3;
      homeRow.l += 1;
    } else {
      homeRow.d += 1;
      awayRow.d += 1;
      homeRow.pts += 1;
      awayRow.pts += 1;
    }

    table.set(homeKey, homeRow);
    table.set(awayKey, awayRow);
    resultKeys.add(buildStandingResultKey(item.date || "", home, away));
    if (item.date && (!lastResultDate || String(item.date) > String(lastResultDate))) lastResultDate = item.date;
  }

  const rows = sortStandingRows([...table.values()]);

  if (!rows.length) return null;
  return {
    label,
    rows,
    updated: Date.now(),
    source,
    sources: [{ source, rows: rows.length, totalPlayed: rows.reduce((sum, row) => sum + Number(row.p || 0), 0) }],
    meta: deriveStandingMeta(label, rows.length),
    resultKeys: [...resultKeys],
    lastResultDate,
  };
}

async function fetchFootballDataStandings(label, dateISO) {
  const marketCode = MARKET_LEAGUE_CODES[label];
  if (!marketCode) return null;
  const results = [];
  for (const seasonFolder of getSeasonFolders(dateISO, 2)) {
    const csvText = await fetchText(`https://www.football-data.co.uk/mmz4281/${seasonFolder}/${marketCode}.csv`);
    if (!csvText) continue;
    for (const row of parseCsv(csvText)) {
      const homeGoals = toNumber(row.FTHG);
      const awayGoals = toNumber(row.FTAG);
      if (!row.HomeTeam || !row.AwayTeam || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
      results.push({
        date: parseFootballDataDateKey(row.Date || row.date),
        home: row.HomeTeam,
        away: row.AwayTeam,
        homeGoals,
        awayGoals,
      });
    }
    if (results.length) break;
  }
  return buildStandingFromResultRows(label, results, "football-data.co.uk");
}

async function fetchOpenfootballStandings(label, dateISO) {
  const competitionCode = OPENFOOTBALL_COMPETITIONS[label];
  if (!competitionCode) return null;
  const results = [];
  for (const seasonTag of getOpenfootballSeasonTags(dateISO, 2)) {
    const json = await fetchExternalJson(`https://raw.githubusercontent.com/openfootball/football.json/master/${seasonTag}/${competitionCode}.json`);
    const matches = Array.isArray(json?.matches) ? json.matches : [];
    for (const match of matches) {
      const ft = match?.score?.ft;
      if (!Array.isArray(ft) || ft.length < 2) continue;
      const homeGoals = toNumber(ft[0]);
      const awayGoals = toNumber(ft[1]);
      if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
      results.push({
        date: match.date || null,
        home: match.team1 || match.homeTeam || "",
        away: match.team2 || match.awayTeam || "",
        homeGoals,
        awayGoals,
      });
    }
    if (results.length) break;
  }
  return buildStandingFromResultRows(label, results, "openfootball");
}

function standingStrength(standing) {
  if (!standing?.rows?.length) return 0;
  return standing.rows.reduce((sum, row) => sum + Number(row.p || 0), 0) + standing.rows.length * 0.1;
}

function mergeStandingCandidates(label, candidates) {
  const valid = candidates.filter((item) => item?.rows?.length);
  if (!valid.length) return null;
  const best = valid.sort((a, b) => standingStrength(b) - standingStrength(a))[0];
  const sources = valid.map((item) => ({
    source: item.source || "sofascore",
    rows: item.rows.length,
    totalPlayed: item.rows.reduce((sum, row) => sum + Number(row.p || 0), 0),
  }));
  return {
    ...best,
    label,
    source: best.source || "sofascore",
    sources,
    updated: Date.now(),
    meta: deriveStandingMeta(label, best.rows.length),
    resultKeys: Array.isArray(best.resultKeys) ? best.resultKeys : [],
    lastResultDate: best.lastResultDate || null,
  };
}

function isStandingLeagueLabel(label) {
  const text = normalizeName(label);
  if (!text) return false;
  const excluded = [
    "champions league",
    "europa league",
    "conference league",
    "beker",
    "cup",
    "qualification",
    "qualificatie",
    "friendly",
    "vriendschapp",
    "nations league",
    "super cup",
  ];
  if (excluded.some((item) => text.includes(item))) return false;
  return true;
}

function shouldApplyMatchToStanding(match, baseStanding) {
  const status = String(match?.status || "").toUpperCase();
  if (!["FT", "LIVE", "HT", "RESULT_PENDING"].includes(status)) return false;
  if (!parseScoreToGoals(match?.score)) return false;
  if (status === "FT" && !Array.isArray(baseStanding?.resultKeys)) return true;
  return true;
}

function applyLiveMatchesToStanding(baseStanding, matches, label) {
  const rows = (baseStanding?.rows || []).map((row) => ({
    ...row,
    p: Number(row.p || 0),
    w: Number(row.w || 0),
    d: Number(row.d || 0),
    l: Number(row.l || 0),
    gf: Number(row.gf || 0),
    ga: Number(row.ga || 0),
    pts: Number(row.pts || 0),
  }));
  const resultKeys = new Set(Array.isArray(baseStanding?.resultKeys) ? baseStanding.resultKeys : []);
  let applied = 0;
  let liveApplied = 0;
  let lastResultDate = baseStanding?.lastResultDate || null;

  for (const match of matches || []) {
    if (String(match?.league || "") !== String(label || "")) continue;
    if (!shouldApplyMatchToStanding(match, baseStanding)) continue;
    const goals = parseScoreToGoals(match.score);
    if (!goals) continue;
    const resultKey = buildStandingResultKey(match.date || "", match.homeTeamName, match.awayTeamName);
    if (resultKeys.has(resultKey)) continue;

    const appliedResult = applyResultToStandingRows(rows, {
      date: match.date || "",
      home: match.homeTeamName,
      away: match.awayTeamName,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeGoals: goals.homeGoals,
      awayGoals: goals.awayGoals,
    }, { requireKnownTeams: (baseStanding?.rows || []).length >= 10 });
    if (!appliedResult) continue;

    resultKeys.add(resultKey);
    applied += 1;
    if (["LIVE", "HT"].includes(String(match.status || "").toUpperCase())) liveApplied += 1;
    if (match.date && (!lastResultDate || String(match.date) > String(lastResultDate))) lastResultDate = match.date;
  }

  if (!rows.length) return null;
  const sources = Array.isArray(baseStanding?.sources) ? [...baseStanding.sources] : [];
  if (applied > 0) {
    sources.push({
      source: "live-match-overlay",
      rows: rows.length,
      totalPlayed: applied,
      liveApplied,
    });
  }
  return {
    ...(baseStanding || {}),
    label,
    rows: sortStandingRows(rows),
    updated: Date.now(),
    source: applied > 0 ? `${baseStanding?.source || "stand"} + live-match-overlay` : baseStanding?.source || "stand",
    sources,
    meta: deriveStandingMeta(label, rows.length),
    resultKeys: [...resultKeys],
    lastResultDate,
    liveOverlay: {
      applied,
      liveApplied,
      updated: Date.now(),
    },
  };
}

function applyLiveStandingsOverlay(store) {
  const allMatches = Object.values(store.matches || {}).flat();
  const standingLabels = Object.values(store.standings || {})
    .map((standing) => standing?.label)
    .filter(Boolean);
  const matchLabels = allMatches.map((match) => match?.league).filter(Boolean);
  const labels = [...new Set([...standingLabels, ...matchLabels])].filter(isStandingLeagueLabel);

  for (const label of labels) {
    const labelKey = `label:${label}`;
    const sameLabelEntries = Object.entries(store.standings || {}).filter(([, standing]) => standing?.label === label);
    const base =
      store.standings[labelKey] ||
      sameLabelEntries
        .map(([, standing]) => standing)
        .sort((a, b) => standingStrength(b) - standingStrength(a))[0] ||
      {
        label,
        rows: [],
        updated: Date.now(),
        source: "live-match-overlay",
        sources: [],
        meta: deriveStandingMeta(label, 0),
        resultKeys: [],
      };
    const overlaid = applyLiveMatchesToStanding(base, allMatches, label);
    if (!overlaid) continue;
    store.standings[labelKey] = overlaid;
    for (const [key, standing] of sameLabelEntries) {
      if (standing?.rows?.length) store.standings[key] = overlaid;
    }
  }
}

async function fetchStandings(tournamentId, seasonId, label, dateISO) {
  const candidates = [];
  if (tournamentId && seasonId) {
    const json = await safeFetch(
      `${SOFA}/unique-tournament/${tournamentId}/season/${seasonId}/standings/total`
    );
    const rows = json?.standings?.[0]?.rows || [];
    if (rows.length) {
      const mapped = rows.map((row) => ({
        pos: row.position,
        team: row.team?.name,
        teamId: String(row.team?.id || ""),
        p: row.matches,
        w: row.wins,
        d: row.draws,
        l: row.losses,
        gf: row.scoresFor,
        ga: row.scoresAgainst,
        pts: row.points,
      }));
      candidates.push({
        label,
        rows: mapped,
        updated: Date.now(),
        source: "sofascore",
        sources: [{ source: "sofascore", rows: mapped.length, totalPlayed: mapped.reduce((sum, row) => sum + Number(row.p || 0), 0) }],
        meta: deriveStandingMeta(label, mapped.length),
      });
    }
  }

  const [footballDataStanding, openfootballStanding] = await Promise.all([
    fetchFootballDataStandings(label, dateISO),
    fetchOpenfootballStandings(label, dateISO),
  ]);
  if (footballDataStanding) candidates.push(footballDataStanding);
  if (openfootballStanding) candidates.push(openfootballStanding);
  return mergeStandingCandidates(label, candidates);
}

function findStandingRow(standing, teamId, teamName) {
  if (!standing?.rows?.length) return null;
  const byId = teamId ? standing.rows.find((row) => String(row.teamId || "") === String(teamId || "")) : null;
  if (byId) return byId;
  const variants = buildPossibleNames(teamName);
  return standing.rows.find((row) => buildPossibleNames(row.team).some((name) => variants.includes(name))) || null;
}

async function fetchLiveStats(eventId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/statistics`);
  if (!json?.statistics) return null;

  const flat = {};
  for (const block of json.statistics) {
    for (const group of block.groups || []) {
      for (const item of group.statisticsItems || []) {
        const key = String(item.name || "")
          .toLowerCase()
          .replace(/\s+/g, "_");
        if (key) flat[key] = { home: item.home, away: item.away };
      }
    }
  }

  return {
    shots_on_target: flat.shots_on_target || flat.on_target || null,
    shots_total: flat.total_shots || flat.shots_total || null,
    possession: flat.ball_possession || null,
    corners: flat.corner_kicks || null,
    xg: flat.expected_goals || null,
  };
}

function buildEmptyTeamForm(source = "empty") {
  return {
    form: "",
    avgScored: 1.35,
    avgConceded: 1.35,
    bttsRate: 0.5,
    over15Rate: 0.5,
    over25Rate: 0.45,
    cleanSheetRate: 0.2,
    failToScoreRate: 0.25,
    yellowCardRate: 0,
    redCardRate: 0,
    gamesPlayed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    splits: { home: emptySplit(), away: emptySplit() },
    recentMatches: [],
    lastMatchKickoff: null,
    strongestSide: "balanced",
    source,
  };
}

function buildTeamFormFromRecentMatches(matches, source = "historical-form") {
  const sample = (matches || [])
    .filter((item) => item && Number.isFinite(toNumber(item.goalsFor)) && Number.isFinite(toNumber(item.goalsAgainst)))
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")))
    .slice(-TEAM_RECENT_MATCH_WINDOW)
    .map((item) => {
      const gf = Number(toNumber(item.goalsFor));
      const ga = Number(toNumber(item.goalsAgainst));
      return {
        date: item.date || null,
        eventId: item.eventId || null,
        league: item.league || null,
        tournamentId: item.tournamentId || null,
        seasonId: item.seasonId || null,
        venue: item.venue === "A" ? "A" : "H",
        opponent: item.opponent || "Opponent",
        opponentId: item.opponentId || "",
        score: item.score || `${gf}-${ga}`,
        goalsFor: gf,
        goalsAgainst: ga,
        result: gf > ga ? "W" : gf === ga ? "D" : "L",
        source: item.source || source,
      };
    });

  if (!sample.length) return buildEmptyTeamForm(source);

  let form = "";
  let scored = 0;
  let conceded = 0;
  let btts = 0;
  const splitState = {
    home: { games: 0, scored: 0, conceded: 0, btts: 0, over15: 0, over25: 0, cleanSheets: 0, failToScore: 0, wins: 0, draws: 0, losses: 0 },
    away: { games: 0, scored: 0, conceded: 0, btts: 0, over15: 0, over25: 0, cleanSheets: 0, failToScore: 0, wins: 0, draws: 0, losses: 0 },
  };

  for (const item of sample) {
    const gf = Number(item.goalsFor);
    const ga = Number(item.goalsAgainst);
    scored += gf;
    conceded += ga;
    if (gf > 0 && ga > 0) btts += 1;
    form += gf > ga ? "W" : gf === ga ? "D" : "L";

    const target = item.venue === "A" ? splitState.away : splitState.home;
    target.games += 1;
    target.scored += gf;
    target.conceded += ga;
    if (gf > 0 && ga > 0) target.btts += 1;
    if (gf + ga > 1) target.over15 += 1;
    if (gf + ga > 2) target.over25 += 1;
    if (ga === 0) target.cleanSheets += 1;
    if (gf === 0) target.failToScore += 1;
    if (gf > ga) target.wins += 1;
    else if (gf === ga) target.draws += 1;
    else target.losses += 1;
  }

  const homeSplit = finalizeSplit(splitState.home);
  const awaySplit = finalizeSplit(splitState.away);
  let strongestSide = "balanced";
  if (homeSplit.avgScored > awaySplit.avgScored + 0.25) strongestSide = "home";
  if (awaySplit.avgScored > homeSplit.avgScored + 0.25) strongestSide = "away";

  return {
    form: form.slice(-TEAM_FORM_BADGE_WINDOW),
    avgScored: Number((scored / sample.length).toFixed(2)),
    avgConceded: Number((conceded / sample.length).toFixed(2)),
    bttsRate: Number((btts / sample.length).toFixed(2)),
    over15Rate: Number((sample.filter((item) => Number(item.goalsFor) + Number(item.goalsAgainst) > 1).length / sample.length).toFixed(2)),
    over25Rate: Number((sample.filter((item) => Number(item.goalsFor) + Number(item.goalsAgainst) > 2).length / sample.length).toFixed(2)),
    cleanSheetRate: Number((sample.filter((item) => Number(item.goalsAgainst) === 0).length / sample.length).toFixed(2)),
    failToScoreRate: Number((sample.filter((item) => Number(item.goalsFor) === 0).length / sample.length).toFixed(2)),
    yellowCardRate: 0,
    redCardRate: 0,
    gamesPlayed: sample.length,
    wins: (form.match(/W/g) || []).length,
    draws: (form.match(/D/g) || []).length,
    losses: (form.match(/L/g) || []).length,
    splits: { home: homeSplit, away: awaySplit },
    recentMatches: sample,
    lastMatchKickoff: sample[sample.length - 1]?.date ? `${sample[sample.length - 1].date}T00:00:00.000Z` : null,
    strongestSide,
    source,
  };
}

function collectHistoricalTeamMatches(teamName, profiles = []) {
  const matches = [];
  const seenProfiles = new Set();
  for (const profile of profiles || []) {
    if (!profile || seenProfiles.has(profile)) continue;
    seenProfiles.add(profile);
    const teamProfile = lookupMarketTeamProfile(profile, teamName);
    if (Array.isArray(teamProfile?.recentMatches)) matches.push(...teamProfile.recentMatches);
  }
  return matches;
}

function mergeTeamFormWithHistorical(currentForm, leagueMarketProfile, openFootballProfile, teamName, extraProfiles = []) {
  const currentMatches = Array.isArray(currentForm?.recentMatches) ? currentForm.recentMatches : [];
  if (currentMatches.length >= TEAM_RECENT_MATCH_WINDOW) return currentForm;

  const historicalMatches = [
    ...collectHistoricalTeamMatches(teamName, [leagueMarketProfile, openFootballProfile, ...extraProfiles]),
  ];
  if (!historicalMatches.length) return currentForm || buildEmptyTeamForm("no-historical-form");

  const byKey = new Map();
  for (const item of [...historicalMatches, ...currentMatches]) {
    const key = [
      item?.date || "",
      normalizeName(item?.opponent || ""),
      item?.venue || "",
      item?.score || "",
    ].join("|");
    if (!byKey.has(key)) byKey.set(key, item);
  }

  const mergedMatches = [...byKey.values()]
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")))
    .slice(-TEAM_RECENT_MATCH_WINDOW);
  const source = currentMatches.length
    ? "live+historical-team-form"
    : historicalMatches.some((item) => String(item?.source || "").includes("football-data"))
      ? "football-data-team-form"
      : "openfootball-team-form";

  return buildTeamFormFromRecentMatches(mergedMatches, source);
}

function buildTeamMatchesFromH2HResults(results, teamName) {
  const variants = buildPossibleNames(teamName);
  return (results || []).map((result) => {
    const home = String(result?.home || "").trim();
    const away = String(result?.away || "").trim();
    const homeMatch = buildPossibleNames(home).some((name) => variants.includes(name));
    const awayMatch = buildPossibleNames(away).some((name) => variants.includes(name));
    if (!homeMatch && !awayMatch) return null;
    const scoreParts = String(result?.score || "").match(/(\d+)\s*-\s*(\d+)/);
    if (!scoreParts) return null;
    const homeGoals = Number(scoreParts[1]);
    const awayGoals = Number(scoreParts[2]);
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
    const gf = homeMatch ? homeGoals : awayGoals;
    const ga = homeMatch ? awayGoals : homeGoals;
    return {
      date: result?.date || null,
      eventId: result?.eventId || null,
      league: result?.source || "h2h",
      tournamentId: result?.tournamentId || null,
      seasonId: result?.seasonId || null,
      venue: homeMatch ? "H" : "A",
      opponent: homeMatch ? away : home,
      opponentId: homeMatch ? result?.awayTeamId || "" : result?.homeTeamId || "",
      score: `${gf}-${ga}`,
      goalsFor: gf,
      goalsAgainst: ga,
      result: gf > ga ? "W" : gf === ga ? "D" : "L",
      source: result?.source || "h2h-agent",
    };
  }).filter(Boolean);
}

function supplementTeamFormWithH2H(currentForm, h2h, teamName) {
  const currentMatches = Array.isArray(currentForm?.recentMatches) ? currentForm.recentMatches : [];
  if (currentMatches.length >= TEAM_RECENT_MATCH_WINDOW) return currentForm;
  const h2hMatches = buildTeamMatchesFromH2HResults(h2h?.results || [], teamName);
  if (!h2hMatches.length) return currentForm;
  const byKey = new Map();
  for (const item of [...currentMatches, ...h2hMatches]) {
    const key = [
      item?.date || "",
      normalizeName(item?.opponent || ""),
      item?.venue || "",
      item?.score || "",
    ].join("|");
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return buildTeamFormFromRecentMatches([...byKey.values()], currentMatches.length ? "historical+h2h-team-form" : "h2h-team-form");
}

function ensureRecentFormContract(currentForm, fallbackTeamName, h2h, teamId, oppositeTeamId) {
  const base = currentForm && typeof currentForm === "object" ? currentForm : buildEmptyTeamForm("contract-fallback");
  const sourceMatches = Array.isArray(base.recentMatches) ? base.recentMatches : [];
  let recentMatches = sourceMatches.slice(-TEAM_RECENT_MATCH_WINDOW);
  if (recentMatches.length < TEAM_RECENT_MATCH_WINDOW) {
    const h2hBackfill = buildTeamMatchesFromH2HResults(h2h?.results || [], fallbackTeamName)
      .filter((row) => {
        if (!row) return false;
        if (teamId && String(row.teamId || "") === String(teamId)) return true;
        if (oppositeTeamId && String(row.opponentId || "") === String(oppositeTeamId)) return true;
        return true;
      });
    const byKey = new Map();
    for (const item of [...recentMatches, ...h2hBackfill]) {
      const key = `${item?.date || ""}|${normalizeName(item?.opponent || "")}|${item?.venue || ""}|${item?.score || ""}`;
      if (!byKey.has(key)) byKey.set(key, item);
    }
    recentMatches = [...byKey.values()].slice(-TEAM_RECENT_MATCH_WINDOW);
  }
  const merged = buildTeamFormFromRecentMatches(recentMatches, base.source || (recentMatches.length ? "h2h-team-form" : "contract-fallback"));
  return {
    ...merged,
    source: merged?.source || base.source || "contract-fallback",
    recentMatches,
  };
}

async function fetchTeamForm(teamId, options = {}) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/events/last/0`);
  const targetSegment =
    options.segment ||
    getCompetitionSegment(options.teamName, options.tournamentName);
  const finished = (json?.events || [])
    .filter((event) => getCompetitionSegment(
      event?.homeTeam?.name,
      event?.awayTeam?.name,
      event?.tournament?.name,
      event?.uniqueTournament?.name
    ) === targetSegment)
    .filter((event) => event.status?.type === "finished")
    .sort((a, b) => Number(a.startTimestamp || 0) - Number(b.startTimestamp || 0));

  if (!finished.length) {
    return buildEmptyTeamForm("sofascore-empty");
  }

  const sample = finished.slice(-TEAM_RECENT_MATCH_WINDOW);
  let form = "";
  let scored = 0;
  let conceded = 0;
  let btts = 0;
  let yellowCards = 0;
  let redCards = 0;
  const splitState = {
    home: { games: 0, scored: 0, conceded: 0, btts: 0, over15: 0, over25: 0, cleanSheets: 0, failToScore: 0, wins: 0, draws: 0, losses: 0 },
    away: { games: 0, scored: 0, conceded: 0, btts: 0, over15: 0, over25: 0, cleanSheets: 0, failToScore: 0, wins: 0, draws: 0, losses: 0 },
  };

  const recentMatches = sample.slice(-TEAM_RECENT_MATCH_WINDOW).map((event) => {
    const isHome = String(event.homeTeam?.id || "") === String(teamId);
    const gf = isHome ? event.homeScore?.current : event.awayScore?.current;
    const ga = isHome ? event.awayScore?.current : event.homeScore?.current;
    const result = gf > ga ? "W" : gf === ga ? "D" : "L";
    return {
      date: event.startTimestamp
        ? new Date(event.startTimestamp * 1000).toISOString().split("T")[0]
        : null,
      eventId: event.id || null,
      league: event.tournament?.name || event.uniqueTournament?.name || null,
      tournamentId:
        event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id || event.tournament?.id || null,
      seasonId: event.season?.id || null,
      venue: isHome ? "H" : "A",
      opponent: isHome ? event.awayTeam?.name || "Opponent" : event.homeTeam?.name || "Opponent",
      opponentId: isHome ? String(event.awayTeam?.id || "") : String(event.homeTeam?.id || ""),
      score: gf != null && ga != null ? `${gf}-${ga}` : null,
      goalsFor: gf ?? null,
      goalsAgainst: ga ?? null,
      result,
    };
  });

  for (const event of sample) {
    const isHome = String(event.homeTeam?.id || "") === String(teamId);
    const gf = isHome ? event.homeScore?.current : event.awayScore?.current;
    const ga = isHome ? event.awayScore?.current : event.homeScore?.current;
    if (gf == null || ga == null) continue;

    scored += gf;
    conceded += ga;
    if (gf > 0 && ga > 0) btts += 1;
    form += gf > ga ? "W" : gf === ga ? "D" : "L";

    const target = isHome ? splitState.home : splitState.away;
    target.games += 1;
    target.scored += gf;
    target.conceded += ga;
    if (gf > 0 && ga > 0) target.btts += 1;
    if (gf + ga > 1) target.over15 += 1;
    if (gf + ga > 2) target.over25 += 1;
    if (ga === 0) target.cleanSheets += 1;
    if (gf === 0) target.failToScore += 1;
    if (gf > ga) target.wins += 1;
    else if (gf === ga) target.draws += 1;
    else target.losses += 1;

    for (const incident of event.incidents || []) {
      const type = String(incident.incidentType || "").toLowerCase();
      const klass = String(incident.incidentClass || "").toLowerCase();
      const isCard = type.includes("card") || klass.includes("card") || klass.includes("yellow") || klass.includes("red");
      if (!isCard) continue;

      const byTeam = isHome ? incident.isHome !== false : incident.isHome === false;
      if (!byTeam) continue;

      if (klass.includes("red")) redCards += 1;
      else yellowCards += 1;
    }
  }

  const homeSplit = finalizeSplit(splitState.home);
  const awaySplit = finalizeSplit(splitState.away);

  let strongestSide = "balanced";
  if (homeSplit.avgScored > awaySplit.avgScored + 0.25) strongestSide = "home";
  if (awaySplit.avgScored > homeSplit.avgScored + 0.25) strongestSide = "away";

  return {
    form: form.slice(-TEAM_FORM_BADGE_WINDOW),
    avgScored: Number((scored / sample.length).toFixed(2)),
    avgConceded: Number((conceded / sample.length).toFixed(2)),
    bttsRate: Number((btts / sample.length).toFixed(2)),
    over15Rate: Number((sample.filter((event) => {
      const isHome = String(event.homeTeam?.id || "") === String(teamId);
      const gf = isHome ? event.homeScore?.current : event.awayScore?.current;
      const ga = isHome ? event.awayScore?.current : event.homeScore?.current;
      return gf != null && ga != null && gf + ga > 1;
    }).length / sample.length).toFixed(2)),
    over25Rate: Number((sample.filter((event) => {
      const isHome = String(event.homeTeam?.id || "") === String(teamId);
      const gf = isHome ? event.homeScore?.current : event.awayScore?.current;
      const ga = isHome ? event.awayScore?.current : event.homeScore?.current;
      return gf != null && ga != null && gf + ga > 2;
    }).length / sample.length).toFixed(2)),
    cleanSheetRate: Number((sample.filter((event) => {
      const isHome = String(event.homeTeam?.id || "") === String(teamId);
      const ga = isHome ? event.awayScore?.current : event.homeScore?.current;
      return ga === 0;
    }).length / sample.length).toFixed(2)),
    failToScoreRate: Number((sample.filter((event) => {
      const isHome = String(event.homeTeam?.id || "") === String(teamId);
      const gf = isHome ? event.homeScore?.current : event.awayScore?.current;
      return gf === 0;
    }).length / sample.length).toFixed(2)),
    yellowCardRate: Number((yellowCards / sample.length).toFixed(2)),
    redCardRate: Number((redCards / sample.length).toFixed(2)),
    gamesPlayed: sample.length,
    wins: (form.match(/W/g) || []).length,
    draws: (form.match(/D/g) || []).length,
    losses: (form.match(/L/g) || []).length,
    splits: { home: homeSplit, away: awaySplit },
    recentMatches,
    lastMatchKickoff: sample[sample.length - 1]?.startTimestamp
      ? new Date(sample[sample.length - 1].startTimestamp * 1000).toISOString()
      : null,
    strongestSide,
    source: "sofascore-team-events",
  };
}

async function fetchInjuries(teamId, context = {}) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/players`);
  const injured = Array.isArray(json?.players)
    ? json.players.filter(
    (player) =>
      player.player?.injured === true ||
      player.status === "injured" ||
      player.status === "doubtful"
      )
    : [];

  const baseAvailability = {
    injuredCount: injured.length,
    injuredRating: Number(
      injured.reduce(
        (total, player) => total + Math.max(0, Number(player.player?.rating || 6) - 6),
        0
      ).toFixed(2)
    ),
    keyPlayersMissing: injured
      .map((player) => player.player?.name)
      .filter(Boolean)
      .slice(0, 4),
    suspendedCount: 0,
    suspendedPlayers: [],
    doubtsCount: injured.filter((player) => player.status === "doubtful").length,
    source: "Sofascore players",
  };

  const tournamentName = String(context?.tournamentName || "");
  const isInternational = isSeniorInternationalTournament(tournamentName);
  if (!isInternational) return baseAvailability;

  const extraAvailability = await fetchTransfermarktNationalTeamAvailability(context?.teamName || "");
  return mergeAvailability(baseAvailability, extraAvailability);
}

async function fetchSeasonStats(teamId, tournamentId, seasonId) {
  if (!tournamentId || !seasonId) return null;
  const json = await safeFetch(
    `${SOFA}/team/${teamId}/unique-tournament/${tournamentId}/season/${seasonId}/statistics/overall`
  );
  const stats = json?.statistics;
  if (!stats) return null;
  return {
    avgShotsOn: stats.averageShotsOnTarget || null,
    avgShots: stats.averageShots || null,
    avgPossession: stats.averageBallPossession || null,
    avgCorners: stats.averageCorners || null,
    cleanSheets: stats.cleanSheets || null,
    games: stats.matches || null,
  };
}

async function fetchEventDetails(eventId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}`);
  return json?.event || null;
}

function parseSofaStatisticsItems(eventDetails) {
  const groups = eventDetails?.statistics || eventDetails?.statisticsGroups || [];
  const items = [];
  for (const group of groups || []) {
    for (const row of group?.statisticsItems || group?.items || []) {
      items.push(row);
    }
  }
  return items;
}

function extractSofaTeamStat(items, metricKeys = [], side = "home") {
  const wanted = metricKeys.map((key) => String(key).toLowerCase());
  for (const item of items || []) {
    const key = String(item?.name || item?.key || item?.type || "").toLowerCase();
    if (!wanted.some((wantedKey) => key.includes(wantedKey))) continue;
    const value = side === "home" ? (item?.home ?? item?.value?.home) : (item?.away ?? item?.value?.away);
    const parsed = toFiniteNumber(String(value ?? "").replace("%", "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function buildGoalQuarterStatsFromIncidents(incidents, homeId, awayId) {
  const result = {
    home: emptyGoalQuarters(),
    away: emptyGoalQuarters(),
    total: emptyGoalQuarters(),
  };
  for (const item of incidents || []) {
    const type = String(item?.incidentType || item?.type || "").toLowerCase();
    const klass = String(item?.incidentClass || "").toLowerCase();
    const isGoal = type.includes("goal") || klass.includes("goal");
    if (!isGoal) continue;
    const bucket = quarterBucketFromMinute(item?.time ?? item?.minute ?? item?.displayTime ?? item?.addedTime ?? null);
    const scorerTeamId = String(item?.team?.id || item?.teamId || "");
    const isHomeGoal = scorerTeamId && String(homeId || "") && scorerTeamId === String(homeId || "");
    const isAwayGoal = scorerTeamId && String(awayId || "") && scorerTeamId === String(awayId || "");
    if (isHomeGoal) result.home[bucket] += 1;
    if (isAwayGoal) result.away[bucket] += 1;
    result.total[bucket] += 1;
  }
  return result;
}

function extractPostMatchStatsFromSofa(eventDetails, homeId, awayId) {
  const items = parseSofaStatisticsItems(eventDetails);
  const incidents = eventDetails?.incidents || [];
  const stats = normalizePostMatchStats(
    {
      home: {
        possession: extractSofaTeamStat(items, ["possession"], "home"),
        shots: extractSofaTeamStat(items, ["total shots", "shots total", "shots"], "home"),
        shotsOnTarget: extractSofaTeamStat(items, ["shots on target", "shots on goal"], "home"),
        bigChances: extractSofaTeamStat(items, ["big chances"], "home"),
        corners: extractSofaTeamStat(items, ["corners"], "home"),
        freeKicks: extractSofaTeamStat(items, ["free kicks"], "home"),
        fouls: extractSofaTeamStat(items, ["fouls"], "home"),
      },
      away: {
        possession: extractSofaTeamStat(items, ["possession"], "away"),
        shots: extractSofaTeamStat(items, ["total shots", "shots total", "shots"], "away"),
        shotsOnTarget: extractSofaTeamStat(items, ["shots on target", "shots on goal"], "away"),
        bigChances: extractSofaTeamStat(items, ["big chances"], "away"),
        corners: extractSofaTeamStat(items, ["corners"], "away"),
        freeKicks: extractSofaTeamStat(items, ["free kicks"], "away"),
        fouls: extractSofaTeamStat(items, ["fouls"], "away"),
      },
      goalQuarters: buildGoalQuarterStatsFromIncidents(incidents, homeId, awayId),
    },
    "sofascore-event",
    "event.statistics+incidents"
  );
  return stats;
}

async function fetchJsonWithHeaders(url, headers = {}, timeoutMs = 12000) {
  try {
    const response = await fetchWithTimeout(url, { headers: { Accept: "application/json", ...headers } }, timeoutMs);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchPostMatchStatsFromTheSportsDb(match) {
  const apiKey = String(process.env.THESPORTSDB_API_KEY || "3").trim();
  if (!apiKey) return null;
  const date = String(match?.date || "").trim();
  if (!date) return null;
  const dayFeed = await safeFetch(`${THESPORTSDB_BASE}/${apiKey}/eventsday.php?d=${encodeURIComponent(date)}&s=Soccer`);
  const events = dayFeed?.events || [];
  const homeName = normalizeName(match?.homeTeamName || "");
  const awayName = normalizeName(match?.awayTeamName || "");
  const event = events.find((row) => {
    const h = normalizeName(row?.strHomeTeam || "");
    const a = normalizeName(row?.strAwayTeam || "");
    return h === homeName && a === awayName;
  });
  const idEvent = event?.idEvent;
  if (!idEvent) return null;
  const statsFeed = await safeFetch(`${THESPORTSDB_BASE}/${apiKey}/lookupeventstats.php?id=${idEvent}`);
  const timelineFeed = await safeFetch(`${THESPORTSDB_BASE}/${apiKey}/lookuptimeline.php?id=${idEvent}`);
  const raw = (statsFeed?.eventstats || statsFeed?.event || [])[0] || {};
  const parseHomeAway = (homeKey, awayKey) => ({
    home: toFiniteNumber(raw?.[homeKey]),
    away: toFiniteNumber(raw?.[awayKey]),
  });
  const possession = parseHomeAway("intHomePossession", "intAwayPossession");
  const shots = parseHomeAway("intHomeShots", "intAwayShots");
  const shotsOn = parseHomeAway("intHomeShotsOnGoal", "intAwayShotsOnGoal");
  const corners = parseHomeAway("intHomeCorners", "intAwayCorners");
  const fouls = parseHomeAway("intHomeFouls", "intAwayFouls");
  const freeKicks = parseHomeAway("intHomeFreeKicks", "intAwayFreeKicks");
  const quarterStats = { home: emptyGoalQuarters(), away: emptyGoalQuarters(), total: emptyGoalQuarters() };
  const timeline = timelineFeed?.timeline || [];
  for (const item of timeline) {
    const isGoal = String(item?.strTimeline || "").toLowerCase().includes("goal");
    if (!isGoal) continue;
    const bucket = quarterBucketFromMinute(item?.intTime || item?.strTime || item?.strMinute);
    const side = normalizeName(item?.strTeam || "");
    if (side === homeName) quarterStats.home[bucket] += 1;
    if (side === awayName) quarterStats.away[bucket] += 1;
    quarterStats.total[bucket] += 1;
  }
  const hasAny = [possession.home, possession.away, shots.home, shots.away, shotsOn.home, shotsOn.away].some((n) => Number.isFinite(n));
  if (!hasAny) return null;
  return normalizePostMatchStats(
    {
      home: {
        possession: possession.home,
        shots: shots.home,
        shotsOnTarget: shotsOn.home,
        corners: corners.home,
        fouls: fouls.home,
        freeKicks: freeKicks.home,
      },
      away: {
        possession: possession.away,
        shots: shots.away,
        shotsOnTarget: shotsOn.away,
        corners: corners.away,
        fouls: fouls.away,
        freeKicks: freeKicks.away,
      },
      goalQuarters: quarterStats,
    },
    "thesportsdb",
    `idEvent:${idEvent}`
  );
}

async function fetchPostMatchStatsFromFootballData(match) {
  const apiKey = String(process.env.FOOTBALL_DATA_API_KEY || "").trim();
  if (!apiKey) return null;
  const dateFrom = `${match?.date}T00:00:00Z`;
  const dateTo = `${match?.date}T23:59:59Z`;
  const competitions = String(process.env.FOOTBALL_DATA_COMPETITIONS || "PL,BL1,PD,SA,FL1,ELC,DED,CL,EL,EC").split(",").map((v) => v.trim()).filter(Boolean);
  const homeName = normalizeName(match?.homeTeamName || "");
  const awayName = normalizeName(match?.awayTeamName || "");
  for (const code of competitions) {
    const url = `${FOOTBALL_DATA_BASE}/competitions/${encodeURIComponent(code)}/matches?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}&status=FINISHED`;
    const payload = await fetchJsonWithHeaders(url, { "X-Auth-Token": apiKey }, 14000);
    const matchRow = (payload?.matches || []).find((row) => {
      const h = normalizeName(row?.homeTeam?.name || "");
      const a = normalizeName(row?.awayTeam?.name || "");
      return h === homeName && a === awayName;
    });
    if (!matchRow) continue;
    const stats = matchRow?.statistics || {};
    const homeStats = stats.home || stats.homeTeam || {};
    const awayStats = stats.away || stats.awayTeam || {};
    const normalized = normalizePostMatchStats(
      {
        home: {
          possession: toFiniteNumber(homeStats.ballPossession ?? homeStats.possession),
          shots: toFiniteNumber(homeStats.shots ?? homeStats.totalShots),
          shotsOnTarget: toFiniteNumber(homeStats.shotsOnGoal ?? homeStats.shotsOnTarget),
          corners: toFiniteNumber(homeStats.cornerKicks ?? homeStats.corners),
          freeKicks: toFiniteNumber(homeStats.freeKicks),
          fouls: toFiniteNumber(homeStats.fouls),
          bigChances: toFiniteNumber(homeStats.bigChances),
        },
        away: {
          possession: toFiniteNumber(awayStats.ballPossession ?? awayStats.possession),
          shots: toFiniteNumber(awayStats.shots ?? awayStats.totalShots),
          shotsOnTarget: toFiniteNumber(awayStats.shotsOnGoal ?? awayStats.shotsOnTarget),
          corners: toFiniteNumber(awayStats.cornerKicks ?? awayStats.corners),
          freeKicks: toFiniteNumber(awayStats.freeKicks),
          fouls: toFiniteNumber(awayStats.fouls),
          bigChances: toFiniteNumber(awayStats.bigChances),
        },
      },
      "football-data.org",
      `competition:${code}`
    );
    const hasAny = Object.values(normalized.home).concat(Object.values(normalized.away)).some((v) => Number.isFinite(Number(v)));
    if (hasAny) return normalized;
  }
  return null;
}

function statsCoverageScore(stats) {
  if (!stats) return 0;
  const keys = ["possession", "shots", "shotsOnTarget", "bigChances", "corners", "freeKicks", "fouls"];
  const total = keys.length * 2;
  let hit = 0;
  for (const key of keys) {
    if (Number.isFinite(Number(stats?.home?.[key]))) hit += 1;
    if (Number.isFinite(Number(stats?.away?.[key]))) hit += 1;
  }
  return Number((hit / Math.max(total, 1)).toFixed(2));
}

async function buildPostMatchStatsWithFallback({ match, eventDetails, homeId, awayId }) {
  const sofaStats = extractPostMatchStatsFromSofa(eventDetails, homeId, awayId);
  if (statsCoverageScore(sofaStats) >= 0.5) return { ...sofaStats, coverageScore: statsCoverageScore(sofaStats), fallbackUsed: false };
  const sportsDbStats = await fetchPostMatchStatsFromTheSportsDb(match);
  if (statsCoverageScore(sportsDbStats) >= 0.5) return { ...sportsDbStats, coverageScore: statsCoverageScore(sportsDbStats), fallbackUsed: true };
  const footballDataStats = await fetchPostMatchStatsFromFootballData(match);
  if (statsCoverageScore(footballDataStats) > 0) return { ...footballDataStats, coverageScore: statsCoverageScore(footballDataStats), fallbackUsed: true };
  if (sofaStats) return { ...sofaStats, coverageScore: statsCoverageScore(sofaStats), fallbackUsed: true };
  return null;
}

function extractReferee(eventDetails) {
  const referee =
    eventDetails?.referee ||
    eventDetails?.eventOfficials?.find?.((item) => String(item?.role || "").toLowerCase().includes("ref")) ||
    null;

  if (!referee) return null;

  return {
    id: referee.id ? String(referee.id) : "",
    name: referee.name || referee.fullName || "Onbekend",
    country: referee.country?.name || referee.nationality || null,
  };
}

function getReliabilityBucket(input) {
  const league = String(input?.league || "").toLowerCase();
  const round = String(input?.roundLabel || "").toLowerCase();
  const summary = String(input?.context?.summary || input?.context?.type || "").toLowerCase();
  const leagueType = String(input?.leagueType || "").toLowerCase();
  const isInternational =
    league.startsWith("europe -") &&
    (league.includes("nations league") ||
      league.includes("qualification") ||
      league.includes("friendly") ||
      league.includes("international") ||
      league.includes("world cup") ||
      league.includes("championship"));
  const isQualification =
    isInternational &&
    (league.includes("qualification") || round.includes("qualification") || summary.includes("qualification"));
  const isFriendly =
    isInternational && (league.includes("friendly") || league.includes("international friendly") || summary.includes("friendly"));
  const isTwoLegKnockout =
    !!input?.aggregate?.active ||
    summary.includes("tweeluik") ||
    summary.includes("two-leg") ||
    summary.includes("aggregate");
  const isCupRound =
    leagueType === "cup" ||
    summary.includes("knock") ||
    summary.includes("play-off") ||
    /final|semi|quarter|round of|achtste|kwart|halve/.test(round);

  if (isTwoLegKnockout) return "two-leg-knockout";
  if (isQualification) return "qualification";
  if (isFriendly) return "friendly";
  if (isCupRound) return "cup";
  if (isInternational) return "interland";
  return "league";
}

function buildLeagueReliabilityFromReviews(reviews) {
  const leagues = {};

  for (const review of Object.values(reviews || {})) {
    const league = String(review?.league || "").trim();
    if (!league) continue;
    if (!leagues[league]) {
      leagues[league] = {
        league,
        matches: 0,
        outcomeHits: 0,
        exactHits: 0,
        totalGoalError: 0,
      };
    }
    leagues[league].matches += 1;
    leagues[league].outcomeHits += review.outcomeHit ? 1 : 0;
    leagues[league].exactHits += review.exactHit ? 1 : 0;
    leagues[league].totalGoalError += Number(review.totalGoalError || 0);
  }

  for (const value of Object.values(leagues)) {
    const matches = Math.max(Number(value.matches || 0), 1);
    const outcomeHitRate = Number((Number(value.outcomeHits || 0) / matches).toFixed(2));
    const exactHitRate = Number((Number(value.exactHits || 0) / matches).toFixed(2));
    const avgGoalError = Number((Number(value.totalGoalError || 0) / matches).toFixed(2));
    let reliability = Number((outcomeHitRate * 0.68 + exactHitRate * 0.22 + Math.max(0, 1 - avgGoalError / 4) * 0.1).toFixed(2));

    if (String(value.league || "").startsWith("Europe -")) {
      reliability = Number((reliability * 0.96).toFixed(2));
    }

    value.outcomeHitRate = outcomeHitRate;
    value.exactHitRate = exactHitRate;
    value.avgGoalError = avgGoalError;
    value.reliabilityScore = reliability;
    value.summary = `${value.league}: ${Math.round(reliability * 100)}% betrouwbaar op ${value.matches} reviews`;
  }

  return leagues;
}

function buildPhaseReliabilityFromReviews(reviews) {
  const phases = {};

  for (const review of Object.values(reviews || {})) {
    const phase = String(review?.phaseBucket || "league").trim();
    if (!phases[phase]) {
      phases[phase] = {
        phase,
        matches: 0,
        outcomeHits: 0,
        exactHits: 0,
        totalGoalError: 0,
      };
    }
    phases[phase].matches += 1;
    phases[phase].outcomeHits += review.outcomeHit ? 1 : 0;
    phases[phase].exactHits += review.exactHit ? 1 : 0;
    phases[phase].totalGoalError += Number(review.totalGoalError || 0);
  }

  for (const value of Object.values(phases)) {
    const matches = Math.max(Number(value.matches || 0), 1);
    const outcomeHitRate = Number((Number(value.outcomeHits || 0) / matches).toFixed(2));
    const exactHitRate = Number((Number(value.exactHits || 0) / matches).toFixed(2));
    const avgGoalError = Number((Number(value.totalGoalError || 0) / matches).toFixed(2));
    const reliability = Number(
      (outcomeHitRate * 0.68 + exactHitRate * 0.22 + Math.max(0, 1 - avgGoalError / 4) * 0.1).toFixed(2)
    );

    value.outcomeHitRate = outcomeHitRate;
    value.exactHitRate = exactHitRate;
    value.avgGoalError = avgGoalError;
    value.reliabilityScore = reliability;
    value.summary = `${value.phase}: ${Math.round(reliability * 100)}% betrouwbaar op ${value.matches} reviews`;
  }

  return phases;
}

function buildFeatureDiagnosticsFromReviews(reviews) {
  const items = Object.values(reviews || {});
  const failureCounts = {};
  const phaseMap = {};
  const topConfidence = {
    matches: 0,
    exactHits: 0,
    outcomeHits: 0,
    probabilityHits: 0,
    totalGoalError: 0,
    exactRank1Hits: 0,
    outcomeRank1Hits: 0,
    rank1Matches: 0,
  };
  let exactHits = 0;
  let outcomeHits = 0;
  let probabilityHits = 0;
  let totalGoalError = 0;

  for (const review of items) {
    if (review.exactHit) exactHits += 1;
    if (review.outcomeHit) outcomeHits += 1;
    if (review.probabilityOutcomeHit) probabilityHits += 1;
    totalGoalError += Number(review.totalGoalError || 0);

    if (review.topConfidencePick) {
      topConfidence.matches += 1;
      topConfidence.totalGoalError += Number(review.totalGoalError || 0);
      if (review.exactHit) topConfidence.exactHits += 1;
      if (review.outcomeHit) topConfidence.outcomeHits += 1;
      if (review.probabilityOutcomeHit) topConfidence.probabilityHits += 1;
      if (Number(review.bestBetRank || 0) === 1) {
        topConfidence.rank1Matches += 1;
        if (review.exactHit) topConfidence.exactRank1Hits += 1;
        if (review.outcomeHit) topConfidence.outcomeRank1Hits += 1;
      }
    }

    const phase = String(review.phaseBucket || "unknown");
    if (!phaseMap[phase]) phaseMap[phase] = { phase, matches: 0, exactHits: 0, outcomeHits: 0 };
    phaseMap[phase].matches += 1;
    if (review.exactHit) phaseMap[phase].exactHits += 1;
    if (review.outcomeHit) phaseMap[phase].outcomeHits += 1;

    for (const signal of review.failureSignals || []) {
      failureCounts[signal] = Number(failureCounts[signal] || 0) + 1;
    }
  }

  const total = items.length || 1;
  const topFailureSignals = Object.entries(failureCounts)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 6)
    .map(([signal, count]) => ({ signal, count: Number(count) }));
  const phaseBreakdown = Object.values(phaseMap)
    .map((item) => ({
      ...item,
      exactHitRate: Number((item.exactHits / Math.max(item.matches, 1)).toFixed(2)),
      outcomeHitRate: Number((item.outcomeHits / Math.max(item.matches, 1)).toFixed(2)),
    }))
    .sort((a, b) => b.matches - a.matches);

  return {
    reviews: items.length,
    exactHitRate: Number((exactHits / total).toFixed(3)),
    outcomeHitRate: Number((outcomeHits / total).toFixed(3)),
    probabilityOutcomeHitRate: Number((probabilityHits / total).toFixed(3)),
    avgGoalError: Number((totalGoalError / total).toFixed(2)),
    topConfidence: {
      matches: topConfidence.matches,
      exactHitRate: Number((topConfidence.exactHits / Math.max(topConfidence.matches, 1)).toFixed(3)),
      outcomeHitRate: Number((topConfidence.outcomeHits / Math.max(topConfidence.matches, 1)).toFixed(3)),
      probabilityOutcomeHitRate: Number((topConfidence.probabilityHits / Math.max(topConfidence.matches, 1)).toFixed(3)),
      avgGoalError: Number((topConfidence.totalGoalError / Math.max(topConfidence.matches, 1)).toFixed(2)),
      rank1ExactHitRate: Number((topConfidence.exactRank1Hits / Math.max(topConfidence.rank1Matches, 1)).toFixed(3)),
      rank1OutcomeHitRate: Number((topConfidence.outcomeRank1Hits / Math.max(topConfidence.rank1Matches, 1)).toFixed(3)),
      versusOverallOutcomeDelta: Number(
        (
          topConfidence.outcomeHits / Math.max(topConfidence.matches, 1) -
          outcomeHits / Math.max(items.length, 1)
        ).toFixed(3)
      ),
    },
    topFailureSignals,
    phaseBreakdown,
    summary:
      items.length > 0
        ? `Reviewdiagnose: exact ${Math.round((exactHits / total) * 100)}%, uitkomst ${Math.round((outcomeHits / total) * 100)}%, topkans ${Math.round((probabilityHits / total) * 100)}%.`
        : "Nog geen reviewdiagnose beschikbaar.",
  };
}

function buildDataAnomalyReport(store, todayKey) {
  const anomalies = [];
  const seen = new Set();
  const todayMs = Date.parse(`${todayKey}T12:00:00Z`);
  const allMatches = Object.entries(store.matches || {}).flatMap(([date, matches]) =>
    (matches || []).map((match) => ({ ...match, _dateKey: date }))
  );

  const add = (type, severity, message, sample) => {
    anomalies.push({ type, severity, message, sample: (sample || []).slice(0, 8) });
  };

  const duplicateSample = [];
  const missingPastScores = [];
  const pendingResultBackfill = [];
  const missingPredictions = [];
  const missingH2h = [];
  const missingLogos = [];
  const unrealisticScores = [];

  const predictionIds = new Set(
    Object.values(store.predictions || {})
      .flatMap((items) => (Array.isArray(items) ? items : []))
      .map((prediction) => prediction?.matchId)
      .filter(Boolean)
  );

  for (const match of allMatches) {
    const key = `${match._dateKey}|${normalizeName(match.league)}|${normalizeName(match.homeTeamName)}|${normalizeName(match.awayTeamName)}`;
    if (seen.has(key)) duplicateSample.push(`${match._dateKey}: ${match.homeTeamName} - ${match.awayTeamName}`);
    seen.add(key);

    const kickoffMs = Date.parse(match.kickoff || match.date || `${match._dateKey}T12:00:00Z`);
    const isPast = Number.isFinite(kickoffMs) && kickoffMs < todayMs - 3 * 60 * 60 * 1000;
    const status = String(match.status || "").toUpperCase();
    const hasScore = String(match.score || "").includes("-");
    if (isPast && !hasScore && match.resultPending) {
      pendingResultBackfill.push(`${match._dateKey}: ${match.homeTeamName} - ${match.awayTeamName}`);
    } else if (isPast && !hasScore && status !== "POSTPONED" && status !== "CANCELLED") {
      missingPastScores.push(`${match._dateKey}: ${match.homeTeamName} - ${match.awayTeamName}`);
    }
    if (!predictionIds.has(match.id)) missingPredictions.push(`${match._dateKey}: ${match.homeTeamName} - ${match.awayTeamName}`);
    if (!match.h2h?.played) missingH2h.push(`${match._dateKey}: ${match.homeTeamName} - ${match.awayTeamName}`);
    if (!match.homeLogo || !match.awayLogo) missingLogos.push(`${match._dateKey}: ${match.homeTeamName} - ${match.awayTeamName}`);
    if (hasScore) {
      const [home, away] = String(match.score).split("-").map(Number);
      if (!Number.isFinite(home) || !Number.isFinite(away) || home > 12 || away > 12) {
        unrealisticScores.push(`${match._dateKey}: ${match.homeTeamName} - ${match.awayTeamName} (${match.score})`);
      }
    }
  }

  if (duplicateSample.length) add("duplicates", "medium", `${duplicateSample.length} mogelijke dubbele wedstrijd(en).`, duplicateSample);
  if (missingPastScores.length) add("missing_past_scores", "high", `${missingPastScores.length} gespeelde wedstrijd(en) missen nog eindstand.`, missingPastScores);
  if (pendingResultBackfill.length) add("pending_result_backfill", "medium", `${pendingResultBackfill.length} oude wedstrijd(en) wachten op betrouwbare resultaatbackfill.`, pendingResultBackfill);
  if (missingPredictions.length) add("missing_predictions", "medium", `${missingPredictions.length} wedstrijd(en) missen voorspelling.`, missingPredictions);
  if (missingH2h.length) add("missing_h2h", "low", `${missingH2h.length} wedstrijd(en) missen H2H-historie.`, missingH2h);
  if (missingLogos.length) add("missing_logos", "low", `${missingLogos.length} wedstrijd(en) missen minimaal een logo.`, missingLogos);
  if (unrealisticScores.length) add("unrealistic_scores", "high", `${unrealisticScores.length} score(s) lijken onrealistisch of corrupt.`, unrealisticScores);

  const criticalCount = anomalies.filter((item) => item.severity === "high").length;
  return {
    generatedAt: new Date().toISOString(),
    totalMatches: allMatches.length,
    totalAnomalies: anomalies.length,
    criticalCount,
    anomalies,
    summary:
      anomalies.length > 0
        ? `Datacontrole: ${anomalies.length} issuegroep(en), ${criticalCount} kritisch.`
        : "Datacontrole: geen opvallende anomalieën gevonden.",
  };
}

function buildLeagueReliabilityEdge(input) {
  const reliability = input.leagueReliability || null;
  if (!reliability) {
    return {
      summary: "geen competitiereviewdata",
      reliabilityScore: null,
      outcomeHitRate: null,
      avgGoalError: null,
    };
  }

  return {
    summary: reliability.summary,
    reliabilityScore: Number(reliability.reliabilityScore || 0),
    outcomeHitRate: Number(reliability.outcomeHitRate || 0),
    exactHitRate: Number(reliability.exactHitRate || 0),
    avgGoalError: Number(reliability.avgGoalError || 0),
    matches: Number(reliability.matches || 0),
  };
}

function buildPhaseReliabilityEdge(input) {
  const reliability = input.phaseReliability || null;
  if (!reliability) {
    return {
      summary: "geen fase-reviewdata",
      reliabilityScore: null,
      outcomeHitRate: null,
      exactHitRate: null,
      avgGoalError: null,
      matches: 0,
    };
  }

  return {
    summary: reliability.summary,
    reliabilityScore: Number(reliability.reliabilityScore || 0),
    outcomeHitRate: Number(reliability.outcomeHitRate || 0),
    exactHitRate: Number(reliability.exactHitRate || 0),
    avgGoalError: Number(reliability.avgGoalError || 0),
    matches: Number(reliability.matches || 0),
  };
}

function buildRefereeProfile(referee, homeRecent, awayRecent, marketCalibration, historicalRefereeProfile) {
  if (!referee?.name) return null;
  const homeCards = Number(homeRecent?.yellowCardRate || 0) + Number(homeRecent?.redCardRate || 0) * 1.8;
  const awayCards = Number(awayRecent?.yellowCardRate || 0) + Number(awayRecent?.redCardRate || 0) * 1.8;
  const estimatedCardsTrend = Number(((homeCards + awayCards) / 2).toFixed(2));
  const estimatedPenaltyBase = Number(
    (
      Number(homeRecent?.over25Rate || 0.45) * 0.12 +
      Number(awayRecent?.over25Rate || 0.45) * 0.12 +
      Math.max(0, Number(marketCalibration?.overperformanceDiff || 0)) * 0.04
    ).toFixed(2)
  );
  const cardsTrend = Number(
    historicalRefereeProfile?.avgCards != null ? historicalRefereeProfile.avgCards : estimatedCardsTrend
  );
  const estimatedPenaltyRate =
    historicalRefereeProfile?.penaltyRate != null ? historicalRefereeProfile.penaltyRate : estimatedPenaltyBase;
  const strictness = cardsTrend >= 4.8 ? "streng" : cardsTrend >= 3.2 ? "gemiddeld" : "laat doorspelen";
  const source = historicalRefereeProfile ? "football-data.co.uk referee history" : "team-profiel schatting";

  return {
    ...referee,
    cardsTrend,
    estimatedPenaltyRate,
    strictness,
    source,
    matches: Number(historicalRefereeProfile?.matches || 0),
    summary: historicalRefereeProfile
      ? `${referee.name}: ${strictness}, ${cardsTrend} kaarten gem. uit ${historicalRefereeProfile.matches} duels`
      : `${referee.name}: ${strictness}, kaartenritme ${cardsTrend}, penalty-kans ${Math.round(estimatedPenaltyRate * 100)}%`,
  };
}

async function fetchLineupSummary(eventId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/lineups`);
  if (!json) return null;

  const convert = (lineupTeam) => {
    if (!lineupTeam) return null;
    const starters = (lineupTeam.players || []).filter((player) => player?.substitute === false);
    const bench = (lineupTeam.players || []).filter((player) => player?.substitute === true);
    const keeper =
      starters.find((player) => String(player?.player?.position || player?.position || "").toUpperCase().startsWith("G")) ||
      starters.find((player) => String(player?.position || "").toUpperCase().startsWith("G")) ||
      null;
    const rated = starters
      .map((player) => Number(player.player?.rating || player.rating || 0))
      .filter((rating) => rating > 0);
    return {
      formation: lineupTeam.formation || null,
      starters: starters.length,
      bench: bench.length,
      avgRating: rated.length
        ? Number((rated.reduce((sum, rating) => sum + rating, 0) / rated.length).toFixed(2))
        : null,
      keeperName: keeper?.player?.name || keeper?.name || null,
      keeperRating: keeper ? Number(keeper.player?.rating || keeper.rating || 0) || null : null,
      confirmed: starters.length >= 10,
    };
  };

  const home = convert(json.home || json.homeTeam);
  const away = convert(json.away || json.awayTeam);
  if (!home && !away) return null;

  return {
    home,
    away,
    confirmed: !!(home?.confirmed && away?.confirmed),
  };
}

async function fetchH2H(eventId, currentHomeId, currentAwayId, tournamentId, seasonId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/h2h`);
  const raw = json?.events || [];

  const finishedAll = raw
    .filter((event) => event.status?.type === "finished")
    .sort((a, b) => Number(a.startTimestamp || 0) - Number(b.startTimestamp || 0));

  const finishedSameCompetition = finishedAll
    .filter((event) => {
      if (!tournamentId || !seasonId) return true;
      const eventTournamentId =
        event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id || event.tournament?.id;
      const eventSeasonId = event.season?.id;
      return eventTournamentId === tournamentId && eventSeasonId === seasonId;
    })
    .sort((a, b) => Number(a.startTimestamp || 0) - Number(b.startTimestamp || 0));

  const merged = [];
  const seenEventIds = new Set();
  for (const event of [...finishedSameCompetition, ...finishedAll]) {
    const eventKey = String(event.id || `${event.startTimestamp || ""}_${event.homeTeam?.id || ""}_${event.awayTeam?.id || ""}`);
    if (seenEventIds.has(eventKey)) continue;
    seenEventIds.add(eventKey);
    merged.push(event);
  }

  const finished = merged
    .sort((a, b) => Number(a.startTimestamp || 0) - Number(b.startTimestamp || 0))
    .slice(-8);

  if (!finished.length) {
    return { played: 0, homeWins: 0, draws: 0, awayWins: 0, results: [], status: "empty" };
  }

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  const results = [];

  for (const event of finished) {
    const homeGoals = event.homeScore?.current;
    const awayGoals = event.awayScore?.current;
    if (homeGoals == null || awayGoals == null) continue;

    const winnerId =
      homeGoals === awayGoals
        ? ""
        : homeGoals > awayGoals
          ? String(event.homeTeam?.id || "")
          : String(event.awayTeam?.id || "");

    if (homeGoals === awayGoals) draws += 1;
    else if (winnerId === String(currentHomeId || "")) homeWins += 1;
    else if (winnerId === String(currentAwayId || "")) awayWins += 1;

    results.push({
      eventId: event.id,
      date: event.startTimestamp
        ? new Date(event.startTimestamp * 1000).toISOString().split("T")[0]
        : null,
      tournamentId:
        event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id || event.tournament?.id || null,
      seasonId: event.season?.id || null,
      homeTeamId: String(event.homeTeam?.id || ""),
      awayTeamId: String(event.awayTeam?.id || ""),
      home: event.homeTeam?.name || "Home",
      away: event.awayTeam?.name || "Away",
      score: `${homeGoals}-${awayGoals}`,
      winnerId,
    });
  }

  return {
    played: results.length,
    homeWins,
    draws,
    awayWins,
    sameCompetitionPlayed: finishedSameCompetition.length,
    weightedRecentBalance: calculateRecentH2HBalance({ results }, currentHomeId, currentAwayId),
    results,
    status:
      results.length
        ? finishedSameCompetition.length
          ? "loaded"
          : "all-competitions"
        : "empty",
  };
}

function getCoords(eventDetails) {
  const venue = eventDetails?.venue || {};
  const loc = venue.location || venue.coordinates || eventDetails?.venueCoordinates;
  if (!loc) return null;
  const lat = Number(loc.latitude ?? loc.lat);
  const lon = Number(loc.longitude ?? loc.lng ?? loc.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

async function fetchWeather(lat, lon, kickoffISO) {
  if (!kickoffISO) return null;
  const kickoff = new Date(kickoffISO);
  const date = kickoff.toISOString().split("T")[0];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,precipitation,windspeed_10m&timezone=auto&start_date=${date}&end_date=${date}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const json = await response.json();
    const times = json?.hourly?.time || [];
    if (!times.length) return null;
    let bestIndex = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i += 1) {
      const diff = Math.abs(new Date(times[i]).getTime() - kickoff.getTime());
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    }

    const windSpeed = json.hourly.windspeed_10m?.[bestIndex] ?? null;
    const precipitationProbability = json.hourly.precipitation_probability?.[bestIndex] ?? null;
    const precipitation = json.hourly.precipitation?.[bestIndex] ?? null;

    return {
      temperature: json.hourly.temperature_2m?.[bestIndex] ?? null,
      windSpeed,
      precipitationProbability,
      precipitation,
      riskLevel:
        Number(windSpeed || 0) >= 28 || Number(precipitationProbability || 0) >= 70
          ? "high"
          : Number(windSpeed || 0) >= 20 || Number(precipitationProbability || 0) >= 50
            ? "medium"
            : "low",
    };
  } catch {
    return null;
  }
}

function calcRestDays(lastMatchKickoff, currentKickoff) {
  if (!lastMatchKickoff || !currentKickoff) return null;
  const diff = new Date(currentKickoff).getTime() - new Date(lastMatchKickoff).getTime();
  return diff > 0 ? Number((diff / 86400000).toFixed(1)) : null;
}

async function fetchClubEloSnapshot(dateISO) {
  const urls = [`https://api.clubelo.com/${dateISO}`, `http://api.clubelo.com/${dateISO}`];

  let text = null;
  for (const url of urls) {
    text = await safeFetchText(url);
    if (text) break;
  }

  if (!text) return null;
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const headers = lines[0].split(",");
  const clubIndex = headers.findIndex((header) => /club/i.test(header));
  const eloIndex = headers.findIndex((header) => /^elo$/i.test(header));
  if (clubIndex < 0 || eloIndex < 0) return null;

  const map = {};
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    const club = parts[clubIndex];
    const elo = Number(parts[eloIndex]);
    if (!club || !Number.isFinite(elo)) continue;
    for (const variant of buildPossibleNames(club)) {
      map[variant] = elo;
    }
  }

  return map;
}

function lookupClubElo(snapshot, teamName) {
  if (!snapshot) return null;
  for (const variant of buildPossibleNames(teamName)) {
    if (snapshot[variant] != null) return Number(snapshot[variant]);
  }
  return null;
}

function inferRivalry(homeName, awayName, homeCountry, awayCountry) {
  const home = normalizeName(homeName);
  const away = normalizeName(awayName);
  const rivalryPairs = [
    ["ajax", "feyenoord"],
    ["ajax", "psv"],
    ["feyenoord", "psv"],
    ["arsenal", "tottenham"],
    ["liverpool", "everton"],
    ["manchester united", "manchester city"],
    ["barcelona", "real madrid"],
    ["inter", "milan"],
    ["lazio", "roma"],
    ["celtic", "rangers"],
  ];

  for (const [a, b] of rivalryPairs) {
    if ((home.includes(a) && away.includes(b)) || (home.includes(b) && away.includes(a))) {
      return "rivaliteit";
    }
  }

  if (homeCountry && awayCountry && homeCountry === awayCountry) {
    const firstHomeWord = home.split(" ")[0];
    const firstAwayWord = away.split(" ")[0];
    if (firstHomeWord && firstAwayWord && firstHomeWord === firstAwayWord) {
      return "streekduel";
    }
  }

  return null;
}

function extractRoundLabel(eventDetails) {
  return (
    eventDetails?.roundInfo?.name ||
    eventDetails?.roundInfo?.roundType ||
    eventDetails?.roundInfo?.round ||
    eventDetails?.roundInfo?.cupRoundType ||
    null
  );
}

function buildAggregateInfo(event, eventDetails, h2h, fallbackPreviousLeg = null) {
  const bbcAggregate = event?.bbcMeta?.aggregate || null;
  const results = h2h?.results || [];
  const currentEventId = Number(event.id || 0);
  const previousLeg = [...results]
    .filter((result) => Number(result.eventId || 0) !== currentEventId)
    .filter((result) => {
      const d = result.date ? new Date(result.date).getTime() : 0;
      const now = Number(event.startTimestamp || 0) * 1000;
      return d > 0 && now > 0 && now - d < 160 * 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0] || fallbackPreviousLeg;

  const label = String(
    eventDetails?.roundInfo?.cupRoundType ||
      eventDetails?.roundInfo?.name ||
      eventDetails?.roundInfo?.roundType ||
      ""
  ).toLowerCase();
  const isKnockoutHint =
    label.includes("round") ||
    label.includes("play") ||
    label.includes("quarter") ||
    label.includes("semi") ||
    label.includes("final") ||
    label.includes("knockout") ||
    label.includes("qualif");

  if (!previousLeg && !isKnockoutHint && !bbcAggregate) return null;

  let firstLegHomeGoals = 0;
  let firstLegAwayGoals = 0;
  let firstLegText = null;
  if (bbcAggregate) {
    firstLegHomeGoals = Number(bbcAggregate.homeAggregateBeforeMatch || 0);
    firstLegAwayGoals = Number(bbcAggregate.awayAggregateBeforeMatch || 0);
    firstLegText = bbcAggregate.previousLegText || bbcAggregate.aggregateText || null;
  } else if (previousLeg?.score) {
    const [prevHomeGoals, prevAwayGoals] = previousLeg.score.split("-").map(Number);
    if (!Number.isNaN(prevHomeGoals) && !Number.isNaN(prevAwayGoals)) {
      const currentHomeId = String(event.homeTeam?.id || "");
      if (String(previousLeg.homeTeamId || "") === currentHomeId) {
        firstLegHomeGoals = prevHomeGoals;
        firstLegAwayGoals = prevAwayGoals;
      } else if (String(previousLeg.awayTeamId || "") === currentHomeId) {
        firstLegHomeGoals = prevAwayGoals;
        firstLegAwayGoals = prevHomeGoals;
      }
      firstLegText = `${previousLeg.home} ${previousLeg.score} ${previousLeg.away}`;
    }
  }

  const currentHomeGoals = Number(event.homeScore?.current || 0);
  const currentAwayGoals = Number(event.awayScore?.current || 0);
  const homeAggregate = firstLegHomeGoals + currentHomeGoals;
  const awayAggregate = firstLegAwayGoals + currentAwayGoals;
  const leader =
    homeAggregate === awayAggregate
      ? null
      : homeAggregate > awayAggregate
        ? event.homeTeam?.name || null
        : event.awayTeam?.name || null;

  return {
    active: !!previousLeg || isKnockoutHint || !!bbcAggregate,
    firstLegScore: bbcAggregate?.previousLegScore || previousLeg?.score || null,
    firstLegText,
    aggregateScore: `${homeAggregate}-${awayAggregate}`,
    homeAggregate,
    awayAggregate,
    currentHomeGoals,
    currentAwayGoals,
    leader,
    roundLabel: extractRoundLabel(eventDetails),
    note:
      leader && (currentHomeGoals > 0 || currentAwayGoals > 0 || previousLeg || bbcAggregate)
        ? `${leader} ligt voor in het tweeluik`
        : "Tweeluik / knock-out context",
  };
}

function buildContext(matchInput) {
  const homeZone = getZoneForPosition(matchInput.standingMeta, matchInput.homePos);
  const awayZone = getZoneForPosition(matchInput.standingMeta, matchInput.awayPos);
  const rivalry = inferRivalry(
    matchInput.homeTeamName,
    matchInput.awayTeamName,
    matchInput.homeCountry,
    matchInput.awayCountry
  );

  const notes = [];
  if (homeZone?.key === "relegation" || awayZone?.key === "relegation") notes.push("degradatiedruk");
  if (homeZone?.key === "ucl" || awayZone?.key === "ucl" || homeZone?.key === "promotion" || awayZone?.key === "promotion") notes.push("topstrijd");
  if (homeZone?.key === "playoffs" || awayZone?.key === "playoffs" || homeZone?.key === "period" || awayZone?.key === "period") notes.push("play-off druk");
  if (matchInput.aggregate?.active) notes.push("tweeluik");
  if (matchInput.leagueType === "cup") notes.push("knock-out");
  if (rivalry) notes.push(rivalry);

  return {
    homeZone: homeZone?.label || null,
    awayZone: awayZone?.label || null,
    rivalry,
    summary: notes.length ? notes.join(" - ") : null,
    stakes:
      notes.length > 0
        ? notes.join(", ")
        : matchInput.homePos && matchInput.awayPos
          ? `stand posities ${matchInput.homePos} en ${matchInput.awayPos}`
          : null,
  };
}

function pickHomeStrength(homeRecent) {
  const split = homeRecent?.splits?.home || emptySplit();
  return split.games > 0 ? split : emptySplit();
}

function pickAwayStrength(awayRecent) {
  const split = awayRecent?.splits?.away || emptySplit();
  return split.games > 0 ? split : emptySplit();
}

function buildHomeAwayEdge(homeRecent, awayRecent) {
  const home = pickHomeStrength(homeRecent);
  const away = pickAwayStrength(awayRecent);
  return Number(((home.avgScored - away.avgConceded) + (away.avgScored - home.avgConceded)).toFixed(2));
}

function findPreviousLegFromRecent(
  homeRecent,
  awayRecent,
  currentHomeId,
  currentAwayId,
  currentHomeName,
  currentAwayName,
  tournamentId,
  seasonId,
  currentEventId
) {
  const combined = [
    ...(homeRecent?.recentMatches || []),
    ...(awayRecent?.recentMatches || []),
  ];

  const homeNameNorm = normalizeName(currentHomeName);
  const awayNameNorm = normalizeName(currentAwayName);

  const match = combined.find((item) => {
    if (String(item.eventId || "") === String(currentEventId || "")) return false;
    if (tournamentId && item.tournamentId && item.tournamentId !== tournamentId) return false;
    if (seasonId && item.seasonId && item.seasonId !== seasonId) return false;
    const opponentIdMatch =
      String(item.opponentId || "") === String(currentAwayId || "") ||
      String(item.opponentId || "") === String(currentHomeId || "");
    const opponentNameNorm = normalizeName(item.opponent || "");
    const opponentNameMatch =
      opponentNameNorm === homeNameNorm || opponentNameNorm === awayNameNorm;
    return (
      opponentIdMatch || opponentNameMatch
    );
  });

  if (!match?.score) return null;

  const [goalsFor, goalsAgainst] = String(match.score).split("-").map(Number);
  if (Number.isNaN(goalsFor) || Number.isNaN(goalsAgainst)) return null;

  const currentHomeWasHome = String(match.opponentId || "") === String(currentAwayId || "");
  const homeTeamId = currentHomeWasHome ? String(currentHomeId || "") : String(currentAwayId || "");
  const awayTeamId = currentHomeWasHome ? String(currentAwayId || "") : String(currentHomeId || "");
  const home = currentHomeWasHome ? currentHomeName : currentAwayName;
  const away = currentHomeWasHome ? currentAwayName : currentHomeName;

  return {
    eventId: match.eventId || null,
    date: match.date || null,
    homeTeamId,
    awayTeamId,
    home,
    away,
    score: `${goalsFor}-${goalsAgainst}`,
  };
}

function buildH2HFromAggregateMeta(event, homeId, awayId, homeName, awayName, currentDate) {
  const aggregate = event?.bbcMeta?.aggregate || event?.curatedMeta?.aggregate || null;
  if (!aggregate?.previousLegScore) return null;
  const [homeGoals, awayGoals] = String(aggregate.previousLegScore).split("-").map(Number);
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
  return {
    eventId: `${event?.id || "aggregate"}-previous-leg`,
    date: addDaysToDateKey(currentDate, -7),
    homeTeamId: String(homeId || ""),
    awayTeamId: String(awayId || ""),
    home: homeName,
    away: awayName,
    score: `${homeGoals}-${awayGoals}`,
    winnerId: homeGoals === awayGoals ? "" : homeGoals > awayGoals ? String(homeId || normalizeName(homeName)) : String(awayId || normalizeName(awayName)),
    source: "bbc-aggregate",
  };
}

function lookupCuratedH2HBackfill(homeName, awayName, homeId, awayId) {
  const pairKey = buildPairKey(homeName, awayName);
  const raw = CURATED_H2H_BACKFILL[pairKey] || [];
  if (!raw.length) return null;

  const homeKey = String(homeId || normalizeName(homeName));
  const awayKey = String(awayId || normalizeName(awayName));
  const homeVariants = buildPossibleNames(homeName);
  const awayVariants = buildPossibleNames(awayName);
  const results = raw
    .map((item) => {
      const [homeGoals, awayGoals] = String(item.score || "").split("-").map(Number);
      if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
      const itemHomeVariants = buildPossibleNames(item.home);
      const itemAwayVariants = buildPossibleNames(item.away);
      const itemHomeIsCurrentHome = itemHomeVariants.some((variant) => homeVariants.includes(variant));
      const itemAwayIsCurrentAway = itemAwayVariants.some((variant) => awayVariants.includes(variant));
      const itemHomeIsCurrentAway = itemHomeVariants.some((variant) => awayVariants.includes(variant));
      const itemAwayIsCurrentHome = itemAwayVariants.some((variant) => homeVariants.includes(variant));
      const winnerId =
        homeGoals === awayGoals
          ? ""
          : homeGoals > awayGoals
            ? itemHomeIsCurrentHome
              ? homeKey
              : itemHomeIsCurrentAway
                ? awayKey
                : normalizeName(item.home)
            : itemAwayIsCurrentAway
              ? awayKey
              : itemAwayIsCurrentHome
                ? homeKey
                : normalizeName(item.away);

      return {
        date: item.date,
        home: item.home,
        away: item.away,
        homeTeamId: itemHomeIsCurrentHome ? homeKey : itemHomeIsCurrentAway ? awayKey : "",
        awayTeamId: itemAwayIsCurrentAway ? awayKey : itemAwayIsCurrentHome ? homeKey : "",
        score: item.score,
        winnerId,
        source: item.source || "curated-h2h",
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .slice(-5);

  if (!results.length) return null;
  return {
    played: results.length,
    homeWins: results.filter((item) => String(item.winnerId || "") === homeKey).length,
    draws: results.filter((item) => !item.winnerId).length,
    awayWins: results.filter((item) => String(item.winnerId || "") === awayKey).length,
    sameCompetitionPlayed: 0,
    weightedRecentBalance: calculateRecentH2HBalance({ results }, homeKey, awayKey),
    results,
    status: "curated-h2h-backfill",
  };
}

function buildH2HAgentProfile({
  baseH2H,
  fallbackLegs = [],
  marketProfile,
  openFootballProfile,
  extraProfiles = [],
  homeName,
  awayName,
  homeId,
  awayId,
}) {
  const sources = [];
  let results = [];
  let sameCompetitionPlayed = Number(baseH2H?.sameCompetitionPlayed || 0);

  if (baseH2H?.results?.length) {
    results = mergeH2HResultLists(results, baseH2H.results);
    sources.push(baseH2H.status || "live-h2h");
  }

  for (const fallbackLeg of fallbackLegs || []) {
    if (!fallbackLeg) continue;
    results = mergeH2HResultLists(results, [fallbackLeg]);
    sources.push(fallbackLeg.source === "bbc-aggregate" ? "aggregate-backfill" : "previous-leg");
  }

  const curatedH2H = lookupCuratedH2HBackfill(homeName, awayName, homeId, awayId);
  if (curatedH2H?.results?.length) {
    results = mergeH2HResultLists(results, curatedH2H.results);
    sources.push(curatedH2H.status);
    sameCompetitionPlayed += Number(curatedH2H.sameCompetitionPlayed || 0);
  }

  const historicalProfiles = [marketProfile, openFootballProfile, ...extraProfiles].filter(Boolean);
  for (const historicalH2H of historicalProfiles.map((profile) =>
    lookupHistoricalH2HBackfill(profile, homeName, awayName, homeId, awayId)
  )) {
    if (!historicalH2H?.results?.length) continue;
    results = mergeH2HResultLists(results, historicalH2H.results);
    sources.push(historicalH2H.status || "historical-competition");
    sameCompetitionPlayed += Number(historicalH2H.sameCompetitionPlayed || 0);
  }

  if (!results.length) {
    return { played: 0, homeWins: 0, draws: 0, awayWins: 0, results: [], status: "h2h-agent-empty" };
  }

  const profile = summarizeH2HResults(
    results,
    homeName,
    awayName,
    homeId,
    awayId,
    sources.length > 1 ? `h2h-agent:${[...new Set(sources)].join("+")}` : sources[0] || "h2h-agent",
    sameCompetitionPlayed
  );

  return {
    ...profile,
    targetPlayed: 5,
    coverage: Math.min(1, Number(profile.played || 0) / 5),
    agent: {
      name: "H2H-agent",
      target: 5,
      filled: Number(profile.played || 0),
      complete: Number(profile.played || 0) >= 5,
      sources: [...new Set(sources)],
    },
  };
}

function predict(input) {
  const avgLeagueGoals = 1.35;
  const homeSplit = pickHomeStrength(input.homeRecent);
  const awaySplit = pickAwayStrength(input.awayRecent);

  let homeXG =
    avgLeagueGoals *
    1.11 *
    clamp((input.homeRecent?.avgScored || avgLeagueGoals) / avgLeagueGoals, 0.7, 1.6) *
    clamp((awaySplit.avgConceded || avgLeagueGoals) / avgLeagueGoals, 0.75, 1.5);

  let awayXG =
    avgLeagueGoals *
    clamp((input.awayRecent?.avgScored || avgLeagueGoals) / avgLeagueGoals, 0.7, 1.6) *
    clamp((homeSplit.avgConceded || avgLeagueGoals) / avgLeagueGoals, 0.75, 1.5);

  const homeClubElo = Number(input.homeClubElo || 0);
  const awayClubElo = Number(input.awayClubElo || 0);
  if (homeClubElo > 0 && awayClubElo > 0) {
    const eloDiff = homeClubElo - awayClubElo;
    homeXG *= clamp(1 + eloDiff / 1600, 0.9, 1.14);
    awayXG *= clamp(1 - eloDiff / 1600, 0.9, 1.14);
  }

  const homeSquadRating = Number(input.homeTeamProfile?.teamStrengthRating || input.homeTeamProfile?.squadRating || 50);
  const awaySquadRating = Number(input.awayTeamProfile?.teamStrengthRating || input.awayTeamProfile?.squadRating || 50);
  const squadRatingDiff = homeSquadRating - awaySquadRating;
  homeXG *= clamp(1 + squadRatingDiff / 900, 0.94, 1.08);
  awayXG *= clamp(1 - squadRatingDiff / 900, 0.94, 1.08);

  const transferImpactDiff =
    Number(input.homeTeamProfile?.transferImpact || 0) - Number(input.awayTeamProfile?.transferImpact || 0);
  homeXG *= clamp(1 + transferImpactDiff * 0.015, 0.97, 1.04);
  awayXG *= clamp(1 - transferImpactDiff * 0.015, 0.97, 1.04);

  if (input.homeSeasonStats?.avgShotsOn && input.awaySeasonStats?.avgShotsOn) {
    const averageShots =
      (Number(input.homeSeasonStats.avgShotsOn || 0) + Number(input.awaySeasonStats.avgShotsOn || 0)) / 2 || 1;
    homeXG *= clamp(Number(input.homeSeasonStats.avgShotsOn || 0) / averageShots, 0.88, 1.14);
    awayXG *= clamp(Number(input.awaySeasonStats.avgShotsOn || 0) / averageShots, 0.88, 1.14);
  }

  if (input.homeSeasonStats?.dominanceScore != null && input.awaySeasonStats?.dominanceScore != null) {
    const dominanceDiff = Number(input.homeSeasonStats.dominanceScore || 0) - Number(input.awaySeasonStats.dominanceScore || 0);
    homeXG *= clamp(1 + dominanceDiff * 0.028, 0.92, 1.12);
    awayXG *= clamp(1 - dominanceDiff * 0.028, 0.92, 1.12);
  }

  if (input.homeSeasonStats?.avgShots && input.awaySeasonStats?.avgShotsAgainst) {
    homeXG *= clamp(Number(input.homeSeasonStats.avgShots || 0) / Math.max(Number(input.awaySeasonStats.avgShotsAgainst || 0), 1), 0.9, 1.1);
  }
  if (input.awaySeasonStats?.avgShots && input.homeSeasonStats?.avgShotsAgainst) {
    awayXG *= clamp(Number(input.awaySeasonStats.avgShots || 0) / Math.max(Number(input.homeSeasonStats.avgShotsAgainst || 0), 1), 0.9, 1.1);
  }

  if (input.homeRestDays != null && input.awayRestDays != null) {
    const diff = Number(input.homeRestDays) - Number(input.awayRestDays);
    homeXG *= clamp(1 + diff * 0.012, 0.93, 1.08);
    awayXG *= clamp(1 - diff * 0.012, 0.93, 1.08);
  }

  if (input.weather?.riskLevel === "medium") {
    homeXG *= 0.97;
    awayXG *= 0.97;
  }
  if (input.weather?.riskLevel === "high") {
    homeXG *= 0.93;
    awayXG *= 0.93;
  }

  if (input.homeInjuries?.injuredCount) {
    homeXG *= clamp(1 - Number(input.homeInjuries.injuredCount) * 0.025, 0.85, 1);
  }
  if (input.awayInjuries?.injuredCount) {
    awayXG *= clamp(1 - Number(input.awayInjuries.injuredCount) * 0.025, 0.85, 1);
  }

  if (input.lineupSummary?.confirmed) {
    const homeRating = Number(input.lineupSummary.home?.avgRating || 6.8);
    const awayRating = Number(input.lineupSummary.away?.avgRating || 6.8);
    const diff = homeRating - awayRating;
    homeXG *= clamp(1 + diff * 0.02, 0.94, 1.08);
    awayXG *= clamp(1 - diff * 0.02, 0.94, 1.08);
  }

  if (input.h2h?.played >= 3) {
    const balance = (Number(input.h2h.homeWins || 0) - Number(input.h2h.awayWins || 0)) / Math.max(Number(input.h2h.played || 1), 1);
    homeXG *= clamp(1 + balance * 0.05, 0.92, 1.08);
    awayXG *= clamp(1 - balance * 0.05, 0.92, 1.08);
  }

  const homeStandingPressure = calcTeamPressure(input.homeStandingPos ?? input.homePos, input.standingTotalTeams);
  const awayStandingPressure = calcTeamPressure(input.awayStandingPos ?? input.awayPos, input.standingTotalTeams);
  if (homeStandingPressure > 1 || awayStandingPressure > 1) {
    homeXG *= clamp(homeStandingPressure, 1, 1.1);
    awayXG *= clamp(awayStandingPressure, 1, 1.1);
  } else if (input.matchImportance && input.matchImportance > 1) {
    homeXG *= clamp(input.matchImportance, 1, 1.05);
    awayXG *= clamp(input.matchImportance, 1, 1.05);
  }

  const learningEdge = buildLearningEdge(input);
  const marketCalibration = buildMarketCalibration(input);
  const leagueReliability = buildLeagueReliabilityEdge(input);
  const phaseReliability = buildPhaseReliabilityEdge(input);
  const refereeProfile = input.refereeProfile || null;
  const bookmakerSignals = Array.isArray(marketCalibration.bookmakerSignals) ? marketCalibration.bookmakerSignals : [];

  if (learningEdge.safeToApply && learningEdge.combinedReliability) {
    const learningSampleStrength = clamp(Number(learningEdge.totalReviewedMatches || 0) / 30, 0.2, 1);
    const reliabilityGate = clamp((Number(learningEdge.combinedReliability || 0) - 0.34) / 0.36, 0.12, 1);
    const phaseMultiplier = Number(learningEdge.phaseMultiplier || 1);
    const outcomeHitShift = clamp(
      (Number(learningEdge.homeOutcomeHitRate || 0) - Number(learningEdge.awayOutcomeHitRate || 0)) * 0.05,
      -0.045,
      0.045
    );
    const learningWeight = (0.04 + learningSampleStrength * 0.055) * reliabilityGate * phaseMultiplier;
    const learningBiasShift = clamp(
      (Number(learningEdge.homeBias || 0) - Number(learningEdge.awayBias || 0)) * learningWeight + outcomeHitShift,
      -0.115,
      0.115
    );
    homeXG *= clamp(1 + learningBiasShift, 0.94, 1.08);
    awayXG *= clamp(1 - learningBiasShift, 0.94, 1.08);
    learningEdge.applied = true;
    learningEdge.appliedShift = Number(learningBiasShift.toFixed(3));
  } else {
    learningEdge.applied = false;
    learningEdge.appliedShift = 0;
  }

  if (Number(learningEdge.totalReviewedMatches || 0) >= 8) {
    const exactEdge =
      clamp(
        (Number(learningEdge.homeExactHitRate || 0) - Number(learningEdge.awayExactHitRate || 0)) * 0.035,
        -0.04,
        0.04
      );
    homeXG *= clamp(1 + exactEdge, 0.97, 1.05);
    awayXG *= clamp(1 - exactEdge, 0.97, 1.05);
  }

  if (Number(marketCalibration.overperformanceDiff || 0)) {
    const marketShift = clamp(
      Number(marketCalibration.overperformanceDiff || 0) * (marketCalibration.strength >= 0.7 ? 0.04 : 0.025),
      -0.08,
      0.08
    );
    homeXG *= clamp(1 + marketShift, 0.95, 1.06);
    awayXG *= clamp(1 - marketShift, 0.95, 1.06);
  }
  if (bookmakerSignals.length) {
    const weightedBookDiff =
      bookmakerSignals.reduce((sum, item) => sum + Number(item.diff || 0) * Math.max(Number(item.strength || 0), 0.1), 0) /
      bookmakerSignals.reduce((sum, item) => sum + Math.max(Number(item.strength || 0), 0.1), 0);
    const bookmakerShift = clamp(
      weightedBookDiff * (Number(marketCalibration.bookmakerAgreement || 0) >= 0.7 ? 0.032 : 0.018),
      -0.06,
      0.06
    );
    homeXG *= clamp(1 + bookmakerShift, 0.955, 1.07);
    awayXG *= clamp(1 - bookmakerShift, 0.955, 1.07);
  }

  if (leagueReliability.reliabilityScore != null && leagueReliability.reliabilityScore < 0.45) {
    homeXG *= 0.98;
    awayXG *= 0.98;
  }
  if (phaseReliability.reliabilityScore != null && phaseReliability.reliabilityScore < 0.45) {
    homeXG *= 0.985;
    awayXG *= 0.985;
  }

  if (refereeProfile?.estimatedPenaltyRate >= 0.12) {
    homeXG *= 1.02;
    awayXG *= 1.02;
  }

  homeXG = clamp(homeXG, 0.22, 3.8);
  awayXG = clamp(awayXG, 0.22, 3.8);

  const poissonModel = buildPoissonScoreModel(homeXG, awayXG);
  const { homeProb, drawProb, awayProb, over15, over25, over35, btts, scoreMatrix } = poissonModel;
  let { bestScore, bestProb } = poissonModel;

  const homeAwayEdge = buildHomeAwayEdge(input.homeRecent, input.awayRecent);
  const featureVector = buildFeatureVector(input, {
    pickHomeStrength,
    pickAwayStrength,
    normalizeName,
    toPointsPerGame,
    calcLineupContinuity,
    calcTravelPenalty,
    calcKeeperEdge,
    calculateRecentH2HBalance,
    isSeniorInternationalTournament,
  });
  const heuristicModel = buildHeuristicEnsemble(featureVector);
  const baseModel = { homeProb, drawProb, awayProb };
  const preSimulationBlend = blendProbabilities(
    baseModel,
    heuristicModel,
    0.78
  );
  const monteCarloSeed = hashSeed([
    input.homeTeamId,
    input.awayTeamId,
    input.homeTeamName,
    input.awayTeamName,
    input.leagueType,
    homeXG.toFixed(3),
    awayXG.toFixed(3),
  ].join("|"));
  const monteCarlo = runMonteCarloSimulation({
    homeXG,
    awayXG,
    seed: monteCarloSeed,
    runs: MONTE_CARLO_RUNS,
  });
  const rawBlended = blendTriple(preSimulationBlend, monteCarlo, MONTE_CARLO_WEIGHT);
  const probabilityCalibration = calibrateOutcomeProbabilities(rawBlended, input.modelPerformance);
  const blended = probabilityCalibration.probabilities;
  let combinedScoreMatrix = blendScoreMatrices(scoreMatrix, monteCarlo.scoreMatrix, MONTE_CARLO_WEIGHT);
  let bestCombinedScore = Object.entries(combinedScoreMatrix)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0] || [bestScore, bestProb];
  const scoreCalibration = calibrateScoreMatrixWithReviewBias(combinedScoreMatrix, input, bestCombinedScore[0]);
  combinedScoreMatrix = scoreCalibration.matrix;
  bestCombinedScore = Object.entries(combinedScoreMatrix)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0] || bestCombinedScore;
  bestScore = bestCombinedScore[0];
  bestProb = Number(bestCombinedScore[1] || bestProb || 0);
  const monteCarloAgreement = calcModelAgreement(preSimulationBlend, monteCarlo);
  monteCarlo.weight = MONTE_CARLO_WEIGHT;
  monteCarlo.agreement = monteCarloAgreement;
  const outcomeEntries = [
    { key: "home", prob: blended.homeProb },
    { key: "draw", prob: blended.drawProb },
    { key: "away", prob: blended.awayProb },
  ].sort((a, b) => b.prob - a.prob);
  const [rawBestHomeGoals, rawBestAwayGoals] = bestScore.split("-").map(Number);
  const bestScoreOutcome =
    rawBestHomeGoals > rawBestAwayGoals
      ? "home"
      : rawBestHomeGoals === rawBestAwayGoals
        ? "draw"
        : "away";
  const dominantOutcome = outcomeEntries[0];
  const outcomeEdge = Number((dominantOutcome.prob - outcomeEntries[1].prob).toFixed(4));
  let selectedScore = bestScore;
  let selectedExactProb = bestProb;
  let scoreSelectionReason =
    scoreCalibration.applied
      ? `${scoreCalibration.reason}; scorematrix gekalibreerd`
      : dominantOutcome.key !== bestScoreOutcome
        ? `hoogste exacte scorematrix-kans inclusief Monte Carlo; 1X2 neigt naar ${dominantOutcome.key === "home" ? "thuiswinst" : dominantOutcome.key === "away" ? "uitwinst" : "gelijkspel"}`
        : "hoogste exacte scorematrix-kans inclusief Monte Carlo";
  const outcomeAlignedScore = Object.entries(combinedScoreMatrix)
    .filter(([score]) => {
      const [homeGoals, awayGoals] = String(score).split("-").map(Number);
      if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return false;
      const scoreOutcome = homeGoals > awayGoals ? "home" : homeGoals === awayGoals ? "draw" : "away";
      return scoreOutcome === dominantOutcome.key;
    })
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0];
  const outcomeReliabilityLift =
    Number(input.modelPerformance?.probabilityOutcomeHitRate || 0) -
    Number(input.modelPerformance?.exactHitRate || input.modelPerformance?.scoreHitRate || 0);
  const shouldAlignToOutcome =
    outcomeAlignedScore &&
    dominantOutcome.key !== bestScoreOutcome &&
    (outcomeEdge >= 0.08 || outcomeReliabilityLift >= 0.04);
  if (shouldAlignToOutcome) {
    selectedScore = outcomeAlignedScore[0];
    selectedExactProb = Number(outcomeAlignedScore[1] || selectedExactProb || 0);
    scoreSelectionReason = `1X2-edge (${Math.round(outcomeEdge * 100)}pp) weegt zwaarder dan exacte score; gekozen score past bij ${dominantOutcome.key === "home" ? "thuiswinst" : dominantOutcome.key === "away" ? "uitwinst" : "gelijkspel"}`;
  }
  const [predHomeGoals, predAwayGoals] = selectedScore.split("-").map(Number);
  const modelAgreement = calcModelAgreement(baseModel, heuristicModel);
  const lineupImpact = buildLineupImpact(input);
  const tacticalMismatch = buildTacticalMismatch(input);
  const formShift = buildFormShift(input);
  const travelEdge = buildTravelEdge(input, featureVector);
  const keeperEdge = buildKeeperEdge(input, featureVector);
  const baseConfidence = Math.min(0.93, selectedExactProb * 3.5 + 0.24);
  const reliabilityPenalty =
    learningEdge.combinedReliability && learningEdge.combinedReliability < 0.44
      ? 0.07
      : learningEdge.combinedReliability && learningEdge.combinedReliability < 0.55
        ? 0.03
        : 0;
  const leaguePenalty =
    leagueReliability.reliabilityScore != null && leagueReliability.reliabilityScore < 0.4
      ? 0.05
      : leagueReliability.reliabilityScore != null && leagueReliability.reliabilityScore < 0.52
        ? 0.02
        : 0;
  const phasePenalty =
    phaseReliability.reliabilityScore != null && phaseReliability.reliabilityScore < 0.4
      ? 0.04
      : phaseReliability.reliabilityScore != null && phaseReliability.reliabilityScore < 0.52
        ? 0.015
        : 0;
  const bookmakerPenalty =
    bookmakerSignals.length === 0
      ? 0.015
      : Number(marketCalibration.bookmakerAgreement || 0) < 0.45
        ? 0.018
        : Number(marketCalibration.bookmakerAgreement || 0) < 0.62
          ? 0.008
          : 0;
  const closingCoveragePenalty =
    Number(marketCalibration.closingCoverage || 0) < 0.2
      ? 0.012
      : Number(marketCalibration.closingCoverage || 0) < 0.4
        ? 0.005
        : 0;
  const dataCompleteness = scoreDataCompleteness(
    input,
    {
      marketCalibration,
      leagueReliability,
      phaseReliability,
      resultFresh: input.resultFresh,
    },
    {
      clamp,
      normalizeName,
    }
  );
  const qualityGate = qualityGateForCompleteness(dataCompleteness);
  if (input?.assertionDegraded) {
    qualityGate.blockedHighConfidence = true;
    qualityGate.confidenceCap = Math.min(Number(qualityGate.confidenceCap || 0.7), 0.58);
    qualityGate.penalty = Number((Number(qualityGate.penalty || 0) + 0.04).toFixed(3));
    qualityGate.summary = `${qualityGate.summary}; assertion-degraded mode actief`;
  }
  const sourceReliability = sourceReliabilityScore(
    {
      ...input,
      marketCalibration,
    },
    dataCompleteness,
    {
      clamp,
    }
  );
  const fragilityPenalty =
    (Number(learningEdge.homeFragility || 0) + Number(learningEdge.awayFragility || 0) >= 4 ? 0.02 : 0) +
    (!input.lineupSummary?.confirmed ? 0.015 : 0);
  const modelAgreementPenalty =
    modelAgreement < 0.35
      ? 0.085
      : modelAgreement < 0.45
        ? 0.055
        : modelAgreement < 0.55
          ? 0.028
          : 0;
  const reliabilityPenaltyExtra =
    sourceReliability.score < 0.35 ? 0.06 : sourceReliability.score < 0.5 ? 0.035 : sourceReliability.score < 0.62 ? 0.018 : 0;
  const adjustedConfidence = clamp(
    baseConfidence -
      reliabilityPenalty -
      fragilityPenalty -
      leaguePenalty -
      phasePenalty -
      bookmakerPenalty -
      closingCoveragePenalty -
      qualityGate.penalty -
      reliabilityPenaltyExtra -
      modelAgreementPenalty,
    0.24,
    qualityGate.confidenceCap
  );
  const confidenceCalibration = calibrateConfidenceWithBacktest(adjustedConfidence, input.modelPerformance, {
    confidenceCap: qualityGate.confidenceCap,
  });
  const finalConfidenceRaw = Number(confidenceCalibration.calibratedConfidence ?? adjustedConfidence);
  const neutral = { homeProb: 0.3333, drawProb: 0.3334, awayProb: 0.3333 };
  const reliabilityWeighted = blendProbabilities(blended, neutral, sourceReliability.blendWeight);
  const leagueCalibrated = applyLeagueCalibration(reliabilityWeighted, input.league, input.leagueCalibrationProfile || null);
  const finalProbabilities = {
    homeProb: leagueCalibrated.homeProb,
    drawProb: leagueCalibrated.drawProb,
    awayProb: leagueCalibrated.awayProb,
  };
  const finalConfidence = clamp(
    finalConfidenceRaw + Number(leagueCalibrated.profile?.confidenceBias || 0),
    0.24,
    qualityGate.confidenceCap
  );
  const riskProfile = buildRiskProfile({
    confidence: finalConfidence,
    agreement: modelAgreement,
    weatherRisk: input.weather?.riskLevel || "low",
    lineupConfirmed: !!input.lineupSummary?.confirmed,
    injuriesTotal: Number(input.homeInjuries?.injuredCount || 0) + Number(input.awayInjuries?.injuredCount || 0),
    awayTravelPenalty: featureVector.away_travel_penalty,
    keeperDiff: featureVector.keeper_rating_diff,
  });
  const teamAiSummary = {
    home: buildTeamAiSummary("home", input.homeTeamProfile?.teamName || "Thuis", input.homeRecent, input.homeTeamProfile, input.homeInjuries),
    away: buildTeamAiSummary("away", input.awayTeamProfile?.teamName || "Uit", input.awayRecent, input.awayTeamProfile, input.awayInjuries),
  };
  const featureImportance = buildFeatureImportance(featureVector, {
    sourceReliability,
    dataCompleteness,
  });

  return {
    homeProb: finalProbabilities.homeProb,
    drawProb: finalProbabilities.drawProb,
    awayProb: finalProbabilities.awayProb,
    homeXG: Number(homeXG.toFixed(2)),
    awayXG: Number(awayXG.toFixed(2)),
    predHomeGoals,
    predAwayGoals,
    exactProb: Number(selectedExactProb.toFixed(4)),
    confidence: Number(finalConfidence.toFixed(3)),
    confidenceRaw: Number(adjustedConfidence.toFixed(3)),
    over15: Number(over15.toFixed(3)),
    over25: Number((over25 * (1 - MONTE_CARLO_WEIGHT) + monteCarlo.over25Prob * MONTE_CARLO_WEIGHT).toFixed(3)),
    over35: Number((over35 * (1 - MONTE_CARLO_WEIGHT) + monteCarlo.over35Prob * MONTE_CARLO_WEIGHT).toFixed(3)),
    btts: Number((btts * (1 - MONTE_CARLO_WEIGHT) + monteCarlo.bttsProb * MONTE_CARLO_WEIGHT).toFixed(3)),
    scoreMatrix: combinedScoreMatrix,
    monteCarlo: compactMonteCarlo(monteCarlo),
    modelEdges: {
      rest: input.homeRestDays != null && input.awayRestDays != null
        ? Number((Number(input.homeRestDays) - Number(input.awayRestDays)).toFixed(1))
        : null,
      weatherRisk: input.weather?.riskLevel || "low",
      lineupConfirmed: !!input.lineupSummary?.confirmed,
      lineupImpact,
      homeAwayEdge,
      tacticalMismatch,
      formShift,
      travelEdge,
      keeperEdge,
      learningEdge,
      leagueReliability,
      phaseReliability,
      marketCalibration,
      probabilityCalibration,
      confidenceCalibration,
      refereeProfile,
      scoreSelection: {
        rawBestScore: bestScore,
        selectedScore,
        reason: scoreSelectionReason,
        outcomeEdge,
        calibrationApplied: scoreCalibration.applied,
        outcomeAligned: !!shouldAlignToOutcome,
      },
      dataCompleteness,
      qualityGate,
      sourceReliability,
      leagueCalibration: {
        league: input.league || "unknown",
        profile: leagueCalibrated.profile,
      },
      clubEloDiff: homeClubElo > 0 && awayClubElo > 0 ? Math.round(homeClubElo - awayClubElo) : null,
      stakes: input.context?.summary || null,
      matchImportance: input.matchImportance || 1,
      modelAgreement,
      monteCarloAgreement,
      modelAgreementPenalty: Number(modelAgreementPenalty.toFixed(3)),
      modelWarnings: [
        ...(modelAgreement < 0.55 ? ["low_model_agreement"] : []),
        ...(monteCarloAgreement < 0.55 ? ["monte_carlo_disagreement"] : []),
        ...(bookmakerSignals.length === 0 ? ["market_signals_missing"] : []),
        ...(dataCompleteness.score < 0.58 ? ["data_completeness_low"] : []),
        ...(sourceReliability.score < 0.5 ? ["source_reliability_low"] : []),
      ],
      riskProfile,
      teamAiSummary,
      featureImportance,
    },
    featureVector,
    featureImportance,
    dataCompleteness,
    dataCompletenessScore: dataCompleteness.score,
    qualityGate,
    ensembleMeta: {
      active: true,
      baseModel: "dixon-coles-poisson",
      blendModel: "heuristic-form-elo+monte-carlo",
      blendWeightBase: Number((0.78 * (1 - MONTE_CARLO_WEIGHT)).toFixed(3)),
      blendWeightHeuristic: 0.22,
      blendWeightMonteCarlo: MONTE_CARLO_WEIGHT,
      trainingReady: true,
      suggestedNextModel: "CatBoost or LightGBM",
      baseProbabilities: {
        homeProb: Number(baseModel.homeProb.toFixed(4)),
        drawProb: Number(baseModel.drawProb.toFixed(4)),
        awayProb: Number(baseModel.awayProb.toFixed(4)),
      },
      heuristicProbabilities: heuristicModel,
      monteCarloProbabilities: {
        homeProb: monteCarlo.homeProb,
        drawProb: monteCarlo.drawProb,
        awayProb: monteCarlo.awayProb,
        topScore: monteCarlo.topScore,
        topScoreProb: monteCarlo.topScoreProb,
        simulations: monteCarlo.simulations,
      },
      agreement: modelAgreement,
    },
    matchImportance: input.matchImportance || 1,
  };
}

function compactStore(store, referenceDateKey, now) {
  const retainedDates = buildRetainedDateSet(referenceDateKey);
  const retainedMatchIds = new Set();

  for (const date of Object.keys(store.matches || {})) {
    if (!retainedDates.has(date)) {
      delete store.matches[date];
      delete store.predictions[date];
      delete store.knockoutOverview?.[date];
      continue;
    }

    store.matches[date] = dedupeStoredMatches(
      (store.matches[date] || [])
        .filter(Boolean)
        .map((match) =>
          normalizeStoredMatchReliability(match, date, now, store, {
            curatedResultBackfill: CURATED_RESULT_BACKFILL,
            buildPairKey,
            lookupHistoricalH2HBackfill,
            orientHistoricalScore,
            lookupStoredMatchH2HBackfill,
            isoFromMs,
          })
        )
    );
    store.predictions[date] = dedupeStoredPredictions(store.predictions?.[date] || [], store.matches[date]).map((prediction) =>
      compactPredictionEntry(prediction, date !== referenceDateKey && date !== addDaysToDateKey(referenceDateKey, 1))
    );

    for (const match of store.matches[date]) {
      if (match?.id) retainedMatchIds.add(match.id);
    }
  }

  const reviewEntries = Object.entries(store.postMatchReviews || {})
    .sort((a, b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0))
    .slice(0, MAX_REVIEWS);
  store.postMatchReviews = Object.fromEntries(reviewEntries);
  compactPredictionSnapshots(store);

  pruneUpdatedMap(store, "teamStats", "teamStatsUpdated", FORM_TTL, now, 600);
  pruneUpdatedMap(store, "teamInjuries", "teamInjuriesUpdated", INJURY_TTL, now, 600);
  pruneUpdatedMap(store, "teamSeasonStats", "teamSeasonStatsUpdated", SEASON_TTL, now, 600);
  pruneUpdatedMap(store, "teamSquads", "teamSquadsUpdated", SQUAD_TTL * 4, now, MAX_TEAM_SQUADS);
  pruneUpdatedMap(store, "teamTransfers", "teamTransfersUpdated", TRANSFER_WATCH_TTL * 14, now, MAX_TEAM_TRANSFERS);
  pruneUpdatedMap(store, "eventCache", "eventCacheUpdated", EVENT_TTL, now, MAX_EVENT_CACHE);
  pruneUpdatedMap(store, "marketProfiles", "marketProfilesUpdated", MARKET_TTL, now, MAX_MARKET_PROFILES);
  pruneUpdatedMap(store, "openfootballProfiles", "openfootballProfilesUpdated", OPENFOOTBALL_TTL, now, MAX_OPENFOOTBALL_CACHE);
  pruneUpdatedMap(store, "understatSnapshots", "understatSnapshotsUpdated", SNAPSHOT_TTL, now, MAX_SNAPSHOT_CACHE);
  pruneUpdatedMap(store, "fbrefSnapshots", "fbrefSnapshotsUpdated", SNAPSHOT_TTL, now, MAX_SNAPSHOT_CACHE);
  pruneEmbeddedUpdatedMap(store, "h2hCache", H2H_TTL, now, MAX_H2H_CACHE);
  pruneEmbeddedUpdatedMap(store, "weatherCache", WEATHER_TTL, now, MAX_WEATHER_CACHE);

  if (store.clubEloUpdated && now - Number(store.clubEloUpdated || 0) > CLUB_ELO_TTL * 2) {
    store.clubEloCache = null;
    store.clubEloUpdated = null;
  }
}

function getTeam(storeTeams, id, name) {
  const key = id ? `id:${id}` : `name:${normalizeName(name)}`;
  if (!storeTeams[key]) {
    storeTeams[key] = { id: id || "", name: name || "Unknown", elo: 1500 };
  }
  storeTeams[key].name = name || storeTeams[key].name;
  if (id) storeTeams[key].id = id;
  return storeTeams[key];
}

function pushRolling(values, next, size = 10) {
  const list = Array.isArray(values) ? values.slice() : [];
  if (Number.isFinite(Number(next))) list.push(Number(next));
  return list.slice(-size);
}

function averageRolling(values) {
  const list = (values || []).filter((v) => Number.isFinite(Number(v))).map(Number);
  if (!list.length) return null;
  return Number((list.reduce((sum, v) => sum + v, 0) / list.length).toFixed(2));
}

function updateTeamPostMatchStats(store, match) {
  const stats = match?.postMatchStats;
  if (!stats) return;
  if (!store.teamPostMatchStats) store.teamPostMatchStats = {};
  const upsert = (teamId, teamName, side) => {
    const key = teamId ? `id:${teamId}` : `name:${normalizeName(teamName)}`;
    if (!store.teamPostMatchStats[key]) {
      store.teamPostMatchStats[key] = {
        teamId: teamId || "",
        teamName: teamName || "Unknown",
        matches: 0,
        possession: [],
        shotsOnTarget: [],
        corners: [],
        fouls: [],
        bigChances: [],
        freeKicks: [],
        quarterScoring: emptyGoalQuarters(),
      };
    }
    const row = store.teamPostMatchStats[key];
    row.matches += 1;
    row.teamName = teamName || row.teamName;
    row.teamId = teamId || row.teamId;
    row.possession = pushRolling(row.possession, stats?.[side]?.possession);
    row.shotsOnTarget = pushRolling(row.shotsOnTarget, stats?.[side]?.shotsOnTarget);
    row.corners = pushRolling(row.corners, stats?.[side]?.corners);
    row.fouls = pushRolling(row.fouls, stats?.[side]?.fouls);
    row.bigChances = pushRolling(row.bigChances, stats?.[side]?.bigChances);
    row.freeKicks = pushRolling(row.freeKicks, stats?.[side]?.freeKicks);
    for (const keyQuarter of Object.keys(emptyGoalQuarters())) {
      row.quarterScoring[keyQuarter] = Number(row.quarterScoring[keyQuarter] || 0) + Number(stats?.goalQuarters?.[side]?.[keyQuarter] || 0);
    }
    row.rolling = {
      possession: averageRolling(row.possession),
      shotsOnTarget: averageRolling(row.shotsOnTarget),
      corners: averageRolling(row.corners),
      fouls: averageRolling(row.fouls),
      bigChances: averageRolling(row.bigChances),
      freeKicks: averageRolling(row.freeKicks),
    };
    row.lastSource = stats?.source || null;
    row.lastUpdated = Date.now();
  };
  upsert(match.homeTeamId, match.homeTeamName, "home");
  upsert(match.awayTeamId, match.awayTeamName, "away");
}

function defaultStore() {
  return {
    teams: {},
    predictions: {},
    matches: {},
    standings: {},
    knockoutOverview: {},
    cupSheets: {},
    teamStats: {},
    teamStatsUpdated: {},
    teamInjuries: {},
    teamInjuriesUpdated: {},
    teamSeasonStats: {},
    teamSeasonStatsUpdated: {},
    teamSquads: {},
    teamSquadsUpdated: {},
    teamTransfers: {},
    teamTransfersUpdated: {},
    eventCache: {},
    eventCacheUpdated: {},
    h2hCache: {},
    weatherCache: {},
    clubEloCache: null,
    clubEloUpdated: null,
    marketProfiles: {},
    marketProfilesUpdated: {},
    openfootballProfiles: {},
    openfootballProfilesUpdated: {},
    understatSnapshots: {},
    understatSnapshotsUpdated: {},
    fbrefSnapshots: {},
    fbrefSnapshotsUpdated: {},
    predictionSnapshots: {},
    predictionSnapshotIndex: {},
    postMatchReviews: {},
    teamPostMatchStats: {},
    teamLearning: {},
    leagueReliability: {},
    phaseReliability: {},
    leagueCalibrationProfiles: {},
    leagueCalibrationProfilesByWindow: {},
    leagueCalibrationRollbackProfiles: {},
    backtestSegmentation: null,
    featureDiagnostics: null,
    sourceCoverage: null,
    dataScout: null,
    dataCompletenessAudit: null,
    oddsIntegrationReadiness: null,
    modelPerformance: null,
    backtestSummary: null,
    anomalyReport: null,
    aiAdvice: [],
    competitionArchiveIndex: null,
    teamSquadSummary: null,
    worldCup2026Readiness: null,
    worldCup2026Projection: null,
    worldCup2026Ratings: null,
    lastRun: null,
    workerVersion: MODEL_VERSION,
  };
}

async function refreshWorldCupNationalRatings(store, now) {
  const previous = store.worldCup2026Ratings || {};
  const currentRatings = {};
  for (const [code, team] of Object.entries(WORLD_CUP_TEAMS || {})) {
    const seeded = Number(team?.strength || 65);
    currentRatings[code] = {
      code,
      teamName: String(team?.name || code),
      rating: Number((seeded * 20).toFixed(0)),
      source: "seeded_country_strength",
    };
  }

  const feedUrl = process.env.NATIONAL_ELO_FEED_URL || "";
  if (feedUrl) {
    const external = await fetchExternalJson(feedUrl);
    const list = Array.isArray(external?.teams) ? external.teams : Array.isArray(external) ? external : [];
    for (const item of list) {
      const code = String(item?.code || "").toUpperCase();
      if (!currentRatings[code]) continue;
      const rating = Number(item?.rating || item?.elo || item?.points || 0);
      if (!Number.isFinite(rating) || rating <= 0) continue;
      currentRatings[code] = {
        ...currentRatings[code],
        rating: Number(rating.toFixed(0)),
        source: String(item?.source || "external_elo_feed"),
      };
    }
  }

  store.worldCup2026Ratings = {
    updatedAt: new Date(now).toISOString(),
    sourceMode: feedUrl ? "seeded_plus_external" : "seed_only",
    ratings: currentRatings,
    refreshedBy: "worker",
    previousUpdatedAt: previous?.updatedAt || null,
  };
}

function buildSourceCoverage(store, todayKey) {
  const todayMatches = Array.isArray(store.matches?.[todayKey]) ? store.matches[todayKey] : [];
  const total = Math.max(todayMatches.length, 1);
  const sourceBreakdown = todayMatches.reduce((acc, match) => {
    const key = String(match?.dataSource || "sofascore");
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const bookmakerCovered = todayMatches.filter(
    (match) => Array.isArray(match?.marketCalibration?.bookmakerSignals) && match.marketCalibration.bookmakerSignals.length > 0
  ).length;
  const refereeCovered = todayMatches.filter(
    (match) => Number(match?.refereeProfile?.matches || 0) > 0
  ).length;
  const refereeStatusKnown = todayMatches.filter((match) => !!match?.refereeStatus).length;
  const lineupStatusKnown = todayMatches.filter((match) => !!match?.lineupStatus).length;
  const lineupConfirmed = todayMatches.filter((match) => !!match?.lineupSummary?.confirmed).length;
  const availabilityCovered = todayMatches.filter((match) => !!(match?.homeInjuries && match?.awayInjuries)).length;
  const squadCovered = todayMatches.filter((match) => !!(match?.homeTeamProfile?.squad && match?.awayTeamProfile?.squad)).length;
  const providerTeamIdsCovered = todayMatches.filter((match) => !!(match?.homeTeamId && match?.awayTeamId)).length;
  const stableTeamIdentityCovered = todayMatches.filter((match) =>
    !!(match?.teamIdentity?.home?.key && match?.teamIdentity?.away?.key)
  ).length;
  const actualOddsCovered = todayMatches.filter((match) => !!match?.oddsAtPrediction).length;
  const h2hCovered = todayMatches.filter((match) => Number(match?.h2h?.played || 0) > 0).length;
  const openfootballH2hCovered = todayMatches.filter((match) =>
    (match?.h2h?.results || []).some((item) => String(item?.source || "").includes("openfootball"))
  ).length;
  const understatCovered = todayMatches.filter((match) =>
    match?.homeSeasonStats?.externalSources?.includes?.("Understat") ||
    match?.awaySeasonStats?.externalSources?.includes?.("Understat")
  ).length;
  const fbrefCovered = todayMatches.filter((match) =>
    match?.homeSeasonStats?.externalSources?.includes?.("FBref") ||
    match?.awaySeasonStats?.externalSources?.includes?.("FBref")
  ).length;
  const scoreRelevant = todayMatches.filter((match) => ["FT", "LIVE", "HT"].includes(String(match?.status || "").toUpperCase()));
  const scoreRelevantTotal = Math.max(scoreRelevant.length, 1);
  const finishedMatches = todayMatches.filter((match) => String(match?.status || "").toUpperCase() === "FT");
  const liveMatches = todayMatches.filter((match) => ["LIVE", "HT"].includes(String(match?.status || "").toUpperCase()));
  const finishedWithScore = finishedMatches.filter((match) => String(match?.score || "").includes("-")).length;
  const liveWithScore = liveMatches.filter((match) => String(match?.score || "").includes("-")).length;
  const scoreCovered = scoreRelevant.filter((match) => String(match?.score || "").includes("-")).length;
  const logoCovered = todayMatches.filter((match) => match?.homeLogo && match?.awayLogo).length;
  const completenessScores = todayMatches
    .map((match) => Number(match?.dataCompletenessScore ?? match?.dataCompleteness?.score ?? 0))
    .filter((score) => score > 0);
  const averageDataCompleteness =
    completenessScores.length > 0
      ? Number((completenessScores.reduce((sum, score) => sum + score, 0) / completenessScores.length).toFixed(2))
      : 0;
  const statusBreakdown = todayMatches.reduce((acc, match) => {
    const key = String(match?.status || "UNKNOWN").toUpperCase();
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const openfootballProfiles = Object.keys(store.openfootballProfiles || {}).length;
  const understatSnapshots = Object.keys(store.understatSnapshots || {}).length;
  const fbrefSnapshots = Object.keys(store.fbrefSnapshots || {}).length;
  const coverageImprovementPlan = [
    {
      key: "provider_team_ids",
      label: "Provider team-IDs",
      coverage: Number((providerTeamIdsCovered / total).toFixed(2)),
      target: 0.9,
      status: providerTeamIdsCovered / total >= 0.9 ? "ok" : "needs_mapping",
      action: "Vul REEP_TEAM_MAP/football-data.org team mapping aan voor wedstrijden die uit naamfallback-bronnen komen.",
    },
    {
      key: "lineups",
      label: "Bevestigde opstellingen",
      coverage: Number((lineupConfirmed / total).toFixed(2)),
      target: 0.45,
      status: lineupConfirmed / total >= 0.45 ? "ok" : "pre_match_pending",
      action: "Blijf lineups vlak voor kickoff verversen; open lineups blijven confidence-penalty en faalsignaal.",
    },
    {
      key: "referee_history",
      label: "Historische scheidsprofielen",
      coverage: Number((refereeCovered / total).toFixed(2)),
      target: 0.65,
      status: refereeCovered / total >= 0.65 ? "ok" : "needs_aliases",
      action: "Breid referee aliasen en football-data.co.uk archieven per competitiefamilie uit.",
    },
    {
      key: "availability",
      label: "Blessures/schorsingen",
      coverage: Number((availabilityCovered / total).toFixed(2)),
      target: 0.75,
      status: availabilityCovered / total >= 0.75 ? "ok" : "needs_source_depth",
      action: "Gebruik Sofascore spelersstatus eerst, daarna Transfermarkt/football-data.org squad fallback met veilige team-id mapping.",
    },
  ];
  return {
    todayMatches: todayMatches.length,
    scoreCoverage: Number((scoreCovered / scoreRelevantTotal).toFixed(2)),
    finishedScoreCoverage: Number((finishedWithScore / Math.max(finishedMatches.length, 1)).toFixed(2)),
    liveScoreCoverage: Number((liveWithScore / Math.max(liveMatches.length, 1)).toFixed(2)),
    logoCoverage: Number((logoCovered / total).toFixed(2)),
    finishedMatches: finishedMatches.length,
    finishedWithScore,
    liveMatches: liveMatches.length,
    liveWithScore,
    pendingFinishedCount: Math.max(0, finishedMatches.length - finishedWithScore),
    averageDataCompleteness,
    lowCompletenessMatches: todayMatches.filter((match) => Number(match?.dataCompletenessScore ?? 0) < 0.5).length,
    statusBreakdown,
    bookmakerCoverage: Number((bookmakerCovered / total).toFixed(2)),
    actualOddsCoverage: Number((actualOddsCovered / total).toFixed(2)),
    refereeCoverage: Number((refereeCovered / total).toFixed(2)),
    refereeStatusCoverage: Number((refereeStatusKnown / total).toFixed(2)),
    lineupStatusCoverage: Number((lineupStatusKnown / total).toFixed(2)),
    lineupConfirmedCoverage: Number((lineupConfirmed / total).toFixed(2)),
    availabilityCoverage: Number((availabilityCovered / total).toFixed(2)),
    squadCoverage: Number((squadCovered / total).toFixed(2)),
    providerTeamIdCoverage: Number((providerTeamIdsCovered / total).toFixed(2)),
    stableTeamIdentityCoverage: Number((stableTeamIdentityCovered / total).toFixed(2)),
    h2hCoverage: Number((h2hCovered / total).toFixed(2)),
    openfootballH2hCoverage: Number((openfootballH2hCovered / total).toFixed(2)),
    understatCoverage: Number((understatCovered / total).toFixed(2)),
    fbrefCoverage: Number((fbrefCovered / total).toFixed(2)),
    marketProfiles: Object.keys(store.marketProfiles || {}).length,
    openfootballProfiles,
    understatSnapshots,
    fbrefSnapshots,
    sourceBreakdown,
    coverageImprovementPlan,
    backupSources: [
      {
        key: "sofascore",
        name: "Sofascore",
        role: "optionele live/detailbron",
        status: Number(sourceBreakdown.sofascore || 0) > 0 ? "actief" : "403/uitgeschakeld deze run",
        note: "Wordt alleen gebruikt als de publieke API bereikbaar is; ESPN, TheSportsDB en open data vullen scores/logo's bij 403.",
      },
      {
        key: "espn-scoreboard",
        name: "ESPN Scoreboard",
        role: "score + logo backup",
        status: Object.keys(sourceBreakdown).some((key) => key.includes("espn")) ? "actief" : "stand-by",
        note: "Tweede hoofdbron voor fixtures, live/FT scores en officiele clublogo's voor topcompetities.",
      },
      {
        key: "thesportsdb",
        name: "TheSportsDB",
        role: "backup",
        status: Object.keys(sourceBreakdown).some((key) => key.includes("thesportsdb")) ? "actief" : "stand-by",
        note: "Gratis fixturefallback voor internationale en geselecteerde competitiewedstrijden.",
      },
      {
        key: "forza-football",
        name: "Forza Football",
        role: "selectie fallback",
        status: Object.values(store.teamSquads || {}).some((item) => (item?.sources || []).includes("Forza Football")) ? "gekoppeld" : "stand-by",
        note: "Wordt pas geprobeerd als de eerste spelerslijstbron onvolledig is; gebruikt alleen bekende/geconfigureerde publieke squad-URL's.",
      },
      {
        key: "football-data-org",
        name: "football-data.org",
        role: "selectie API fallback",
        status: process.env.FOOTBALL_DATA_TOKEN || process.env.FOOTBALL_DATA_API_KEY ? "token aanwezig" : "klaar, token ontbreekt",
        note: "Optionele gratis API-bron voor squads. Alleen actief met FOOTBALL_DATA_TOKEN en team-id mapping, zodat er geen verkeerde teams worden gematcht.",
      },
      {
        key: "reep",
        name: "Reep Football",
        role: "team-ID koppeling",
        status: Object.values(store.teamSquads || {}).some((item) => item?.reepTeamId || item?.sourceIds?.reep) ? "gekoppeld" : "stand-by",
        note: "Wordt gebruikt als alias/ID-koppelvlak wanneer REEP_TEAM_MAP aanwezig is; voorkomt verkeerde clubnaam- en logo-matches.",
      },
      {
        key: "football-data",
        name: "football-data.co.uk",
        role: "backup + markt",
        status: Object.keys(sourceBreakdown).some((key) => key.includes("football-data")) ? "actief" : "markt-only",
        note: "Historische odds, closing-lijnen en fixturefallback uit gratis competitiebestanden.",
      },
      {
        key: "openligadb",
        name: "OpenLigaDB",
        role: "backup",
        status: Object.keys(sourceBreakdown).some((key) => key.includes("openligadb")) ? "actief" : "stand-by",
        note: "Extra gratis fixturebron voor vooral Duitse competities wanneer de hoofdbron dun blijft.",
      },
      {
        key: "curated-bbc",
        name: "BBC fixture backfill",
        role: "curated noodfallback",
        status: Object.keys(sourceBreakdown).some((key) => key.includes("curated-fixture")) ? "actief" : "stand-by",
        note: "Handmatige gratis veiligheidslaag voor bewezen topwedstrijden die alle automatische fallbackbronnen missen.",
      },
      {
        key: "openfootball",
        name: "openfootball",
        role: "historisch H2H",
        status: openfootballProfiles > 0 ? "gekoppeld" : "stand-by",
        note: `${openfootballProfiles} competitieprofiel(en), ${Math.round((openfootballH2hCovered / total) * 100)}% van vandaag met openfootball-H2H.`,
      },
    ],
    understat: {
      status: understatSnapshots > 0 ? "gekoppeld" : "stand-by",
      snapshots: understatSnapshots,
      coverage: Number((understatCovered / total).toFixed(2)),
      note: understatSnapshots > 0
        ? `${understatSnapshots} xG/xGA-snapshot(s), ${Math.round((understatCovered / total) * 100)}% van vandaag verrijkt.`
        : "Geen actieve Understat-competitie op deze speeldag of bron tijdelijk niet bereikbaar.",
    },
    fbref: {
      status: fbrefSnapshots > 0 ? "gekoppeld" : "stand-by",
      snapshots: fbrefSnapshots,
      coverage: Number((fbrefCovered / total).toFixed(2)),
      note: fbrefSnapshots > 0
        ? `${fbrefSnapshots} shot/split-snapshot(s), ${Math.round((fbrefCovered / total) * 100)}% van vandaag verrijkt.`
        : "Geen actieve FBref-snapshot voor deze speeldag of release tijdelijk niet bereikbaar.",
    },
  };
}

function buildDataScoutReport(store, todayKey) {
  const todayMatches = Array.isArray(store.matches?.[todayKey]) ? store.matches[todayKey] : [];
  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const yesterdayKey = addDaysToDateKey(todayKey, -1);
  const tomorrowMatches = Array.isArray(store.matches?.[tomorrowKey]) ? store.matches[tomorrowKey] : [];
  const yesterdayMatches = Array.isArray(store.matches?.[yesterdayKey]) ? store.matches[yesterdayKey] : [];
  const sourceCoverage = store.sourceCoverage || buildSourceCoverage(store, todayKey);
  const sourceBreakdown = sourceCoverage.sourceBreakdown || {};
  const sourceIsActive = (sourceKey) => Object.keys(sourceBreakdown).some((key) => key.includes(sourceKey));
  const teamSquadSources = Object.values(store.teamSquads || {}).flatMap((item) => item?.sources || []);
  const finishedYesterday = yesterdayMatches.filter((match) => String(match?.status || "").toUpperCase() === "FT");
  const yesterdayScoresFilled = finishedYesterday.filter((match) => String(match?.score || "").includes("-")).length;
  const todaysFinished = todayMatches.filter((match) => String(match?.status || "").toUpperCase() === "FT");
  const todaysLive = todayMatches.filter((match) => ["LIVE", "HT"].includes(String(match?.status || "").toUpperCase()));
  const hasH2hProfile = (match) =>
    Number(match?.h2h?.played || 0) > 0 ||
    Boolean(match?.h2h?.status || match?.h2h?.source || match?.h2hStatus);
  const h2hFilled = todayMatches.filter(hasH2hProfile).length;
  const logoFilled = todayMatches.filter((match) => match?.homeLogo && match?.awayLogo).length;
  const outOfDayMatches = todayMatches.filter((match) => String(match?.date || "") !== String(todayKey)).length;
  const liveMatchesWithMinuteOrFallback = todaysLive.filter(
    (match) => !!match?.minute || Number.isFinite(Number(match?.minuteValue)) || !!match?.liveUpdatedAt
  ).length;
  const standingsCount = Object.keys(store.standings || {}).length;
  const cupSheetCount = Object.keys(store.cupSheets || {}).length;

  const sourceReports = DATA_SCOUT_SOURCES.map((source) => {
    const hasCache =
      (source.key === "openfootball" && Object.keys(store.openfootballProfiles || {}).length > 0) ||
      (source.key === "understat" && Object.keys(store.understatSnapshots || {}).length > 0) ||
      (source.key === "fbref" && Object.keys(store.fbrefSnapshots || {}).length > 0) ||
      (source.key === "football-data" && Object.keys(store.marketProfiles || {}).length > 0) ||
      (source.key === "forza-football" && teamSquadSources.includes("Forza Football")) ||
      (source.key === "football-data-org" && teamSquadSources.includes("football-data.org")) ||
      (source.key === "reep" && teamSquadSources.includes("Reep Football identity"));
    const active = sourceIsActive(source.key) || hasCache || (source.key === "bbc-fixtures" && sourceIsActive("curated-fixture"));
    return {
      ...source,
      status: active ? "actief/gekoppeld" : source.priority === "pilot" ? "pilot/stand-by" : "stand-by",
      collected: active,
    };
  });

  const gaps = [];
  if (finishedYesterday.length > yesterdayScoresFilled) {
    gaps.push({
      title: "Uitslagen gisteren niet volledig",
      count: finishedYesterday.length - yesterdayScoresFilled,
      action: "ESPN, football-data en BBC fallback blijven elke worker-run opnieuw samenvoegen.",
    });
  }
  if (todayMatches.length && logoFilled < todayMatches.length) {
    gaps.push({
      title: "Logo's ontbreken",
      count: todayMatches.length - logoFilled,
      action: "ESPN en TheSportsDB logo-cache vullen ontbrekende clubemblemen automatisch aan.",
    });
  }
  if (todayMatches.length && h2hFilled < todayMatches.length) {
    gaps.push({
      title: "H2H nog niet overal gevuld",
      count: todayMatches.length - h2hFilled,
      action: "Openfootball en opgeslagen historische wedstrijden blijven onderlinge duels aanvullen.",
    });
  }
  if (!tomorrowMatches.length) {
    gaps.push({
      title: "Morgen leeg",
      count: 1,
      action: "Worker haalt morgen via primaire bron plus ESPN/TheSportsDB/football-data fallback opnieuw op.",
    });
  }

  const regressionAssertions = [
    {
      key: "live_minute_present",
      passed: todaysLive.length === 0 || liveMatchesWithMinuteOrFallback === todaysLive.length,
      detail: todaysLive.length
        ? `${liveMatchesWithMinuteOrFallback}/${todaysLive.length} live matches met minuut/fallback`
        : "geen live matches",
      severity: "high",
    },
    {
      key: "h2h_not_empty",
      passed: todayMatches.length === 0 || h2hFilled === todayMatches.length,
      detail: `${h2hFilled}/${todayMatches.length || 0} met H2H`,
      severity: "high",
    },
    {
      key: "first_leg_for_aggregate",
      passed: todayMatches.filter((m) => m?.aggregate?.active && m?.aggregate?.firstLegScore).length === todayMatches.filter((m) => m?.aggregate?.active).length,
      detail: `${todayMatches.filter((m) => m?.aggregate?.active && m?.aggregate?.firstLegScore).length}/${todayMatches.filter((m) => m?.aggregate?.active).length} aggregate met first-leg`,
      severity: "high",
    },
    {
      key: "cupsheets_filled",
      passed: cupSheetCount > 0 || todayMatches.filter((m) => m?.aggregate?.active || String(m?.league || "").toLowerCase().includes("cup")).length === 0,
      detail: `cupSheets=${cupSheetCount}`,
      severity: "medium",
    },
    {
      key: "standings_present",
      passed: standingsCount > 0,
      detail: `standings=${standingsCount}`,
      severity: "high",
    },
    {
      key: "dashboard_selected_matchday_only",
      passed: outOfDayMatches === 0,
      detail: outOfDayMatches === 0 ? "alle matches op gekozen speeldag" : `${outOfDayMatches} match(es) buiten geselecteerde speeldag`,
      severity: "high",
    },
    {
      key: "logos_with_fallback",
      passed: todayMatches.length === 0 || logoFilled === todayMatches.length,
      detail: `${logoFilled}/${todayMatches.length || 0} met logo`,
      severity: "medium",
    },
  ];
  const degraded = regressionAssertions.some((item) => !item.passed && item.severity === "high");

  return {
    lastScan: new Date().toISOString(),
    cadence: "worker elke 10 minuten",
    mode: "gratis databronnen, geen API-key verplicht",
    collected: {
      todayDate: todayKey,
      todayMatches: todayMatches.length,
      tomorrowDate: tomorrowKey,
      tomorrowMatches: tomorrowMatches.length,
      yesterdayDate: yesterdayKey,
      yesterdayMatches: yesterdayMatches.length,
      yesterdayScoresFilled,
      liveMatches: todaysLive.length,
      finishedToday: todaysFinished.length,
      finishedTodayWithScore: todaysFinished.filter((match) => String(match?.score || "").includes("-")).length,
      logosFilledToday: logoFilled,
      h2hFilledToday: h2hFilled,
      reviews: Object.keys(store.postMatchReviews || {}).length,
      teamsWithLearning: Object.keys(store.teamLearning || {}).length,
      marketProfiles: Object.keys(store.marketProfiles || {}).length,
      openfootballProfiles: Object.keys(store.openfootballProfiles || {}).length,
      understatSnapshots: Object.keys(store.understatSnapshots || {}).length,
      fbrefSnapshots: Object.keys(store.fbrefSnapshots || {}).length,
    },
    sources: sourceReports,
    gaps,
    regressionAssertions,
    degraded,
    recommendations: [
      "Gebruik ESPN Scoreboard als vaste score/logo back-up naast de primaire bron.",
      "Gebruik football-data.co.uk voor historische uitslagen, odds, shots en referee-signalen.",
      "Gebruik openfootball voor H2H-backfill wanneer live bronnen geen onderlinge historie geven.",
      "Gebruik Understat en FBref als pilot-signalen voor xG, shotdruk en home/away splits waar bereikbaar.",
    ],
  };
}

async function runSelfHealingRetries(store, todayKey, now) {
  const todayMatches = Array.isArray(store.matches?.[todayKey]) ? store.matches[todayKey] : [];
  const result = {
    attempted: 0,
    healed: 0,
    timedOut: 0,
    details: [],
  };
  const timeoutMs = Number(process.env.SELF_HEALING_TIMEOUT_MS || 4500);
  const concurrency = Number(process.env.SELF_HEALING_CONCURRENCY || 4);
  const withHardTimeout = (promise, label) =>
    Promise.race([
      promise,
      sleep(timeoutMs).then(() => ({ timedOut: true, label })),
    ]);
  const healMatch = async (match) => {
    const problems = [];
    const isLive = ["LIVE", "HT"].includes(String(match?.status || "").toUpperCase());
    if (isLive && !match?.minute && !Number.isFinite(Number(match?.minuteValue))) problems.push("live_minute_present");
    if (Number(match?.h2h?.played || 0) <= 0) problems.push("h2h_not_empty");
    if (match?.aggregate?.active && !match?.aggregate?.firstLegScore) problems.push("first_leg_for_aggregate");
    if (!match?.homeLogo || !match?.awayLogo) problems.push("logos_with_fallback");
    if (!problems.length) return null;
    let changed = false;
    const eventId = String(match?.sofaId || "").replace(/^ss-/, "");
    const detailTask = eventId && (problems.includes("live_minute_present") || problems.includes("first_leg_for_aggregate") || problems.includes("logos_with_fallback"))
      ? fetchEventDetails(eventId)
      : Promise.resolve(null);
    const h2hTask = problems.includes("h2h_not_empty") && eventId && match?.homeTeamId && match?.awayTeamId
      ? fetchH2H(eventId, match.homeTeamId, match.awayTeamId, null, null)
      : Promise.resolve(null);
    const [details, h2h] = await Promise.all([detailTask, h2hTask]);
    if (details) {
      const minuteState = resolveMinuteState(
        { status: details?.status || {}, homeScore: details?.homeScore || {}, awayScore: details?.awayScore || {} },
        details
      );
      if (!match?.minute && (minuteState?.minute || Number.isFinite(Number(minuteState?.minuteValue)))) {
        match.minute = minuteState.minute || match.minute;
        match.minuteValue = minuteState.minuteValue ?? match.minuteValue;
        changed = true;
      }
      if ((!match?.homeLogo || !match?.awayLogo) && details?.homeTeam && details?.awayTeam) {
        const homeLogo = resolveTeamLogoUrl(details.homeTeam, match.homeTeamId, match.homeTeamName, "sofascore");
        const awayLogo = resolveTeamLogoUrl(details.awayTeam, match.awayTeamId, match.awayTeamName, "sofascore");
        if (homeLogo && !match.homeLogo) {
          match.homeLogo = homeLogo;
          changed = true;
        }
        if (awayLogo && !match.awayLogo) {
          match.awayLogo = awayLogo;
          changed = true;
        }
      }
    }
    if (h2h && problems.includes("h2h_not_empty") && eventId && match?.homeTeamId && match?.awayTeamId) {
      const h2hKey = `${eventId}_${match.homeTeamId}_${match.awayTeamId}`;
      const normalized = ensureH2HContract(h2h, match.homeTeamId, match.awayTeamId);
      if (Number(normalized?.played || 0) > 0) {
        match.h2h = normalized;
        match.h2hStatus = normalized.status || "h2h-agent";
        if (!store.h2hCache) store.h2hCache = {};
        store.h2hCache[h2hKey] = { updated: now, data: normalized };
        changed = true;
      }
    }
    if (problems.includes("first_leg_for_aggregate") && match?.aggregate?.active && match?.h2h) {
      const rebuilt = buildAggregateInfo({ bbcMeta: { aggregate: match.aggregate } }, null, match.h2h, null);
      if (rebuilt?.firstLegScore && !match.aggregate.firstLegScore) {
        match.aggregate = { ...match.aggregate, firstLegScore: rebuilt.firstLegScore };
        changed = true;
      }
    }
    if (changed) {
      return { matchId: match.id, healedProblems: problems };
    }
    return { matchId: match.id, healedProblems: [], attemptedProblems: problems };
  };
  const candidates = todayMatches.filter((match) => {
    const status = String(match?.status || "").toUpperCase();
    return (
      (["LIVE", "HT"].includes(status) && !match?.minute && !Number.isFinite(Number(match?.minuteValue))) ||
      Number(match?.h2h?.played || 0) <= 0 ||
      (match?.aggregate?.active && !match?.aggregate?.firstLegScore) ||
      !match?.homeLogo ||
      !match?.awayLogo
    );
  });
  result.attempted = candidates.length;
  for (let index = 0; index < candidates.length; index += concurrency) {
    const batch = candidates.slice(index, index + concurrency);
    const outcomes = await Promise.all(batch.map((match) => withHardTimeout(healMatch(match), match.id)));
    for (const outcome of outcomes) {
      if (!outcome) continue;
      if (outcome.timedOut) {
        result.timedOut += 1;
        result.details.push({ matchId: outcome.label, timedOut: true });
        continue;
      }
      if (Array.isArray(outcome.healedProblems) && outcome.healedProblems.length) result.healed += 1;
      result.details.push(outcome);
    }
  }
  return result;
}

function buildAiRecommendations(store, todayKey) {
  const todayMatches = Array.isArray(store.matches?.[todayKey]) ? store.matches[todayKey] : [];
  const issues = [];

  const h2hMissing = todayMatches.filter((match) => !match?.h2h?.played).length;
  if (h2hMissing > 0) {
    issues.push({
      title: "H2H aanvullen",
      summary: `${h2hMissing} wedstrijd(en) missen nog onderlinge historie.`,
      action: "Voeg waar mogelijk extra competitie-backfill of bronfallback toe in de worker.",
      priority: "medium",
    });
  }

  const bookmakerMissing = todayMatches.filter(
    (match) => !Array.isArray(match?.marketCalibration?.bookmakerSignals) || !match.marketCalibration.bookmakerSignals.length
  ).length;
  if (bookmakerMissing > 0) {
    issues.push({
      title: "Bookmakerdekking verbreden",
      summary: `${bookmakerMissing} wedstrijd(en) missen bookmaker-signalen.`,
      action: "Gebruik extra oddsbron of current-odds fallback voor interlands en zeldzame competities.",
      priority: "medium",
    });
  }

  const sourceCoverage = store.sourceCoverage || null;
  const segmentation = store.backtestSegmentation || null;
  const scout = store.dataScout || null;
  const failedAssertions = (scout?.regressionAssertions || []).filter((item) => !item.passed);
  if (failedAssertions.length) {
    issues.push({
      title: "Regressie-checks gefaald",
      summary: `${failedAssertions.length} harde assertion(s) faalden in de laatste worker-run.`,
      action: failedAssertions.slice(0, 3).map((item) => `${item.key}: ${item.detail}`).join(" | "),
      priority: failedAssertions.some((item) => item.severity === "high") ? "high" : "medium",
    });
  }
  if (sourceCoverage && Number(sourceCoverage.pendingFinishedCount || 0) > 0) {
    issues.push({
      title: "Uitslagen direct vullen",
      summary: `${Number(sourceCoverage.pendingFinishedCount || 0)} afgeronde wedstrijd(en) missen nog een score in de actuele speeldag.`,
      action: "Laat ESPN Scoreboard, football-data en BBC fixturefallback de scorevelden blijven overschrijven wanneer de primaire bron leeg blijft.",
      priority: "high",
    });
  }
  if (sourceCoverage && Number(sourceCoverage.logoCoverage || 0) < 0.95) {
    issues.push({
      title: "Clublogo-cache uitbreiden",
      summary: `Logo-dekking staat op ${Math.round(Number(sourceCoverage.logoCoverage || 0) * 100)}% voor de actuele speeldag.`,
      action: "Gebruik ESPN en TheSportsDB als vaste logobronnen en cache de gevonden logo's per clubnaam/alias.",
      priority: "medium",
    });
  }
  if (sourceCoverage && Number(sourceCoverage.bookmakerCoverage || 0) < 0.7) {
    issues.push({
      title: "Bronkwaliteit odds nog dun",
      summary: `Bookmakerdekking staat op ${Math.round(Number(sourceCoverage.bookmakerCoverage || 0) * 100)}% voor de actuele speeldag.`,
      action: "Verbred internationale oddsfallbacks en gebruik historische closing-signalen als live odds ontbreken.",
      priority: "medium",
    });
  }
  const matchesWithRefereeNames = todayMatches.filter((match) => String(match?.refereeProfile?.name || "").trim()).length;
  if (sourceCoverage && matchesWithRefereeNames >= 3 && Number(sourceCoverage.refereeCoverage || 0) < 0.65) {
    issues.push({
      title: "Referee-matchrate verhogen",
      summary: `Historische referee-dekking staat op ${Math.round(Number(sourceCoverage.refereeCoverage || 0) * 100)}%.`,
      action: "Gebruik bredere aliasvarianten en gecombineerde referee-archieven per land/competitiefamilie.",
      priority: "medium",
    });
  }
  if (sourceCoverage && Number(sourceCoverage.h2hCoverage || 0) < 0.75) {
    issues.push({
      title: "H2H fallback verbreden",
      summary: `H2H-dekking staat op ${Math.round(Number(sourceCoverage.h2hCoverage || 0) * 100)}% voor de actuele speeldag.`,
      action: "Blijf competitiebackfill combineren met neutrale onderlinge fallback buiten de live bron.",
      priority: "medium",
    });
  }
  if (sourceCoverage && Number(sourceCoverage.averageDataCompleteness || 0) > 0 && Number(sourceCoverage.averageDataCompleteness || 0) < 0.58) {
    issues.push({
      title: "Prediction quality gate actief",
      summary: `Gemiddelde bronkwaliteit staat op ${Math.round(Number(sourceCoverage.averageDataCompleteness || 0) * 100)}%; hoge exact-score confidence wordt daarom automatisch afgekapt.`,
      action: "Vul eerst H2H, vorm, actuele standen, xG/shotdata en marktdekking voordat top-5 picks zwaar meetellen.",
      priority: "high",
    });
  }

  const exactReviews = Object.values(store.postMatchReviews || {});
  const exactHitRate =
    exactReviews.length > 0
      ? exactReviews.filter((item) => item.exactHit).length / exactReviews.length
      : 0;
  issues.push({
    title: "Modelkalibratie",
    summary: `Exact-score hitrate staat op ${Math.round(exactHitRate * 100)}% over ${exactReviews.length} reviews.`,
    action: "Gebruik deze score om ensemble- en closing-gewichten te blijven finetunen.",
    priority: exactHitRate < 0.14 ? "high" : "low",
  });

  const diagnostics = store.featureDiagnostics || null;
  const topFailure = diagnostics?.topFailureSignals?.[0] || null;
  if (topFailure) {
    if (topFailure.signal !== "low_model_agreement") {
      issues.push({
        title: "Top faalsignaal",
        summary: `${topFailure.signal} kwam ${topFailure.count} keer terug in de reviewdata.`,
        action: "Gebruik dit signaal om de modelweging of brondekking gericht te verbeteren.",
        priority: topFailure.count >= 8 ? "high" : "medium",
      });
    }
  }

  if (diagnostics?.probabilityOutcomeHitRate != null) {
    issues.push({
      title: "Topkans versus scoremodel",
      summary: `Topkans-hit staat op ${Math.round(Number(diagnostics.probabilityOutcomeHitRate || 0) * 100)}% tegenover ${Math.round(Number(diagnostics.outcomeHitRate || 0) * 100)}% score-uitkomsthit.`,
      action: "Gebruik dit verschil om te bepalen of het model te agressief op exacte score of juist te voorzichtig op 1X2 zit.",
      priority:
        Number(diagnostics.probabilityOutcomeHitRate || 0) - Number(diagnostics.outcomeHitRate || 0) >= 0.12
          ? "medium"
          : "low",
    });
  }

  const topConfidence = diagnostics?.topConfidence || null;
  if (topConfidence && Number(topConfidence.matches || 0) > 0) {
    if (Number(topConfidence.matches || 0) >= 40) {
      issues.push({
        title: "Top 5 zekere tips monitoren",
        summary: `Top-5 tips scoren ${Math.round(Number(topConfidence.exactHitRate || 0) * 100)}% exact en ${Math.round(Number(topConfidence.outcomeHitRate || 0) * 100)}% op winnaar/gelijk over ${topConfidence.matches} reviews.`,
        action:
          Number(topConfidence.versusOverallOutcomeDelta || 0) < -0.08
            ? "Nieuwe selectie blijft na voldoende nieuwe reviews achter. Herweeg scoreselectie opnieuw met bronkwaliteit/marktdekking/modelagreement."
            : "Nieuwe selectie wordt bewaakt; pas opnieuw bij voldoende nieuwe reviewdata.",
        priority: Number(topConfidence.versusOverallOutcomeDelta || 0) < -0.08 ? "high" : "medium",
      });
    }
  }

  const topFailureSignals = diagnostics?.topFailureSignals || [];
  const modelAgreementFailure = topFailureSignals.find((item) => item.signal === "low_model_agreement");
  if (modelAgreementFailure && Number(modelAgreementFailure.count || 0) >= 150) {
    issues.push({
      title: "Modelen zitten te vaak uit elkaar",
      summary: `Low model agreement kwam ${modelAgreementFailure.count} keer terug in reviewdata.`,
      action: "De eerste penalty is geinstalleerd. Heropen alleen als dit signaal na nieuwe reviews blijft oplopen.",
      priority: modelAgreementFailure.count >= 5 ? "high" : "medium",
    });
  }
  const h2hSignalFailure = topFailureSignals.find((item) => item.signal === "h2h_signal");
  if (h2hSignalFailure) {
    issues.push({
      title: "H2H-signaal herwegen",
      summary: `H2H-signal kwam ${h2hSignalFailure.count} keer terug als faalsignaal.`,
      action: "Gebruik H2H alleen zwaar als het recent, voldoende gevuld en competitietype-vergelijkbaar is.",
      priority: "medium",
    });
  }
  const clubEloFailure = topFailureSignals.find((item) => item.signal === "clubelo_misread");
  if (clubEloFailure) {
    issues.push({
      title: "ClubElo interlands strakker scheiden",
      summary: `ClubElo/sterktesprong zat ${clubEloFailure.count} keer mis in de reviews.`,
      action: "Splits interland- en clubkracht nog strakker en temper ClubElo bij nationale teams.",
      priority: "medium",
    });
  }

  if (sourceCoverage && Number(sourceCoverage.understatCoverage || 0) < 0.35 && Number(sourceCoverage.todayMatches || 0) > 0) {
    issues.push({
      title: "Understat xG-dekking bewaken",
      summary: `Understat verrijkt ${Math.round(Number(sourceCoverage.understatCoverage || 0) * 100)}% van de actuele speeldag.`,
      action: "Gebruik Understat vooral op Big-5 competities en blijf Sofascore/FBref gebruiken als xG-backup waar Understat geen competitie ondersteunt.",
      priority: "low",
    });
  }
  if (sourceCoverage && Number(sourceCoverage.fbrefCoverage || 0) < 0.35 && Number(sourceCoverage.todayMatches || 0) > 0) {
    issues.push({
      title: "FBref shot-snapshotdekking bewaken",
      summary: `FBref verrijkt ${Math.round(Number(sourceCoverage.fbrefCoverage || 0) * 100)}% van de actuele speeldag.`,
      action: "Houd FBref via release-snapshots draaien en gebruik de shot/splitvelden als correctielaag wanneer live teamstats dun zijn.",
      priority: "low",
    });
  }

  const performance = store.modelPerformance || null;
  if (performance?.overall?.matches) {
    if (Number(performance.overall.bttsHitRate || 0) < 0.48) {
      issues.push({
        title: "BTTS-model kalibreren",
        summary: `BTTS-hitrate staat op ${Math.round(Number(performance.overall.bttsHitRate || 0) * 100)}% over ${performance.overall.matches} reviews.`,
        action: "Laat BTTS zwaarder steunen op beide-teams-scoren trend, schotdruk en clean-sheet/fail-to-score splits.",
        priority: "medium",
      });
    }
    if (Number(performance.overall.over25HitRate || 0) < 0.5) {
      issues.push({
        title: "Over/under model bewaken",
        summary: `Over 2.5-hitrate staat op ${Math.round(Number(performance.overall.over25HitRate || 0) * 100)}%.`,
        action: "Gebruik xG, tempo, referee en markt-totalen nog strakker voor doelpuntverwachting.",
        priority: "medium",
      });
    }
  }

  const anomalyReport = store.anomalyReport || null;
  if (Number(anomalyReport?.criticalCount || 0) > 0) {
    issues.push({
      title: "Datakwaliteit kritisch",
      summary: `${anomalyReport.criticalCount} kritische anomaly-groep(en) gevonden.`,
      action: "Los eerst ontbrekende eindstanden of corrupte scores op voordat modelwegingen opnieuw worden aangescherpt.",
      priority: "high",
    });
  }

  if (Array.isArray(segmentation?.driftAlerts) && segmentation.driftAlerts.length) {
    const top = segmentation.driftAlerts[0];
    issues.push({
      title: "Performance drift gedetecteerd",
      summary: `${top.scope} ${top.key} daalde ${Math.round(Math.abs(Number(top.delta || 0)) * 100)}pp op outcome-hitrate.`,
      action: "Verhoog bronkwaliteit op deze scope en herweeg league/phase calibratie met recente reviews.",
      priority: String(top.severity || "medium"),
    });
  }

  return issues;
}

function buildBacktestSegmentation(store) {
  const previous = store.backtestSegmentation || null;
  const reviews = Object.values(store.postMatchReviews || {}).filter(Boolean);
  const byLeague = {};
  const byPhase = {};
  for (const review of reviews) {
    const league = String(review?.league || "unknown");
    const phase = String(review?.phaseBucket || "unknown");
    if (!byLeague[league]) byLeague[league] = { matches: 0, outcomeHits: 0, exactHits: 0 };
    if (!byPhase[phase]) byPhase[phase] = { matches: 0, outcomeHits: 0, exactHits: 0 };
    byLeague[league].matches += 1;
    byPhase[phase].matches += 1;
    byLeague[league].outcomeHits += review?.outcomeHit ? 1 : 0;
    byPhase[phase].outcomeHits += review?.outcomeHit ? 1 : 0;
    byLeague[league].exactHits += review?.exactHit ? 1 : 0;
    byPhase[phase].exactHits += review?.exactHit ? 1 : 0;
  }
  const normalize = (obj) =>
    Object.fromEntries(
      Object.entries(obj).map(([key, row]) => {
        const matches = Math.max(Number(row.matches || 0), 1);
        return [
          key,
          {
            matches: Number(row.matches || 0),
            outcomeHitRate: Number((Number(row.outcomeHits || 0) / matches).toFixed(3)),
            exactHitRate: Number((Number(row.exactHits || 0) / matches).toFixed(3)),
          },
        ];
      })
    );
  const leagues = normalize(byLeague);
  const phases = normalize(byPhase);
  const driftAlerts = [];
  if (previous?.leagues) {
    for (const [league, row] of Object.entries(leagues)) {
      const prev = previous.leagues?.[league];
      if (!prev || Number(row.matches || 0) < 12 || Number(prev.matches || 0) < 12) continue;
      const delta = Number((Number(row.outcomeHitRate || 0) - Number(prev.outcomeHitRate || 0)).toFixed(3));
      if (delta <= -0.08) {
        driftAlerts.push({
          scope: "league",
          key: league,
          metric: "outcomeHitRate",
          delta,
          current: row.outcomeHitRate,
          previous: prev.outcomeHitRate,
          severity: "high",
        });
      }
    }
  }
  if (previous?.phases) {
    for (const [phase, row] of Object.entries(phases)) {
      const prev = previous.phases?.[phase];
      if (!prev || Number(row.matches || 0) < 12 || Number(prev.matches || 0) < 12) continue;
      const delta = Number((Number(row.outcomeHitRate || 0) - Number(prev.outcomeHitRate || 0)).toFixed(3));
      if (delta <= -0.08) {
        driftAlerts.push({
          scope: "phase",
          key: phase,
          metric: "outcomeHitRate",
          delta,
          current: row.outcomeHitRate,
          previous: prev.outcomeHitRate,
          severity: "medium",
        });
      }
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    totalReviews: reviews.length,
    leagues,
    phases,
    driftAlerts,
  };
}

async function main() {
  let store = defaultStore();
  if (fs.existsSync(DATA_FILE)) {
    try {
      store = { ...store, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) };
    } catch {
      console.warn("[worker] kon server_data.json niet lezen, start leeg");
    }
  }

  const now = Date.now();
  const today = toAmsterdamDateKey(new Date());
  const yesterday = addDaysToDateKey(today, -1);
  const tomorrow = addDaysToDateKey(today, 1);
  // Houd bewust meerdere dagen vooruit vast. Als een geplande worker-run een
  // keer wordt overgeslagen, blijft de kalenderstatus betrouwbaarder.
  const dates = buildRefreshDateWindow(today);
  console.log(`[worker] datumvenster: ${dates.join(", ")}`);

  if (!store.knockoutOverview) store.knockoutOverview = {};
  if (!store.cupSheets) store.cupSheets = {};
  if (!store.marketProfiles) store.marketProfiles = {};
  if (!store.marketProfilesUpdated) store.marketProfilesUpdated = {};
  if (!store.postMatchReviews) store.postMatchReviews = {};
  if (!store.leagueCalibrationProfiles) store.leagueCalibrationProfiles = {};
  if (!store.leagueCalibrationProfilesByWindow) store.leagueCalibrationProfilesByWindow = {};
  if (!store.leagueCalibrationRollbackProfiles) store.leagueCalibrationRollbackProfiles = {};
  if (!store.backtestSegmentation) store.backtestSegmentation = null;
  if (!store.teamPostMatchStats) store.teamPostMatchStats = {};
  if (!store.predictionSnapshots) store.predictionSnapshots = {};
  if (!store.predictionSnapshotIndex) store.predictionSnapshotIndex = {};
  if (!store.teamLearning) store.teamLearning = {};
  if (!store.leagueReliability) store.leagueReliability = {};
  if (!store.phaseReliability) store.phaseReliability = {};
  if (!store.teamSquads) store.teamSquads = {};
  if (!store.teamSquadsUpdated) store.teamSquadsUpdated = {};
  if (!store.teamTransfers) store.teamTransfers = {};
  if (!store.teamTransfersUpdated) store.teamTransfersUpdated = {};
  purgeExcludedContent(store);
  await repairStoredLogos(store);
  repairStoredPredictionScoreSelections(store);
  compactStore(store, today, now);
  for (const date of dates) store.knockoutOverview[date] = [];
  rebuildReviewsAndLearning(store);

  let clubEloSnapshot = store.clubEloCache;
  if (!clubEloSnapshot || !store.clubEloUpdated || now - store.clubEloUpdated > CLUB_ELO_TTL) {
    clubEloSnapshot = await fetchClubEloSnapshot(today);
    if (clubEloSnapshot) {
      store.clubEloCache = clubEloSnapshot;
      store.clubEloUpdated = now;
    }
  }

  const allEvents = {};
  const fixtureSourceDiagnostics = {};
  const teamTournamentMap = new Map();
  const tournamentsMap = new Map();
  const requiredTeamIds = new Set();

  for (const date of dates) {
    const json = await safeFetch(`${SOFA}/sport/football/scheduled-events/${date}`);
    
    // Handle different possible API response structures
    let apiEvents = [];
    if (Array.isArray(json)) {
      apiEvents = json;
    } else if (json?.events && Array.isArray(json.events)) {
      apiEvents = json.events;
    } else if (json?.data && Array.isArray(json.data)) {
      apiEvents = json.data;
    }
    
    if (apiEvents.length > 0) {
      console.log(`[worker] ${date}: ${apiEvents.length} events van API, filtering...`);
    }
    
    let events = apiEvents
      .filter((event) => {
        const key = event?.startTimestamp
          ? toAmsterdamDateKey(new Date(Number(event.startTimestamp) * 1000))
          : null;
        return key === date;
      })
      .filter((event) => getLeagueInfo(event));

    const fallbackEvents = await fetchFallbackScheduledEventsFromMarket(date);
    const sportsDbEvents = await fetchSportsDbScheduledEvents(date);
    const espnEvents = await fetchEspnScoreboardEventsSource(date, {
      espnScoreboardLeagues: ESPN_SCOREBOARD_LEAGUES,
      leagues: LEAGUES,
      isWomenContext,
      isYouthContext,
      toAmsterdamDateKey,
      toNumber,
      parseMinuteFromDescription,
      normalizeName,
      sleep,
    });
    const openLigaDbEvents = await fetchOpenLigaDbScheduledEvents(date);
    const bbcEvents = await fetchBbcScheduledEventsSource(date, {
      bbcCompetitionToLabel: BBC_COMPETITION_TO_LABEL,
      espnScoreboardLeagues: ESPN_SCOREBOARD_LEAGUES,
      leagues: LEAGUES,
      buildPossibleNames,
      buildLogoLookupNames,
      normalizeName,
      buildFootballDataKickoffIso,
      isWomenContext,
      isYouthContext,
      sleep,
    });
    const curatedEvents = fetchCuratedFixtureBackfill(date);
    fixtureSourceDiagnostics[date] = {
      checkedAt: new Date(now).toISOString(),
      sofascore: apiEvents.length,
      sofascoreFiltered: events.length,
      footballData: fallbackEvents.length,
      theSportsDb: sportsDbEvents.length,
      espn: espnEvents.length,
      openLigaDb: openLigaDbEvents.length,
      bbc: bbcEvents.length,
      curated: curatedEvents.length,
    };
    const combinedFallbacks = dedupeFallbackEvents([
      ...events,
      ...fallbackEvents,
      ...sportsDbEvents,
      ...espnEvents,
      ...openLigaDbEvents,
      ...bbcEvents,
      ...curatedEvents,
    ]);

    if (fallbackEvents.length) {
      console.log(`[worker] ${date}: ${fallbackEvents.length} fallback events uit football-data.co.uk`);
    }
    if (sportsDbEvents.length) {
      console.log(`[worker] ${date}: ${sportsDbEvents.length} fallback events uit TheSportsDB`);
    }
    if (espnEvents.length) {
      console.log(`[worker] ${date}: ${espnEvents.length} fallback events uit ESPN scoreboard`);
    }
    if (openLigaDbEvents.length) {
      console.log(`[worker] ${date}: ${openLigaDbEvents.length} fallback events uit OpenLigaDB`);
    }
    if (bbcEvents.length) {
      console.log(`[worker] ${date}: ${bbcEvents.length} fallback events uit BBC fixtures`);
    }
    if (curatedEvents.length) {
      console.log(`[worker] ${date}: ${curatedEvents.length} fallback events uit curated fixtures`);
    }
    if (combinedFallbacks.length) {
      events = combinedFallbacks.map((event) => applyCuratedResultBackfill(event, date));
    }
    fixtureSourceDiagnostics[date].combined = events.length;
    
    if (events.length > 0) {
      console.log(`[worker] ${date}: ${events.length} events na filtering (${apiEvents.length} totaal)`);
    } else if (apiEvents.length > 0) {
      console.warn(`[worker] ${date}: WAARSCHUWING - ${apiEvents.length} API events maar 0 na filtering!`);
    }
    
    allEvents[date] = events;

    for (const event of events) {
      const leagueInfo = getLeagueInfo(event);
      const homeId = String(event.homeTeam?.id || "");
      const awayId = String(event.awayTeam?.id || "");
      const homeName = event.homeTeam?.name || "Home";
      const awayName = event.awayTeam?.name || "Away";
      const tournamentId =
        event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id || event.tournament?.id || null;
      const seasonId = event.season?.id || null;

      if (homeId) requiredTeamIds.add(homeId);
      if (awayId) requiredTeamIds.add(awayId);
      if (homeId && tournamentId && seasonId) {
        teamTournamentMap.set(homeId, {
          tournamentId,
          seasonId,
          teamName: homeName,
          tournamentName: event?.tournament?.name || event?.uniqueTournament?.name || "",
          label: leagueInfo.label,
        });
      }
      if (awayId && tournamentId && seasonId) {
        teamTournamentMap.set(awayId, {
          tournamentId,
          seasonId,
          teamName: awayName,
          tournamentName: event?.tournament?.name || event?.uniqueTournament?.name || "",
          label: leagueInfo.label,
        });
      }
      if (tournamentId && seasonId && leagueInfo) {
        tournamentsMap.set(`${tournamentId}_${seasonId}`, { tournamentId, seasonId, label: leagueInfo.label });
      }
    }
  }

  const allActiveLeagueLabels = [
    ...new Set(
      Object.values(allEvents)
        .flat()
        .map((event) => getLeagueInfo(event)?.label)
        .filter(Boolean)
    ),
  ];
  const activeLeagueLabels = [
    ...new Set([
      ...allActiveLeagueLabels.filter((label) => MARKET_LEAGUE_CODES[label]),
      ...TEAM_FORM_HISTORY_LEAGUES,
    ]),
  ];

  for (const leagueLabel of activeLeagueLabels) {
    const existingMarketProfile = store.marketProfiles[leagueLabel] || null;
    const missingHistoricalStats =
      existingMarketProfile?.teams &&
      !Object.values(existingMarketProfile.teams || {}).some((team) => team?.historicalStats?.statsRows);
    const missingHistoricalTeamForm =
      existingMarketProfile?.teams &&
      !Object.values(existingMarketProfile.teams || {}).some(
        (team) => Array.isArray(team?.recentMatches) && team.recentMatches.length
      );
    if (
      !existingMarketProfile ||
      missingHistoricalStats ||
      missingHistoricalTeamForm ||
      now - Number(store.marketProfilesUpdated?.[leagueLabel] || 0) > MARKET_TTL
    ) {
      const marketProfile = await fetchHistoricalMarketProfile(leagueLabel, today);
      if (marketProfile) {
        store.marketProfiles[leagueLabel] = marketProfile;
        store.marketProfilesUpdated[leagueLabel] = now;
        await sleep(50);
      }
    }
  }

  for (const leagueLabel of allActiveLeagueLabels) {
    const existingOpenFootballProfile = store.openfootballProfiles[leagueLabel] || null;
    const missingOpenFootballTeamForm =
      existingOpenFootballProfile?.h2hPairs &&
      !Object.values(existingOpenFootballProfile.teams || {}).some(
        (team) => Array.isArray(team?.recentMatches) && team.recentMatches.length
      );
    if (
      OPENFOOTBALL_COMPETITIONS[leagueLabel] &&
      (!store.openfootballProfiles[leagueLabel] ||
        missingOpenFootballTeamForm ||
        now - Number(store.openfootballProfilesUpdated?.[leagueLabel] || 0) > OPENFOOTBALL_TTL)
    ) {
      const openfootballProfile = await fetchOpenfootballProfileSource(leagueLabel, today, {
        openfootballCompetitions: OPENFOOTBALL_COMPETITIONS,
        getOpenfootballSeasonTags,
        toNumber,
        buildH2HProfileFromResults,
      });
      if (openfootballProfile) {
        store.openfootballProfiles[leagueLabel] = openfootballProfile;
        store.openfootballProfilesUpdated[leagueLabel] = now;
        await sleep(40);
      }
    }

    if (
      UNDERSTAT_LEAGUE_CODES[leagueLabel] &&
      (!store.understatSnapshots[leagueLabel] ||
        now - Number(store.understatSnapshotsUpdated?.[leagueLabel] || 0) > SNAPSHOT_TTL)
    ) {
      const understatSnapshot = await fetchUnderstatSnapshotSource(leagueLabel, today, {
        understatLeagueCodes: UNDERSTAT_LEAGUE_CODES,
        normalizeName,
      });
      if (understatSnapshot) {
        store.understatSnapshots[leagueLabel] = understatSnapshot;
        store.understatSnapshotsUpdated[leagueLabel] = now;
        await sleep(80);
      }
    }

    if (
      FBREF_RELEASE_CODES[leagueLabel] &&
      (!store.fbrefSnapshots[leagueLabel] ||
        now - Number(store.fbrefSnapshotsUpdated?.[leagueLabel] || 0) > SNAPSHOT_TTL)
    ) {
      const fbrefSnapshot = await fetchFbrefSnapshotSource(leagueLabel, today, {
        fbrefReleaseCodes: FBREF_RELEASE_CODES,
        getSeasonFolder,
        parseCsv,
        normalizeName,
        toNumber,
      });
      if (fbrefSnapshot) {
        store.fbrefSnapshots[leagueLabel] = fbrefSnapshot;
        store.fbrefSnapshotsUpdated[leagueLabel] = now;
        await sleep(80);
      }
    }
  }

  const globalRefereeArchive = mergeRefereeArchives(Object.values(store.marketProfiles || {}));

  for (const teamId of requiredTeamIds) {
    if (!store.teamStats[teamId] || now - Number(store.teamStatsUpdated?.[teamId] || 0) > FORM_TTL) {
      store.teamStats[teamId] = await fetchTeamForm(teamId, {
        teamName: teamTournamentMap.get(teamId)?.teamName,
        tournamentName: teamTournamentMap.get(teamId)?.tournamentName,
        segment: getCompetitionSegment(
          teamTournamentMap.get(teamId)?.teamName,
          teamTournamentMap.get(teamId)?.tournamentName
        ),
      });
      store.teamStatsUpdated[teamId] = now;
      await sleep(90);
    }
    if (!store.teamInjuries[teamId] || now - Number(store.teamInjuriesUpdated?.[teamId] || 0) > INJURY_TTL) {
      store.teamInjuries[teamId] = await fetchInjuries(teamId, teamTournamentMap.get(teamId) || {});
      store.teamInjuriesUpdated[teamId] = now;
      await sleep(70);
    }
    const seasonInfo = teamTournamentMap.get(teamId);
    if (seasonInfo) {
      const existingSeasonStats = store.teamSeasonStats[teamId] || null;
      const seasonStatsStale =
        !existingSeasonStats || now - Number(store.teamSeasonStatsUpdated?.[teamId] || 0) > SEASON_TTL;
      const hasSnapshotMatch = Boolean(
        lookupSnapshotTeam(store.understatSnapshots?.[seasonInfo.label], seasonInfo.teamName) ||
          lookupSnapshotTeam(store.fbrefSnapshots?.[seasonInfo.label], seasonInfo.teamName)
      );
      const existingSources = Array.isArray(existingSeasonStats?.externalSources)
        ? existingSeasonStats.externalSources.map((source) => String(source).toLowerCase())
        : [];
      const missingSnapshotMerge =
        hasSnapshotMatch && !existingSources.some((source) => source === "understat" || source === "fbref");

      if (seasonStatsStale || missingSnapshotMerge) {
        const baseSeasonStats = seasonStatsStale
          ? await fetchSeasonStats(teamId, seasonInfo.tournamentId, seasonInfo.seasonId)
          : existingSeasonStats;
        store.teamSeasonStats[teamId] = mergeSeasonStatsWithSnapshots(
          baseSeasonStats,
          seasonInfo.teamName,
          seasonInfo.label,
          store
        );
        store.teamSeasonStatsUpdated[teamId] = now;
        if (seasonStatsStale) await sleep(70);
      }
    }
  }

  const standingsByTournament = {};
  for (const [key, info] of tournamentsMap.entries()) {
    if (!isStandingLeagueLabel(info.label)) continue;
    const cached = store.standings[key];
    const cachedIsOverlay = String(cached?.source || "").includes("live-match-overlay");
    if (cached?.rows?.length && !cachedIsOverlay && now - Number(cached.updated || 0) <= STANDINGS_TTL) {
      standingsByTournament[key] = cached;
      continue;
    }
    const fresh = await fetchStandings(info.tournamentId, info.seasonId, info.label, today);
    if (fresh) {
      store.standings[key] = fresh;
      store.standings[`label:${info.label}`] = fresh;
      standingsByTournament[key] = fresh;
      standingsByTournament[`label:${info.label}`] = fresh;
      await sleep(60);
    }
  }

  for (const leagueLabel of allActiveLeagueLabels.filter(isStandingLeagueLabel)) {
    const labelKey = `label:${leagueLabel}`;
    const cached = store.standings[labelKey];
    const cachedIsOverlay = String(cached?.source || "").includes("live-match-overlay");
    if (cached?.rows?.length && !cachedIsOverlay && now - Number(cached.updated || 0) <= STANDINGS_TTL) {
      standingsByTournament[labelKey] = cached;
      continue;
    }
    const fresh = await fetchStandings(null, null, leagueLabel, today);
    if (fresh) {
      store.standings[labelKey] = fresh;
      standingsByTournament[labelKey] = fresh;
      await sleep(40);
    }
  }

  for (const date of dates) {
    const dayMatches = [];
    const dayPredictions = [];

    for (const event of allEvents[date] || []) {
      const leagueInfo = getLeagueInfo(event);
      if (!leagueInfo) continue;
      const isFallbackEvent = String(event?.source || "").includes("fallback");

      const homeId = String(event.homeTeam?.id || "");
      const awayId = String(event.awayTeam?.id || "");
      const homeName = event.homeTeam?.name || "Home";
      const awayName = event.awayTeam?.name || "Away";
      const homeCountry = String(event.homeTeam?.country?.name || event.tournament?.category?.name || "");
      const awayCountry = String(event.awayTeam?.country?.name || event.tournament?.category?.name || "");
      const kickoff = event.startTimestamp ? new Date(event.startTimestamp * 1000).toISOString() : null;
      const tournamentId =
        event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id || event.tournament?.id || null;
      const seasonId = event.season?.id || null;
      const standingsKey = tournamentId && seasonId ? `${tournamentId}_${seasonId}` : "";
      const labelStandingKey = `label:${leagueInfo.label}`;
      const standing = standingsByTournament[standingsKey] || store.standings[standingsKey] || standingsByTournament[labelStandingKey] || store.standings[labelStandingKey] || null;
      const standingMeta = standing?.meta || null;
      const homeStandingRow = findStandingRow(standing, homeId, homeName);
      const awayStandingRow = findStandingRow(standing, awayId, awayName);
      const homePos = homeStandingRow?.pos ?? null;
      const awayPos = awayStandingRow?.pos ?? null;

      getTeam(store.teams, homeId, homeName);
      getTeam(store.teams, awayId, awayName);

      let eventDetails = isFallbackEvent ? null : store.eventCache?.[event.id] || null;
      if (!isFallbackEvent && (!eventDetails || now - Number(store.eventCacheUpdated?.[event.id] || 0) > EVENT_TTL)) {
        eventDetails = await fetchEventDetails(event.id);
        if (eventDetails) {
          store.eventCache[event.id] = eventDetails;
          store.eventCacheUpdated[event.id] = now;
        }
        await sleep(60);
      }

      let lineupSummary = isFallbackEvent ? null : await fetchLineupSummary(event.id);
      if (lineupSummary) lineupSummary = { ...lineupSummary, source: "sofascore lineups" };

      const h2hKey = `${event.id}_${homeId}_${awayId}`;
      let h2h = isFallbackEvent ? null : store.h2hCache?.[h2hKey]?.data || null;
      if (!isFallbackEvent && (!h2h || now - Number(store.h2hCache?.[h2hKey]?.updated || 0) > H2H_TTL)) {
        h2h = await fetchH2H(event.id, homeId, awayId, tournamentId, seasonId);
        store.h2hCache[h2hKey] = { updated: now, data: h2h };
        await sleep(60);
      }

      const coords = getCoords(eventDetails);
      const weatherKey = coords && kickoff ? `${coords.lat.toFixed(2)}_${coords.lon.toFixed(2)}_${kickoff.slice(0, 13)}` : null;
      let weather = weatherKey ? store.weatherCache?.[weatherKey]?.data || null : null;
      if (weatherKey && (!weather || now - Number(store.weatherCache?.[weatherKey]?.updated || 0) > WEATHER_TTL)) {
        weather = await fetchWeather(coords.lat, coords.lon, kickoff);
        if (!store.weatherCache) store.weatherCache = {};
        store.weatherCache[weatherKey] = { updated: now, data: weather };
      }

      const leagueMarketProfile = store.marketProfiles[leagueInfo.label] || null;
      const openFootballProfile = store.openfootballProfiles[leagueInfo.label] || null;
      const globalTeamFormProfiles = [
        ...Object.values(store.marketProfiles || {}),
        ...Object.values(store.openfootballProfiles || {}),
      ];
      let homeRecent = mergeTeamFormWithHistorical(
        store.teamStats[homeId] || null,
        leagueMarketProfile,
        openFootballProfile,
        homeName,
        globalTeamFormProfiles
      );
      let awayRecent = mergeTeamFormWithHistorical(
        store.teamStats[awayId] || null,
        leagueMarketProfile,
        openFootballProfile,
        awayName,
        globalTeamFormProfiles
      );
      if (homeId && (homeRecent?.recentMatches || []).length > (store.teamStats[homeId]?.recentMatches || []).length) {
        store.teamStats[homeId] = homeRecent;
        store.teamStatsUpdated[homeId] = now;
      }
      if (awayId && (awayRecent?.recentMatches || []).length > (store.teamStats[awayId]?.recentMatches || []).length) {
        store.teamStats[awayId] = awayRecent;
        store.teamStatsUpdated[awayId] = now;
      }
      const fallbackPreviousLeg = findPreviousLegFromRecent(
        homeRecent,
        awayRecent,
        homeId,
        awayId,
        homeName,
        awayName,
        tournamentId,
        seasonId,
        event.id
      );
      const aggregatePreviousLeg = buildH2HFromAggregateMeta(event, homeId, awayId, homeName, awayName, date);
      const h2hFallbackLegs = [fallbackPreviousLeg, aggregatePreviousLeg].filter(Boolean);
      h2h = buildH2HAgentProfile({
        baseH2H: h2h,
        fallbackLegs: h2hFallbackLegs,
        marketProfile: leagueMarketProfile,
        openFootballProfile,
        extraProfiles: globalTeamFormProfiles,
        homeName,
        awayName,
        homeId,
        awayId,
      });
      h2h = ensureH2HContract(h2h, homeId, awayId);
      homeRecent = ensureRecentFormContract(supplementTeamFormWithH2H(homeRecent, h2h, homeName), homeName, h2h, homeId, awayId);
      awayRecent = ensureRecentFormContract(supplementTeamFormWithH2H(awayRecent, h2h, awayName), awayName, h2h, awayId, homeId);
      const formQualityWarnings = [];
      if (!Number.isFinite(Number(h2h?.played)) || Number(h2h?.played || 0) <= 0) formQualityWarnings.push("h2h_empty");
      if (Number(homeRecent?.gamesPlayed || 0) < 10) formQualityWarnings.push(`home_form_lt10:${Number(homeRecent?.gamesPlayed || 0)}`);
      if (Number(awayRecent?.gamesPlayed || 0) < 10) formQualityWarnings.push(`away_form_lt10:${Number(awayRecent?.gamesPlayed || 0)}`);
      if (formQualityWarnings.length) {
        console.warn("[worker:data-quality]", {
          matchId: `ss-${event.id}`,
          league: leagueInfo.label,
          homeTeam: homeName,
          awayTeam: awayName,
          warnings: formQualityWarnings,
          h2hStatus: h2h?.status || null,
          h2hSource: h2h?.source || null,
          homeFormSource: homeRecent?.source || null,
          awayFormSource: awayRecent?.source || null,
        });
      }
      if (homeId && (homeRecent?.recentMatches || []).length > (store.teamStats[homeId]?.recentMatches || []).length) {
        store.teamStats[homeId] = homeRecent;
        store.teamStatsUpdated[homeId] = now;
      }
      if (awayId && (awayRecent?.recentMatches || []).length > (store.teamStats[awayId]?.recentMatches || []).length) {
        store.teamStats[awayId] = awayRecent;
        store.teamStatsUpdated[awayId] = now;
      }
      const aggregate = buildAggregateInfo(event, eventDetails, h2h, fallbackPreviousLeg);
      const homeRestDays = calcRestDays(homeRecent?.lastMatchKickoff, kickoff);
      const awayRestDays = calcRestDays(awayRecent?.lastMatchKickoff, kickoff);
      const matchImportance = calcMatchImportance(homePos, awayPos, standing?.rows?.length || 20);
      const context = buildContext({
        standingMeta,
        homePos,
        awayPos,
        leagueType: leagueInfo.type,
        aggregate,
        homeTeamName: homeName,
        awayTeamName: awayName,
        homeCountry,
        awayCountry,
      });

      const homeClubElo = lookupClubElo(clubEloSnapshot, homeName);
      const awayClubElo = lookupClubElo(clubEloSnapshot, awayName);
      const homeMarketProfile = lookupMarketTeamProfile(leagueMarketProfile, homeName);
      const awayMarketProfile = lookupMarketTeamProfile(leagueMarketProfile, awayName);
      const homeLearning = store.teamLearning[homeId ? `id:${homeId}` : `name:${normalizeName(homeName)}`] || null;
      const awayLearning = store.teamLearning[awayId ? `id:${awayId}` : `name:${normalizeName(awayName)}`] || null;
      const leagueReliability = store.leagueReliability?.[leagueInfo.label] || null;
      const roundLabel = extractRoundLabel(eventDetails);
      const phaseBucket = getReliabilityBucket({
        league: leagueInfo.label,
        leagueType: leagueInfo.type,
        aggregate,
        context,
        roundLabel,
      });
      const phaseReliability = store.phaseReliability?.[phaseBucket] || null;

      const minuteState = resolveMinuteState(event, eventDetails);
      const homeSeasonStats = mergeSeasonStatsWithSnapshots(
        store.teamSeasonStats[homeId] || null,
        homeName,
        leagueInfo.label,
        store
      );
      const awaySeasonStats = mergeSeasonStatsWithSnapshots(
        store.teamSeasonStats[awayId] || null,
        awayName,
        leagueInfo.label,
        store
      );
      if (homeId && homeSeasonStats?.externalSources?.length) store.teamSeasonStats[homeId] = homeSeasonStats;
      if (awayId && awaySeasonStats?.externalSources?.length) store.teamSeasonStats[awayId] = awaySeasonStats;

      const homeIntelligence = await updateTeamIntelligence(store, {
        teamId: homeId,
        teamName: homeName,
        recent: homeRecent,
        seasonStats: homeSeasonStats,
        injuries: store.teamInjuries[homeId] || null,
        clubElo: homeClubElo,
        standingPos: homePos,
        now,
      });
      const awayIntelligence = await updateTeamIntelligence(store, {
        teamId: awayId,
        teamName: awayName,
        recent: awayRecent,
        seasonStats: awaySeasonStats,
        injuries: store.teamInjuries[awayId] || null,
        clubElo: awayClubElo,
        standingPos: awayPos,
        now,
      });

      const homeTeamProfile = buildTeamProfile({
        teamName: homeName,
        recent: homeRecent,
        seasonStats: homeSeasonStats,
        postMatchStatsProfile: store.teamPostMatchStats?.[homeId ? `id:${homeId}` : `name:${normalizeName(homeName)}`] || null,
        injuries: store.teamInjuries[homeId] || null,
        clubElo: homeClubElo,
        standingPos: homePos,
        squadProfile: homeIntelligence.squadProfile,
        transferProfile: homeIntelligence.transferProfile,
      });
      const awayTeamProfile = buildTeamProfile({
        teamName: awayName,
        recent: awayRecent,
        seasonStats: awaySeasonStats,
        postMatchStatsProfile: store.teamPostMatchStats?.[awayId ? `id:${awayId}` : `name:${normalizeName(awayName)}`] || null,
        injuries: store.teamInjuries[awayId] || null,
        clubElo: awayClubElo,
        standingPos: awayPos,
        squadProfile: awayIntelligence.squadProfile,
        transferProfile: awayIntelligence.transferProfile,
      });
      const referee = extractReferee(eventDetails);
      const historicalRefereeProfile = lookupHistoricalRefereeProfile(leagueMarketProfile, referee?.name, globalRefereeArchive);
      let supplementalOdds = null;
      if (
        !isFallbackEvent &&
        (
          String(leagueInfo.label || "").toLowerCase().includes("qualification") ||
          String(leagueInfo.label || "").toLowerCase().includes("friendly") ||
          String(leagueInfo.label || "").toLowerCase().includes("international")
        )
      ) {
        supplementalOdds = await fetchEventBookmakerOdds(event.id);
      }
      const marketCalibration = buildMarketCalibration({
        homeMarketProfile,
        awayMarketProfile,
        homeTeamProfile,
        awayTeamProfile,
        leagueMarketProfile,
        supplementalOdds,
      });
      const refereeProfile = buildRefereeProfile(
        referee,
        homeRecent,
        awayRecent,
        marketCalibration,
        historicalRefereeProfile
      );
      const teamIdentity = buildTeamIdentity(homeId, awayId, homeName, awayName, String(event.source || "sofascore"));
      const lineupStatus = resolveLineupStatus(lineupSummary);
      const refereeStatus = resolveRefereeStatus(refereeProfile);
      const sourceAsOf = {
        fixture: isoFromTimestamp(now),
        h2h: isoFromTimestamp(store.h2hCache?.[h2hKey]?.updated),
        weather: weatherKey ? isoFromTimestamp(store.weatherCache?.[weatherKey]?.updated) : null,
        homeForm: homeId ? isoFromTimestamp(store.teamStatsUpdated?.[homeId]) : null,
        awayForm: awayId ? isoFromTimestamp(store.teamStatsUpdated?.[awayId]) : null,
        homeSeasonStats: homeId ? isoFromTimestamp(store.teamSeasonStatsUpdated?.[homeId]) : null,
        awaySeasonStats: awayId ? isoFromTimestamp(store.teamSeasonStatsUpdated?.[awayId]) : null,
        homeInjuries: homeId ? isoFromTimestamp(store.teamInjuriesUpdated?.[homeId]) : null,
        awayInjuries: awayId ? isoFromTimestamp(store.teamInjuriesUpdated?.[awayId]) : null,
        standings: isoFromTimestamp(standing?.updated || standingMeta?.updated || 0),
        marketProfile: isoFromTimestamp(store.marketProfilesUpdated?.[leagueInfo.label]),
        openfootballProfile: isoFromTimestamp(store.openfootballProfilesUpdated?.[leagueInfo.label]),
        understat: isoFromTimestamp(store.understatSnapshotsUpdated?.[leagueInfo.label]),
        fbref: isoFromTimestamp(store.fbrefSnapshotsUpdated?.[leagueInfo.label]),
        lineups: lineupSummary ? isoFromTimestamp(now) : null,
        referee: refereeProfile?.name ? isoFromTimestamp(store.marketProfilesUpdated?.[leagueInfo.label] || now) : null,
      };
      const matchId = `ss-${event.id}`;
      const dbFeatureContext = await readDatabaseFeatureContext({
        matchId,
        homeClubId: homeId ? String(homeId) : null,
        awayClubId: awayId ? String(awayId) : null,
        competitionId: null,
        dateKey: date,
        homeTeamName: homeName,
        awayTeamName: awayName,
      }).catch(() => null);

      const prediction = predict({
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeTeamName: homeName,
        awayTeamName: awayName,
        teamIdentity,
        sourceAsOf,
        lineupStatus,
        refereeStatus,
        homeRecent,
        awayRecent,
        homeSeasonStats,
        awaySeasonStats,
        homeInjuries: store.teamInjuries[homeId] || null,
        awayInjuries: store.teamInjuries[awayId] || null,
        homeRestDays,
        awayRestDays,
        weather,
        lineupSummary,
        h2h,
        homeClubElo,
        awayClubElo,
        homeTeamProfile,
        awayTeamProfile,
        homeCountry,
        awayCountry,
        leagueType: leagueInfo.type,
        context,
        homeStandingPos: homePos,
        awayStandingPos: awayPos,
        standingTotalTeams: standing?.rows?.length || 20,
        matchImportance,
        homeMarketProfile,
        awayMarketProfile,
        homeLearning,
        awayLearning,
        leagueReliability,
        phaseReliability,
        marketCalibration,
        dbFeatureContext,
        refereeProfile,
        modelPerformance: store.modelPerformance,
        leagueCalibrationProfile: store.leagueCalibrationProfiles?.[leagueInfo.label] || null,
        assertionDegraded: !!store.dataScout?.degraded,
      });

      const generatedAtIso = isoFromMs(now) || new Date(now).toISOString();
      const oddsCapture = await fetchOddsAtPrediction(
        {
          matchId,
          league: leagueInfo.label,
          homeTeam: homeName,
          awayTeam: awayName,
          kickoff,
        },
        {
          generatedAt: generatedAtIso,
          cutoffAt: generatedAtIso,
        }
      );
      const oddsAtPrediction = oddsCapture?.oddsAtPrediction || null;
      const score =
        event.homeScore?.current != null && event.awayScore?.current != null
          ? `${event.homeScore.current}-${event.awayScore.current}`
          : null;
      const homeScore = event.homeScore?.current != null ? Number(event.homeScore.current) : null;
      const awayScore = event.awayScore?.current != null ? Number(event.awayScore.current) : null;
      const appStatus = inferPostKickoffStatus(event, resolveAppStatus(event), score, now);
      const isFinishedMatch = String(appStatus || "").toUpperCase() === "FT";
      let postMatchStats = null;
      if (isFinishedMatch) {
        postMatchStats = await buildPostMatchStatsWithFallback({
          match: { date, homeTeamName: homeName, awayTeamName: awayName },
          eventDetails,
          homeId,
          awayId,
        });
      }
      const match = {
        id: matchId,
        sofaId: event.id,
        dataSource: String(event.source || "sofascore"),
        date,
        kickoff,
        league: leagueInfo.label,
        homeTeamId: homeId,
        awayTeamId: awayId,
        teamIdentity,
        homeTeamName: homeName,
        awayTeamName: awayName,
        homeLogo: resolveTeamLogoUrl(event.homeTeam, homeId, homeName, event.source),
        awayLogo: resolveTeamLogoUrl(event.awayTeam, awayId, awayName, event.source),
        status: appStatus,
        score,
        homeScore,
        awayScore,
        minute: minuteState.minute,
        minuteValue: minuteState.minuteValue,
        extraTime: minuteState.extraTime,
        period: minuteState.period,
        liveUpdatedAt: appStatus === "LIVE" || appStatus === "HT" ? now : null,
        homeForm: homeRecent?.form || "",
        awayForm: awayRecent?.form || "",
        homeRecent,
        awayRecent,
        homeSeasonStats,
        awaySeasonStats,
        homeInjuries: store.teamInjuries[homeId] || null,
        awayInjuries: store.teamInjuries[awayId] || null,
        homeRestDays,
        awayRestDays,
        weather,
        lineupSummary,
        lineupStatus,
        homeTeamProfile,
        awayTeamProfile,
        h2h,
        dbFeatureContext,
        h2hStatus: h2h?.status || "empty",
        formDataQuality: {
          homeGames: Number(homeRecent?.gamesPlayed || 0),
          awayGames: Number(awayRecent?.gamesPlayed || 0),
          homeSource: homeRecent?.source || null,
          awaySource: awayRecent?.source || null,
          h2hSource: h2h?.source || null,
          warnings: formQualityWarnings,
        },
        sourceAsOf,
        oddsAtPrediction,
        oddsProviderStatus: oddsCapture?.status || "not_configured",
        oddsProviderDiagnostics: oddsCapture,
        marketCalibration: prediction.modelEdges?.marketCalibration || null,
        learningSummary: prediction.modelEdges?.learningEdge || null,
        competitionReliability: prediction.modelEdges?.leagueReliability || null,
        phaseReliability: prediction.modelEdges?.phaseReliability || null,
        refereeProfile: prediction.modelEdges?.refereeProfile || refereeProfile || null,
        refereeStatus,
        aggregate,
        homeClubElo,
        awayClubElo,
        homePos,
        awayPos,
        matchImportance,
        roundLabel,
        context,
        modelEdges: prediction.modelEdges,
        dataCompleteness: prediction.dataCompleteness,
        dataCompletenessScore: prediction.dataCompletenessScore,
        qualityGate: prediction.qualityGate,
        monteCarlo: prediction.monteCarlo,
        ensembleMeta: prediction.ensembleMeta,
        postMatchStats: isFinishedMatch ? (postMatchStats || normalizePostMatchStats({}, "missing", "finished-without-stats")) : null,
      };

      dayMatches.push(match);
      if (isFinishedMatch) updateTeamPostMatchStats(store, match);
      const predictionRecord = {
        matchId,
        date,
        dataSource: String(event.source || "sofascore"),
        homeTeam: homeName,
        awayTeam: awayName,
        league: leagueInfo.label,
        teamIdentity,
        homeForm: homeRecent?.form || "",
        awayForm: awayRecent?.form || "",
        homeRestDays,
        awayRestDays,
        weather,
        lineupSummary,
        lineupStatus,
        homeTeamProfile,
        awayTeamProfile,
        h2h,
        h2hStatus: h2h?.status || "empty",
        formDataQuality: {
          homeGames: Number(homeRecent?.gamesPlayed || 0),
          awayGames: Number(awayRecent?.gamesPlayed || 0),
          homeSource: homeRecent?.source || null,
          awaySource: awayRecent?.source || null,
          h2hSource: h2h?.source || null,
          warnings: formQualityWarnings,
        },
        sourceAsOf,
        odds: oddsAtPrediction,
        oddsAtPrediction,
        oddsProviderStatus: oddsCapture?.status || "not_configured",
        oddsProviderDiagnostics: oddsCapture,
        marketCalibration: prediction.modelEdges?.marketCalibration || null,
        learningSummary: prediction.modelEdges?.learningEdge || null,
        competitionReliability: prediction.modelEdges?.leagueReliability || null,
        phaseReliability: prediction.modelEdges?.phaseReliability || null,
        refereeProfile: prediction.modelEdges?.refereeProfile || refereeProfile || null,
        refereeStatus,
        aggregate,
        context,
        homeClubElo,
        awayClubElo,
        matchImportance,
        featureVector: prediction.featureVector,
        ensembleMeta: prediction.ensembleMeta,
        monteCarlo: prediction.monteCarlo,
        postMatchStats: isFinishedMatch ? (postMatchStats || normalizePostMatchStats({}, "missing", "finished-without-stats")) : null,
        ...prediction,
      };
      const snapshotMeta = registerPredictionSnapshot(store, match, predictionRecord, now);
      if (snapshotMeta) {
        Object.assign(predictionRecord, snapshotMeta);
        match.predictionId = snapshotMeta.predictionId;
        match.predictionGeneratedAt = snapshotMeta.generatedAt;
        match.predictionCutoffAt = snapshotMeta.cutoffAt;
      }
      dayPredictions.push(predictionRecord);

      if (leagueInfo.type === "cup" || aggregate?.active || context.summary?.includes("play-off")) {
        const knockoutItem = {
          league: leagueInfo.label,
          roundLabel,
          stakes: context.stakes,
          matchId,
          kickoff,
          homeTeamName: homeName,
          awayTeamName: awayName,
          aggregate,
          score,
          status: appStatus,
        };

        store.knockoutOverview[date].push(knockoutItem);

        if (!store.cupSheets[leagueInfo.label]) {
          store.cupSheets[leagueInfo.label] = {
            league: leagueInfo.label,
            rounds: {},
          };
        }
        const roundKey = String(roundLabel || "Knock-out");
        if (!store.cupSheets[leagueInfo.label].rounds[roundKey]) {
          store.cupSheets[leagueInfo.label].rounds[roundKey] = [];
        }
        store.cupSheets[leagueInfo.label].rounds[roundKey].push(knockoutItem);
      }

      await sleep(40);
    }

    const uniqueDayMatches = dedupeStoredMatches(dayMatches);
    const uniqueDayPredictions = dedupeStoredPredictions(dayPredictions, uniqueDayMatches);
    assignTopConfidenceRanks(uniqueDayMatches, uniqueDayPredictions);
    store.matches[date] = uniqueDayMatches;
    store.predictions[date] = uniqueDayPredictions;
  }

  const liveJson = await safeFetch(`${SOFA}/sport/football/events/live`);
  for (const live of liveJson?.events || []) {
    const matchId = `ss-${live.id}`;
    const match = (store.matches[today] || []).find((item) => item.id === matchId);
    if (!match) continue;

    let liveDetails = null;
    if (!live.time?.current) {
      liveDetails = store.eventCache?.[live.id] || null;
      if (!liveDetails || now - Number(store.eventCacheUpdated?.[live.id] || 0) > EVENT_TTL) {
        liveDetails = await fetchEventDetails(live.id);
        if (liveDetails) {
          store.eventCache[live.id] = liveDetails;
          store.eventCacheUpdated[live.id] = now;
        }
      }
    }

    const minuteState = resolveMinuteState(live, liveDetails);
    const liveStatus = resolveAppStatus(live);

    match.status = liveStatus === "NS" ? "LIVE" : liveStatus;
    match.score =
      live.homeScore?.current != null && live.awayScore?.current != null
        ? `${live.homeScore.current}-${live.awayScore.current}`
        : match.score;
    match.minute = minuteState.minute || match.minute;
    match.minuteValue = minuteState.minuteValue || match.minuteValue || null;
    match.extraTime = minuteState.extraTime || null;
    match.period = minuteState.period || match.period || null;
    match.liveUpdatedAt = match.status === "LIVE" || match.status === "HT" ? Date.now() : match.liveUpdatedAt;
    match.liveStats = await fetchLiveStats(live.id);

    if (match.aggregate?.active) {
      const [homeGoals, awayGoals] = String(match.score || "0-0").split("-").map(Number);
      if (!Number.isNaN(homeGoals) && !Number.isNaN(awayGoals)) {
        match.aggregate.homeAggregate =
          Number(match.aggregate.homeAggregate || 0) - Number(match.aggregate.currentHomeGoals || 0) + homeGoals;
        match.aggregate.awayAggregate =
          Number(match.aggregate.awayAggregate || 0) - Number(match.aggregate.currentAwayGoals || 0) + awayGoals;
        match.aggregate.currentHomeGoals = homeGoals;
        match.aggregate.currentAwayGoals = awayGoals;
        match.aggregate.aggregateScore = `${match.aggregate.homeAggregate}-${match.aggregate.awayAggregate}`;
        match.aggregate.leader =
          match.aggregate.homeAggregate === match.aggregate.awayAggregate
            ? null
            : match.aggregate.homeAggregate > match.aggregate.awayAggregate
              ? match.homeTeamName
              : match.awayTeamName;
      }
    }

    await sleep(30);
  }

  applyLiveStandingsOverlay(store);
  await refreshWorldCupNationalRatings(store, now);
  store.worldCup2026Projection = buildWorldCup2026ProjectionFromStore(store);
  store.worldCup2026Readiness = buildWorldCup2026ReadinessFromStore(store);
  compactStore(store, today, now);
  rebuildReviewsAndLearning(store);
  store.backtestSegmentation = buildBacktestSegmentation(store);
  rebuildLeagueCalibrationProfilesFromReviews(store);
  const selfHealing = await runSelfHealingRetries(store, today, now);
  store.cupSheets = mergeCupSheets(store.cupSheets, buildCupSheetsFromMatches(store));
  store.sourceCoverage = buildSourceCoverage(store, today);
  store.dataCompletenessAudit = buildDataCompletenessAudit(store, today);
  store.oddsIntegrationReadiness = buildOddsIntegrationReadiness(store, today);
  store.dataScout = {
    ...buildDataScoutReport(store, today),
    selfHealing,
    backtestSegmentation: store.backtestSegmentation || null,
    fixtureSourceDiagnostics,
  };
  store.anomalyReport = buildDataAnomalyReport(store, today);
  store.aiAdvice = buildAiRecommendations(store, today);
  store.competitionArchiveIndex = buildCompetitionArchiveIndex(store, today);
  store.teamSquadSummary = buildTeamSquadSummary(store);
  store.lastRun = Date.now();
  store.workerVersion = MODEL_VERSION;
  
  // Log summary
  const totalMatches = Object.values(store.matches || {}).flat().length;
  console.log(`[worker] Totaal ${totalMatches} wedstrijden opgeslagen`);
  console.log(`[worker] Vandaag: ${(store.matches?.[today] || []).length} wedstrijden`);
  console.log(`[worker] Morgen: ${(store.matches?.[tomorrow] || []).length} wedstrijden`);
  
  fs.mkdirSync(path.dirname(TRAINING_SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(TRAINING_SNAPSHOT_FILE, JSON.stringify(buildTrainingSnapshot(store)));
  writeSplitDataFiles(store, {
    splitDataDir: SPLIT_DATA_DIR,
    writeCompetitionArchiveFiles,
  });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store));
  try {
    const dbSync = await syncStoreToDatabase(store, { dateKeys: dates });
    store.databaseSync = { ...dbSync, syncedAt: new Date().toISOString() };
    if (dbSync.skipped) {
      console.warn(`[worker] database sync overgeslagen: ${dbSync.reason}`);
    } else {
      console.log(
        `[worker] database sync: ${dbSync.matches} matches, ${dbSync.predictionSnapshots} prediction snapshots`
      );
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(store));
  } catch (error) {
    store.databaseSync = {
      syncedAt: new Date().toISOString(),
      skipped: false,
      error: error?.message || String(error),
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(store));
    console.warn(`[worker] database sync mislukt: ${store.databaseSync.error}`);
  }
  console.log("[worker] klaar");
}

main();
