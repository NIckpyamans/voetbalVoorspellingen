import fs from "fs";
import path from "path";

export function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data));
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

function pickPredictionSnapshotsForMatches(store, matches) {
  const snapshots = {};
  for (const match of matches || []) {
    const ids = store.predictionSnapshotIndex?.[match.id] || [];
    for (const predictionId of ids) {
      if (store.predictionSnapshots?.[predictionId]) {
        snapshots[predictionId] = store.predictionSnapshots[predictionId];
      }
    }
  }
  return snapshots;
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
    sourceCoverage: store.sourceCoverage || null,
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
    anomalyReport: store.anomalyReport || null,
    topExactScoreMonitor: store.topExactScoreMonitor || null,
    topExactClubs: store.topExactClubs || null,
    competitionArchiveIndex: store.competitionArchiveIndex || null,
    teamSquadSummary: store.teamSquadSummary || null,
    worldCup2026Readiness: store.worldCup2026Readiness || null,
    worldCup2026Projection: store.worldCup2026Projection || null,
    worldCup2026Ratings: store.worldCup2026Ratings || null,
  };
}

export function writeSplitDataFiles(store, options = {}) {
  const splitDataDir = options.splitDataDir || path.resolve(process.cwd(), "data");
  const daysDir = path.join(splitDataDir, "days");
  fs.mkdirSync(daysDir, { recursive: true });

  for (const dateKey of Object.keys(store.matches || {})) {
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

  writeJsonFile(path.join(splitDataDir, "meta.json"), buildSplitMeta(store));
  writeJsonFile(path.join(splitDataDir, "standings.json"), {
    standings: store.standings || {},
    knockoutOverview: store.knockoutOverview || {},
    cupSheets: store.cupSheets || {},
    lastRun: store.lastRun || null,
    workerVersion: store.workerVersion || "unknown",
    reviewCount: Object.keys(store.postMatchReviews || {}).length,
    teamLearningCount: Object.keys(store.teamLearning || {}).length,
  });
  writeJsonFile(path.join(splitDataDir, "history-summary.json"), {
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
    worldCup2026Readiness: store.worldCup2026Readiness || null,
    worldCup2026Projection: store.worldCup2026Projection || null,
    worldCup2026Ratings: store.worldCup2026Ratings || null,
    lastRun: store.lastRun || null,
  });
  writeJsonFile(path.join(splitDataDir, "teams.json"), {
    teamSquads: store.teamSquads || {},
    teamTransfers: store.teamTransfers || {},
    teamSquadSummary: store.teamSquadSummary || null,
    worldCup2026Ratings: store.worldCup2026Ratings || null,
    lastRun: store.lastRun || null,
    workerVersion: store.workerVersion || "unknown",
  });

  if (typeof options.writeCompetitionArchiveFiles === "function") {
    options.writeCompetitionArchiveFiles(store);
  }
}
