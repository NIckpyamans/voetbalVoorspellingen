import { fetchServerStore } from "./_dataSource.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";
import { databaseConfigured, readDatabaseHistoryItems } from "../shared/database.js";

const logger = createLogger("api.history");

function mapServerReview(review: any) {
  return {
    matchId: review.matchId,
    predictionId: review.predictionId || null,
    prediction: review.predictedScore,
    actual: review.actualScore,
    wasCorrect: !!review.exactHit,
    errorMargin: Number(review.totalGoalError || 0),
    timestamp: Number(review.createdAt || Date.now()),
    homeTeam: review.homeTeamName || null,
    awayTeam: review.awayTeamName || null,
    league: review.league || null,
    winnerCorrect: review.predictedOutcome === review.actualOutcome,
    predictedOutcome:
      review.predictedOutcome === "H"
        ? "Thuis"
        : review.predictedOutcome === "A"
          ? "Uit"
          : review.predictedOutcome === "D"
            ? "Gelijk"
            : review.predictedOutcome || null,
    actualOutcome:
      review.actualOutcome === "H"
        ? "Thuis"
        : review.actualOutcome === "A"
          ? "Uit"
          : review.actualOutcome === "D"
            ? "Gelijk"
            : review.actualOutcome || null,
    topChanceCorrect: !!review.probabilityOutcomeHit,
    phaseBucket: review.phaseBucket || null,
    confidence: Number(review.confidence || 0),
    confidenceRaw: review.confidenceRaw ?? null,
    calibration: review.calibration || null,
    exactScoreConfidence: Number(review.exactScoreConfidence || 0),
    brierScore: review.brierScore ?? null,
    logLoss: review.logLoss ?? null,
    roi: review.roi ?? null,
    roiStatus: review.roiStatus || null,
    clv: review.clv ?? null,
    clvStatus: review.clvStatus || null,
    generatedAt: review.generatedAt || null,
    cutoffAt: review.cutoffAt || null,
    modelVersion: review.modelVersion || null,
    featureSchemaVersion: review.featureSchemaVersion || null,
    inputSnapshotHash: review.inputSnapshotHash || null,
    evaluationSource: review.evaluationSource || null,
    leakageRisk: review.leakageRisk || null,
    leakageGuard: review.leakageGuard || null,
    oddsAtPrediction: review.oddsAtPrediction || null,
    oddsStatus: review.oddsStatus || null,
    oddsProviderStatus: review.oddsProviderStatus || null,
    oddsMissingReason: review.oddsMissingReason || null,
    featureSourceMetadata: review.featureSourceMetadata || null,
    featureImportance: Array.isArray(review.featureImportance) ? review.featureImportance : [],
    sourceReliability: review.sourceReliability || null,
    qualityGate: review.qualityGate || null,
    leagueCalibration: review.leagueCalibration || null,
    sourceTimestampCoverage: review.sourceTimestampCoverage ?? review.leakageGuard?.sourceTimestampCoverage ?? null,
    bestBetRank: Number(review.bestBetRank || 0) || null,
    topConfidencePick: !!review.topConfidencePick,
    topExactScorePick: !!review.topExactScorePick,
    topExactReasons: Array.isArray(review.topExactReasons) ? review.topExactReasons : [],
    predictedBtts: review.predictedBtts ?? null,
    actualBtts: review.actualBtts ?? null,
    bttsHit: review.bttsHit ?? null,
    predictedOver25: review.predictedOver25 ?? null,
    actualOver25: review.actualOver25 ?? null,
    over25Hit: review.over25Hit ?? null,
    modelName: review.modelName || null,
    modelAgreement: Number(review.modelAgreement || 0),
    riskProfile: review.riskProfile || null,
  };
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  setCorsHeaders(req, res);
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");

  try {
    if (databaseConfigured()) {
      const databaseItems = await readDatabaseHistoryItems({ limit: 1500 }).catch(() => null);
      if (databaseItems?.length) {
        const items = databaseItems.map((review: any) => mapServerReview(review));
        const featureImportanceSummary = buildFeatureImportanceSummary(items);
        return res.status(200).json({
          ok: true,
          items,
          featureImportanceSummary,
          total: items.length,
          sourceBranch: "postgres",
          workerVersion: "database",
          durationMs: Date.now() - started,
        });
      }
    }

    const { store, branch } = await fetchServerStore();
    const items = Object.values(store.postMatchReviews || {})
      .map((review: any) => mapServerReview(review))
      .sort((a: any, b: any) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    const featureImportanceSummary = buildFeatureImportanceSummary(items);

    return res.status(200).json({
      ok: true,
      items,
      featureImportanceSummary,
      total: items.length,
      sourceBranch: branch,
      workerVersion: store.workerVersion || "unknown",
      durationMs: Date.now() - started,
    });
  } catch (err: any) {
    logger.error("history_failed", { durationMs: Date.now() - started, error: getErrorDetails(err) });
    return res.status(503).json({
      ok: false,
      items: [],
      total: 0,
      error: err?.message || "Unknown error",
      durationMs: Date.now() - started,
    });
  }
}

function buildFeatureImportanceSummary(items: any[]) {
  const featureImportanceTrend = items.reduce((acc: Record<string, any>, item: any) => {
    for (const driver of item.featureImportance || []) {
      const key = driver.key || driver.label || "unknown";
      if (!acc[key]) acc[key] = { key, label: driver.label || key, count: 0, totalScore: 0 };
      acc[key].count += 1;
      acc[key].totalScore += Number(driver.score || 0);
    }
    return acc;
  }, {});
  return Object.values(featureImportanceTrend)
    .map((row: any) => ({
      key: row.key,
      label: row.label,
      count: row.count,
      avgScore: Number((Number(row.totalScore || 0) / Math.max(Number(row.count || 0), 1)).toFixed(3)),
    }))
    .sort((a: any, b: any) => b.avgScore - a.avgScore)
    .slice(0, 12);
}
