import { isHiddenInternationalOrWorldCupEntity } from "../../shared/competitionVisibility.js";
import { compactSnapshotLedgerForLocalRecovery } from "../../shared/predictionSnapshotLedger.js";
import { selectPreferredTrainingSnapshot, snapshotTrainingEligibility } from "./snapshot-policy.js";

function outcome(value) {
  const normalized = String(value || "").toUpperCase();
  return ["H", "D", "A"].includes(normalized) ? normalized : null;
}

function evaluationAsReview(snapshot, evaluation) {
  const actualOutcome = outcome(evaluation?.actualOutcome || evaluation?.actual_outcome);
  if (!actualOutcome) return null;
  const home = Number(evaluation?.finalHomeGoals ?? evaluation?.final_home_goals);
  const away = Number(evaluation?.finalAwayGoals ?? evaluation?.final_away_goals);
  return {
    matchId: snapshot.matchId,
    predictionId: snapshot.predictionId,
    date: snapshot.date || String(snapshot.kickoff || "").slice(0, 10) || null,
    league: snapshot.league || null,
    homeTeamName: snapshot.homeTeam || null,
    awayTeamName: snapshot.awayTeam || null,
    actualOutcome,
    actualScore: Number.isFinite(home) && Number.isFinite(away) ? `${home}-${away}` : null,
    brierScore: evaluation?.brierScore ?? null,
    logLoss: evaluation?.logLoss ?? null,
    outcomeHit: evaluation?.outcomeHit ?? null,
    exactHit: evaluation?.exactHit ?? null,
    evaluationSource: evaluation?.evaluationSource || "immutable-ledger-evaluation-recovery",
    generatedAt: snapshot.generatedAt || null,
    cutoffAt: snapshot.cutoffAt || snapshot.generatedAt || null,
  };
}

export function snapshotTrainingRow(snapshot, review, evaluation) {
  const recoveredReview = review || evaluationAsReview(snapshot, evaluation);
  const label = outcome(recoveredReview?.actualOutcome);
  const eligibility = snapshotTrainingEligibility(snapshot);
  if (!snapshot?.predictionId || !snapshot?.matchId || !label || !eligibility.eligible) return null;
  if (isHiddenInternationalOrWorldCupEntity(snapshot) || isHiddenInternationalOrWorldCupEntity(recoveredReview)) return null;
  const featureVector = snapshot.featureVector || snapshot.features || snapshot.inputSnapshot?.featureVector || null;
  if (!featureVector) return null;
  return {
    date: snapshot.date || recoveredReview.date || null,
    matchId: snapshot.matchId,
    league: snapshot.league || recoveredReview.league || null,
    homeTeam: snapshot.homeTeam || recoveredReview.homeTeamName || null,
    awayTeam: snapshot.awayTeam || recoveredReview.awayTeamName || null,
    status: "FT",
    score: recoveredReview.actualScore || null,
    label,
    review: recoveredReview,
    predictionId: snapshot.predictionId,
    generatedAt: snapshot.generatedAt,
    cutoffAt: snapshot.cutoffAt || snapshot.generatedAt,
    kickoff: snapshot.kickoff || null,
    snapshotWindow: eligibility.snapshotWindow,
    probabilities: snapshot.probabilities || snapshot.prediction?.probabilities || null,
    modelVersion: snapshot.modelVersion || snapshot.prediction?.modelVersion || recoveredReview.modelVersion || null,
    featureVector,
    inputSnapshotHash: snapshot.inputSnapshotHash || snapshot.immutableHash || null,
    ensembleMeta: snapshot.ensembleMeta || snapshot.prediction?.ensembleMeta || null,
    dbFeatureContext: compactTrainingDbFeatureContext(snapshot.dbFeatureContext || snapshot.inputSnapshot?.dbFeatureContext),
    snapshotStatus: snapshot.status || null,
    snapshotBacked: true,
    recoverySource: review ? "post_match_review" : "immutable_evaluation",
  };
}

const LOCAL_SNAPSHOT_FIELDS = [
  "predictionId", "matchId", "date", "league", "homeTeam", "awayTeam", "homeTeamId", "awayTeamId",
  "generatedAt", "cutoffAt", "kickoff", "snapshotWindow", "status", "modelVersion", "inputSnapshotHash",
  "immutableHash", "featureVector", "features", "probabilities", "confidence", "expectedScore", "oddsAtPrediction",
  "oddsStatus", "dataCompleteness", "ensembleMeta", "dbFeatureContext",
];
const LOCAL_REVIEW_FIELDS = [
  "matchId", "predictionId", "date", "league", "homeTeamName", "awayTeamName", "actualOutcome", "actualScore",
  "finalHomeGoals", "finalAwayGoals", "modelVersion", "brierScore", "logLoss", "outcomeHit", "exactHit",
  "evaluationSource", "generatedAt", "cutoffAt",
];
const LOCAL_EVALUATION_FIELDS = [
  "actualOutcome", "finalHomeGoals", "finalAwayGoals", "brierScore", "logLoss", "outcomeHit", "exactHit", "evaluationSource",
];
const LOCAL_MATCH_STAT_FIELDS = ["statsSource", "homeXg", "awayXg", "homeShots", "awayShots", "homeCorners", "awayCorners"];
const LOCAL_WEATHER_FIELDS = ["temperature_2m_mean", "temperature", "wind_speed_10m_max", "windSpeed", "precipitation_sum", "precipitation"];
const LOCAL_ODDS_FIELDS = ["samples", "avgHome", "avgDraw", "avgAway"];
const LOCAL_H2H_FIELDS = ["played", "weighted_recent_balance"];

function pickFields(source, fields) {
  const result = {};
  for (const field of fields) if (source?.[field] !== undefined) result[field] = source[field];
  return result;
}

function compactDbFeatureContext(context) {
  if (!context || typeof context !== "object") return null;
  const output = {};
  const matchStats = pickFields(context.matchStats, LOCAL_MATCH_STAT_FIELDS);
  if (Object.keys(matchStats).length) output.matchStats = matchStats;
  const teamMatchStats = Array.isArray(context.teamMatchStats)
    ? context.teamMatchStats.slice(0, 2).map((row) => pickFields(row, ["side", "xg", "shots", "corners"]))
    : [];
  if (teamMatchStats.length) output.teamMatchStats = teamMatchStats;
  const historicalOdds = pickFields(context.historicalOdds, LOCAL_ODDS_FIELDS);
  if (Object.keys(historicalOdds).length) output.historicalOdds = historicalOdds;
  const weather = pickFields(context.weather || context.weatherPayload, LOCAL_WEATHER_FIELDS);
  if (Object.keys(weather).length) output.weather = weather;
  const h2hEdge = pickFields(context.h2hEdge, LOCAL_H2H_FIELDS);
  if (Object.keys(h2hEdge).length) output.h2hEdge = h2hEdge;
  if (Array.isArray(context.teamSeasonStyle)) {
    output.teamSeasonStyle = context.teamSeasonStyle.slice(0, 2).map((row) => ({ style_profile: row?.style_profile ? {} : null }));
  }
  if (Array.isArray(context.featureSources)) output.featureSources = context.featureSources.slice(0, 20).map((source) => String(source).slice(0, 120));
  if (context.aliasMatched !== undefined) output.aliasMatched = context.aliasMatched;
  if (context.weatherAvailable !== undefined) output.weatherAvailable = context.weatherAvailable;
  return output;
}

function compactSnapshot(snapshot) {
  const compact = {
    ...pickFields(snapshot, LOCAL_SNAPSHOT_FIELDS),
    featureVector: snapshot.featureVector || snapshot.features || snapshot.inputSnapshot?.featureVector || null,
    inputSnapshotHash: snapshot.inputSnapshotHash || snapshot.immutableHash || null,
    probabilities: snapshot.probabilities || snapshot.prediction?.probabilities || null,
    modelVersion: snapshot.modelVersion || snapshot.prediction?.modelVersion || null,
    ensembleMeta: snapshot.ensembleMeta || snapshot.prediction?.ensembleMeta || null,
    snapshotWindow: snapshotTrainingEligibility(snapshot).snapshotWindow,
  };
  const dbFeatureContext = compactDbFeatureContext(snapshot.dbFeatureContext || snapshot.inputSnapshot?.dbFeatureContext);
  if (dbFeatureContext && Object.keys(dbFeatureContext).length) compact.dbFeatureContext = dbFeatureContext;
  else delete compact.dbFeatureContext;
  return compact;
}

function compactTrainingDbFeatureContext(context) {
  const compact = compactDbFeatureContext(context);
  return compact && Object.keys(compact).length ? compact : null;
}

export function buildLocalRecoveryLedger(ledger) {
  const compactSource = compactSnapshotLedgerForLocalRecovery(ledger);
  const predictionSnapshots = {};
  const predictionSnapshotIndex = {};
  for (const sourceSnapshot of Object.values(compactSource.predictionSnapshots || {})) {
    if (!sourceSnapshot?.predictionId || !sourceSnapshot?.matchId) continue;
    const snapshot = compactSnapshot(sourceSnapshot);
    predictionSnapshots[snapshot.predictionId] = snapshot;
    (predictionSnapshotIndex[snapshot.matchId] ||= []).push(snapshot.predictionId);
  }

  const selectedIds = new Set(Object.keys(predictionSnapshots));
  const selectedMatches = new Set(Object.values(predictionSnapshots).map((snapshot) => snapshot.matchId));
  const postMatchReviews = {};
  for (const [matchId, review] of Object.entries(compactSource.postMatchReviews || {})) {
    if (!selectedMatches.has(matchId)) continue;
    postMatchReviews[matchId] = pickFields(review, LOCAL_REVIEW_FIELDS);
  }
  const evaluations = {};
  for (const [predictionId, evaluation] of Object.entries(compactSource.evaluations || {})) {
    if (selectedIds.has(predictionId)) evaluations[predictionId] = pickFields(evaluation, LOCAL_EVALUATION_FIELDS);
  }

  return {
    version: compactSource.version || "v1-immutable-r2-ledger",
    generatedAt: compactSource.generatedAt || null,
    predictionSnapshots,
    predictionSnapshotIndex,
    postMatchReviews,
    evaluations,
  };
}

export function serializeBoundedRecoveryLedger(value, { maxBytes = 64 * 1024 * 1024, label = "Local snapshot recovery projection" } = {}) {
  const stack = [{ value, depth: 0, exit: false }];
  const ancestors = new Set();
  let estimatedBytes = 0;
  let visitedNodes = 0;
  const addBytes = (bytes) => {
    estimatedBytes += bytes;
    if (estimatedBytes > maxBytes) throw new Error(`${label} exceeds ${maxBytes} byte limit; R2 remains the canonical archive.`);
  };
  const jsonStringBytes = (text) => {
    let bytes = 2;
    for (const character of String(text)) {
      const code = character.charCodeAt(0);
      bytes += character === "\"" || character === "\\" ? 2 : code < 0x20 ? 6 : Buffer.byteLength(character, "utf8");
    }
    return bytes;
  };
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("MAX_LOCAL_RECOVERY_BYTES must be a positive safe integer.");

  while (stack.length) {
    const frame = stack.pop();
    const item = frame.value;
    if (frame.exit) {
      ancestors.delete(item);
      continue;
    }
    if (item == null || typeof item === "boolean") {
      addBytes(item == null ? 4 : 5);
      continue;
    }
    if (typeof item === "number") {
      addBytes(Number.isFinite(item) ? Buffer.byteLength(String(item), "utf8") : 4);
      continue;
    }
    if (typeof item === "string") {
      addBytes(jsonStringBytes(item));
      continue;
    }
    if (typeof item !== "object") throw new Error(`${label} contains a non-JSON value.`);
    if (ancestors.has(item)) throw new Error(`${label} contains a circular reference.`);
    if (frame.depth > 100) throw new Error(`${label} exceeds the safe JSON nesting depth.`);
    visitedNodes += 1;
    if (visitedNodes > 500_000) throw new Error(`${label} exceeds the safe JSON node limit.`);
    ancestors.add(item);
    stack.push({ value: item, depth: frame.depth, exit: true });
    const entries = Array.isArray(item)
      ? item.map((entry) => [null, entry === undefined || typeof entry === "function" || typeof entry === "symbol" ? null : entry])
      : Object.entries(item).filter(([, child]) => child !== undefined && typeof child !== "function" && typeof child !== "symbol");
    addBytes(2 + Math.max(0, entries.length - 1));
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      if (key !== null) addBytes(jsonStringBytes(key) + 1);
      stack.push({ value: child, depth: frame.depth + 1, exit: false });
    }
  }

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new Error(`Could not safely serialize ${label.toLowerCase()}: ${error?.message || error}`);
  }
  const actualBytes = Buffer.byteLength(serialized, "utf8");
  if (actualBytes > maxBytes) throw new Error(`${label} is ${actualBytes} bytes, above the ${maxBytes} byte limit; R2 remains the canonical archive.`);
  return serialized;
}

export function recoverTrainingRows(ledger) {
  const snapshotsByMatchAndModel = new Map();
  for (const snapshot of Object.values(ledger?.predictionSnapshots || {})) {
    if (!snapshot?.matchId) continue;
    const modelVersion = snapshot.modelVersion || snapshot.prediction?.modelVersion || "unknown";
    const key = `${snapshot.matchId}::${modelVersion}`;
    const candidates = snapshotsByMatchAndModel.get(key) || [];
    candidates.push(snapshot);
    snapshotsByMatchAndModel.set(key, candidates);
  }
  const rowsByPredictionId = new Map();
  for (const candidates of snapshotsByMatchAndModel.values()) {
    const matchId = candidates[0]?.matchId;
    const review = ledger?.postMatchReviews?.[matchId];
    const hasReviewOutcome = Boolean(outcome(review?.actualOutcome));
    const candidatesWithEvidence = hasReviewOutcome
      ? candidates
      : candidates.filter((snapshot) => Boolean(outcome(ledger?.evaluations?.[snapshot.predictionId]?.actualOutcome || ledger?.evaluations?.[snapshot.predictionId]?.actual_outcome)));
    const snapshot = selectPreferredTrainingSnapshot(candidatesWithEvidence);
    if (!snapshot) continue;
    const row = snapshotTrainingRow(
      snapshot,
      review,
      ledger?.evaluations?.[snapshot.predictionId]
    );
    if (row) rowsByPredictionId.set(row.predictionId, row);
  }
  return [...rowsByPredictionId.values()];
}
