import { fetchServerStore } from "./_dataSource.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";

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
    exactScoreConfidence: Number(review.exactScoreConfidence || 0),
    brierScore: review.brierScore ?? null,
    logLoss: review.logLoss ?? null,
    roi: review.roi ?? null,
    clv: review.clv ?? null,
    generatedAt: review.generatedAt || null,
    cutoffAt: review.cutoffAt || null,
    modelVersion: review.modelVersion || null,
    featureSchemaVersion: review.featureSchemaVersion || null,
    inputSnapshotHash: review.inputSnapshotHash || null,
    evaluationSource: review.evaluationSource || null,
    leakageRisk: review.leakageRisk || null,
    oddsAtPrediction: review.oddsAtPrediction || null,
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
    const { store, branch } = await fetchServerStore();
    const items = Object.values(store.postMatchReviews || {})
      .map((review: any) => mapServerReview(review))
      .sort((a: any, b: any) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

    return res.status(200).json({
      ok: true,
      items,
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
