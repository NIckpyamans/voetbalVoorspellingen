import fs from "fs";
import path from "path";

export function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data));
}

const DAY_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;

function dateKeyToUtcMs(dateKey) {
  const ms = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function retainedStaticDateKeys(dateKeys, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const pastDays = Math.max(1, Number(options.pastDays ?? process.env.STATIC_EXPORT_PAST_DAYS ?? 45));
  const futureDays = Math.max(1, Number(options.futureDays ?? process.env.STATIC_EXPORT_FUTURE_DAYS ?? 120));
  const startMs = nowMs - pastDays * 86_400_000;
  const endMs = nowMs + futureDays * 86_400_000;
  return (dateKeys || []).filter((dateKey) => {
    const dateMs = dateKeyToUtcMs(dateKey);
    return dateMs !== null && dateMs >= startMs && dateMs <= endMs;
  });
}

export function pruneStaticDayFiles(daysDir, retainedDateKeys) {
  const retained = new Set(retainedDateKeys || []);
  let removed = 0;
  if (!fs.existsSync(daysDir)) return removed;
  for (const fileName of fs.readdirSync(daysDir)) {
    if (!DAY_FILE_PATTERN.test(fileName) || retained.has(fileName.slice(0, -5))) continue;
    fs.unlinkSync(path.join(daysDir, fileName));
    removed += 1;
  }
  return removed;
}

function pickReviewsForMatches(store, matches) {
  const reviews = {};
  for (const match of matches || []) {
    if (store.postMatchReviews?.[match.id]) {
      reviews[match.id] = store.postMatchReviews[match.id];
    }
  }
  return reviews;
}

export function selectStaticSnapshotIds(ids, snapshots, maxPerMatch = 2) {
  const available = [...new Set(ids || [])]
    .filter((predictionId) => snapshots?.[predictionId])
    .sort((left, right) =>
      Date.parse(snapshots[left]?.generatedAt || "") - Date.parse(snapshots[right]?.generatedAt || "")
    );
  const limit = Math.max(1, Number(maxPerMatch || 2));
  if (available.length <= limit) return available;
  if (limit === 1) return [available.at(-1)];
  const selected = [];
  for (let index = 0; index < limit; index += 1) {
    selected.push(available[Math.round(index * (available.length - 1) / (limit - 1))]);
  }
  return [...new Set(selected)];
}

export function compactStaticPredictionSnapshot(snapshot = {}) {
  return pickDefined(snapshot, [
    "predictionId", "matchId", "generatedAt", "cutoffAt", "kickoff", "status", "snapshotStatus",
    "schemaVersion", "featureSchemaVersion", "modelVersion", "algorithmVersion", "workerVersion",
    "date", "league", "season", "homeTeam", "awayTeam", "homeTeamId", "awayTeamId",
    "inputSnapshotHash", "probabilities", "confidence", "confidenceRaw", "expectedScore",
    "oddsAtPrediction", "oddsStatus", "oddsMissingReason", "roiStatus", "clvStatus",
    "leakageGuard", "dataCompleteness", "missingData",
  ]);
}

function pickPredictionSnapshotsForMatches(store, matches) {
  const snapshots = {};
  const maxPerMatch = Math.max(1, Number(process.env.STATIC_SNAPSHOTS_PER_MATCH || 2));
  for (const match of matches || []) {
    const ids = store.predictionSnapshotIndex?.[match.id] || [];
    for (const predictionId of selectStaticSnapshotIds(ids, store.predictionSnapshots, maxPerMatch)) {
      if (store.predictionSnapshots?.[predictionId]) {
        snapshots[predictionId] = compactStaticPredictionSnapshot(store.predictionSnapshots[predictionId]);
      }
    }
  }
  return snapshots;
}

function pickDefined(source, fields) {
  const output = {};
  for (const field of fields) if (source?.[field] !== undefined) output[field] = source[field];
  return output;
}

const HISTORY_REVIEW_FIELDS = [
  "matchId", "predictionId", "date", "league", "homeTeamName", "awayTeamName", "predictedScore", "actualScore",
  "predictedOutcome", "probabilityOutcome", "actualOutcome", "confidence", "exactScoreConfidence", "brierScore",
  "logLoss", "roi", "roiStatus", "clv", "clvStatus", "oddsStatus", "modelVersion", "featureSchemaVersion",
  "generatedAt", "cutoffAt", "evaluationSource", "leakageRisk", "sourceTimestampCoverage", "outcomeHit",
  "probabilityOutcomeHit", "exactHit", "totalGoalError", "totalGoalBias", "homeGoalBias", "awayGoalBias",
  "bestBetRank", "topConfidencePick", "topExactScorePick", "modelName", "modelAgreement", "riskProfile", "createdAt",
];

export function compactHistorySummary(history = {}) {
  const predictionSnapshots = {};
  for (const [predictionId, snapshot] of Object.entries(history.predictionSnapshots || {})) {
    predictionSnapshots[predictionId] = {
      predictionId,
      ...pickDefined(snapshot, [
        "matchId", "date", "league", "homeTeam", "awayTeam", "generatedAt", "cutoffAt", "kickoff", "expectedScore",
        "confidence", "confidenceRaw", "exactScoreConfidence", "probabilities", "modelVersion", "featureSchemaVersion",
        "inputSnapshotHash", "snapshotStatus", "oddsStatus", "lineupsConfirmed",
      ]),
    };
  }
  const postMatchReviews = {};
  for (const [matchId, review] of Object.entries(history.postMatchReviews || {})) {
    postMatchReviews[matchId] = pickDefined(review, HISTORY_REVIEW_FIELDS);
  }
  return {
    ...history,
    postMatchReviews,
    predictionSnapshots,
  };
}

export function buildSplitMeta(store) {
  return {
    lastRun: store.lastRun || null,
    workerVersion: store.workerVersion || "unknown",
    dates: Object.keys(store.matches || {}).sort(),
    reviewCount: Object.keys(store.postMatchReviews || {}).length,
    teamPostMatchStatsCount: Object.keys(store.teamPostMatchStats || {}).length,
    teamLearningCount: Object.keys(store.teamLearning || {}).length,
    aiAdvice: store.aiAdvice || [],
    featureDiagnostics: store.featureDiagnostics || null,
    featurePublicationGate: store.featurePublicationGate || null,
    sourceCoverage: store.sourceCoverage || null,
    fixtureSourceDiagnostics: store.fixtureSourceDiagnostics || {},
    predictionSnapshotCount: Object.keys(store.predictionSnapshots || {}).length,
    predictionSnapshotIndexCount: Object.keys(store.predictionSnapshotIndex || {}).length,
    dataScout: store.dataScout || null,
    dataCompletenessAudit: store.dataCompletenessAudit || null,
    oddsIntegrationReadiness: store.oddsIntegrationReadiness || null,
    modelPerformance: store.modelPerformance || null,
    backtestSummary: store.backtestSummary || null,
    backtestSegmentation: store.backtestSegmentation || null,
    leagueCalibrationProfiles: store.leagueCalibrationProfiles || {},
    leagueCalibrationProfilesByWindow: store.leagueCalibrationProfilesByWindow || {},
    leagueCalibrationRollbackProfiles: store.leagueCalibrationRollbackProfiles || {},
    phaseReliability: store.phaseReliability || {},
    anomalyReport: store.anomalyReport || null,
    topExactScoreMonitor: store.topExactScoreMonitor || null,
    topExactClubs: store.topExactClubs || null,
    competitionArchiveIndex: store.competitionArchiveIndex || null,
    teamSquadSummary: store.teamSquadSummary || null,
  };
}

export function writeSplitDataFiles(store, options = {}) {
  const splitDataDir = options.splitDataDir || path.resolve(process.cwd(), "data");
  const daysDir = path.join(splitDataDir, "days");
  fs.mkdirSync(daysDir, { recursive: true });
  const preserveExistingDayFiles = options.preserveExistingDayFiles === true;
  const existingDateKeys = fs.existsSync(daysDir)
    ? fs.readdirSync(daysDir)
        .filter((fileName) => DAY_FILE_PATTERN.test(fileName))
        .map((fileName) => fileName.slice(0, -5))
    : [];

  const populatedDateKeys = Object.keys(store.matches || {}).filter(
    (dateKey) => (store.matches?.[dateKey] || []).length > 0 || (store.predictions?.[dateKey] || []).length > 0
  );
  const retainedDateKeys = retainedStaticDateKeys(
    preserveExistingDayFiles ? [...new Set([...existingDateKeys, ...populatedDateKeys])] : populatedDateKeys,
    options.retention
  );
  if (!preserveExistingDayFiles) pruneStaticDayFiles(daysDir, retainedDateKeys);

  for (const dateKey of retainedDateKeys) {
    if (preserveExistingDayFiles && !Object.prototype.hasOwnProperty.call(store.matches || {}, dateKey)) continue;
    const matches = store.matches?.[dateKey] || [];
    writeJsonFile(path.join(daysDir, `${dateKey}.json`), {
      date: dateKey,
      matches,
      predictions: store.predictions?.[dateKey] || [],
      predictionSnapshots: pickPredictionSnapshotsForMatches(store, matches),
      reviews: pickReviewsForMatches(store, matches),
      lastRun: store.lastRun || null,
      workerVersion: store.workerVersion || "unknown",
    });
  }

  const meta = buildSplitMeta(store);
  if (preserveExistingDayFiles) meta.dates = retainedDateKeys.sort();
  writeJsonFile(path.join(splitDataDir, "meta.json"), meta);
  writeJsonFile(path.join(splitDataDir, "standings.json"), {
    standings: store.standings || {},
    knockoutOverview: store.knockoutOverview || {},
    cupSheets: store.cupSheets || {},
    lastRun: store.lastRun || null,
    workerVersion: store.workerVersion || "unknown",
    reviewCount: Object.keys(store.postMatchReviews || {}).length,
    teamLearningCount: Object.keys(store.teamLearning || {}).length,
  });
  writeJsonFile(path.join(splitDataDir, "phase-reliability.json"), {
    phaseReliability: store.phaseReliability || {},
    lastRun: store.lastRun || null,
    workerVersion: store.workerVersion || "unknown",
  });
  writeJsonFile(path.join(splitDataDir, "history-summary.json"), compactHistorySummary({
    postMatchReviews: store.postMatchReviews || {},
    predictionSnapshots: store.predictionSnapshots || {},
    predictionSnapshotIndex: store.predictionSnapshotIndex || {},
    teamLearning: store.teamLearning || {},
    teamPostMatchStats: store.teamPostMatchStats || {},
    leagueReliability: store.leagueReliability || {},
    phaseReliability: store.phaseReliability || {},
    modelPerformance: store.modelPerformance || null,
    backtestSummary: store.backtestSummary || null,
    anomalyReport: store.anomalyReport || null,
    topExactScoreMonitor: store.topExactScoreMonitor || null,
    topExactClubs: store.topExactClubs || null,
    competitionArchiveIndex: store.competitionArchiveIndex || null,
    teamSquadSummary: store.teamSquadSummary || null,
    lastRun: store.lastRun || null,
  }));
  writeJsonFile(path.join(splitDataDir, "teams.json"), {
    teamSquads: store.teamSquads || {},
    teamTransfers: store.teamTransfers || {},
    teamSquadSummary: store.teamSquadSummary || null,
    lastRun: store.lastRun || null,
    workerVersion: store.workerVersion || "unknown",
  });

  if (typeof options.writeCompetitionArchiveFiles === "function") {
    options.writeCompetitionArchiveFiles(store);
  }
}
