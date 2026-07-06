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

function mergeHistoryItems(primary: any[], secondary: any[]) {
  const merged = new Map<string, any>();
  for (const item of [...secondary, ...primary]) {
    const key = String(item?.predictionId || item?.matchId || "");
    if (!key) continue;
    const current = merged.get(key);
    if (!current || Number(item.timestamp || 0) >= Number(current.timestamp || 0)) {
      merged.set(key, item);
    }
  }
  return [...merged.values()].sort((a: any, b: any) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

function pct(value: number, total: number) {
  return total ? Number(((value / total) * 100).toFixed(1)) : 0;
}

function updateBucket(acc: Record<string, any>, key: string, item: any) {
  const bucketKey = String(key || "Onbekend");
  if (!acc[bucketKey]) {
    acc[bucketKey] = {
      key: bucketKey,
      total: 0,
      exact: 0,
      outcome: 0,
      goalError: 0,
      predictedHomeWins: 0,
      actualHomeWins: 0,
      predictedDraws: 0,
      actualDraws: 0,
      predictedAwayWins: 0,
      actualAwayWins: 0,
    };
  }
  const row = acc[bucketKey];
  row.total += 1;
  if (item.wasCorrect) row.exact += 1;
  if (item.winnerCorrect) row.outcome += 1;
  row.goalError += Number(item.errorMargin || 0);
  if (item.predictedOutcome === "Thuis" || item.predictedOutcome === "H") row.predictedHomeWins += 1;
  if (item.actualOutcome === "Thuis" || item.actualOutcome === "H") row.actualHomeWins += 1;
  if (item.predictedOutcome === "Gelijk" || item.predictedOutcome === "D") row.predictedDraws += 1;
  if (item.actualOutcome === "Gelijk" || item.actualOutcome === "D") row.actualDraws += 1;
  if (item.predictedOutcome === "Uit" || item.predictedOutcome === "A") row.predictedAwayWins += 1;
  if (item.actualOutcome === "Uit" || item.actualOutcome === "A") row.actualAwayWins += 1;
}

function finalizeBucket(row: any) {
  const homeBias = row.predictedHomeWins - row.actualHomeWins;
  const drawBias = row.predictedDraws - row.actualDraws;
  const awayBias = row.predictedAwayWins - row.actualAwayWins;
  const largestBias = [
    { label: "thuis", value: homeBias },
    { label: "gelijk", value: drawBias },
    { label: "uit", value: awayBias },
  ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  return {
    ...row,
    exactPct: pct(row.exact, row.total),
    outcomePct: pct(row.outcome, row.total),
    avgGoalError: Number((Number(row.goalError || 0) / Math.max(row.total, 1)).toFixed(2)),
    biasSummary: largestBias?.value
      ? `${largestBias.value > 0 ? "overschat" : "onderschat"} ${largestBias.label} (${largestBias.value > 0 ? "+" : ""}${largestBias.value})`
      : "geen duidelijke bias",
  };
}

function buildHistorySummary(items: any[]) {
  const byLeague: Record<string, any> = {};
  const byModel: Record<string, any> = {};
  const byTeam: Record<string, any> = {};
  const dataQuality: Record<string, any> = {};
  let exact = 0;
  let outcome = 0;
  let withOdds = 0;
  let withSnapshot = 0;
  let brierSum = 0;
  let brierCount = 0;
  let logLossSum = 0;
  let logLossCount = 0;

  for (const item of items) {
    if (item.wasCorrect) exact += 1;
    if (item.winnerCorrect) outcome += 1;
    if (item.oddsStatus === "available" || item.oddsStatus === "partial" || Number.isFinite(Number(item.roi))) withOdds += 1;
    if (item.predictionId && item.evaluationSource === "prediction_snapshot") withSnapshot += 1;
    if (Number.isFinite(Number(item.brierScore))) {
      brierSum += Number(item.brierScore);
      brierCount += 1;
    }
    if (Number.isFinite(Number(item.logLoss))) {
      logLossSum += Number(item.logLoss);
      logLossCount += 1;
    }

    updateBucket(byLeague, item.league || "Onbekend", item);
    updateBucket(byModel, item.modelVersion || item.modelName || "onbekend model", item);
    const sourceScore = Number(item.sourceReliability?.score ?? item.qualityGate?.dataCompleteness?.score ?? -1);
    const qualityKey = sourceScore < 0 ? "onbekend" : sourceScore >= 0.62 ? "hoog" : sourceScore >= 0.45 ? "middel" : "laag";
    updateBucket(dataQuality, qualityKey, item);
    for (const team of [item.homeTeam, item.awayTeam]) {
      if (team) updateBucket(byTeam, team, item);
    }
  }

  const top = (map: Record<string, any>, minTotal = 1, limit = 10) =>
    Object.values(map)
      .map(finalizeBucket)
      .filter((row: any) => row.total >= minTotal)
      .sort((a: any, b: any) => b.outcomePct - a.outcomePct || b.exactPct - a.exactPct || b.total - a.total)
      .slice(0, limit);

  const total = items.length;
  return {
    total,
    exact,
    outcome,
    exactPct: pct(exact, total),
    outcomePct: pct(outcome, total),
    oddsCoveragePct: pct(withOdds, total),
    snapshotCoveragePct: pct(withSnapshot, total),
    avgBrier: brierCount ? Number((brierSum / brierCount).toFixed(3)) : null,
    avgLogLoss: logLossCount ? Number((logLossSum / logLossCount).toFixed(3)) : null,
    byLeague: top(byLeague, 1, 12),
    byModel: top(byModel, 1, 8),
    byTeam: top(byTeam, 2, 12),
    byDataQuality: top(dataQuality, 1, 6),
    generatedAt: new Date().toISOString(),
  };
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  setCorsHeaders(req, res);
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");

  try {
    const { store, branch } = await fetchServerStore();
    const serverItems = Object.values(store.postMatchReviews || {})
      .map((review: any) => mapServerReview(review))
      .sort((a: any, b: any) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    const databaseItems = databaseConfigured()
      ? (await readDatabaseHistoryItems({ limit: 1500 }).catch(() => null))?.map((review: any) => mapServerReview(review)) || []
      : [];
    const items = mergeHistoryItems(databaseItems, serverItems);
    const featureImportanceSummary = buildFeatureImportanceSummary(items);
    const summary = buildHistorySummary(items);
    const summaryOnly = req.query?.summary === "1" || req.query?.summary === "true";
    const includeItems = req.query?.includeItems === "1" || req.query?.includeItems === "true";
    const limit = Math.min(Math.max(Number(req.query?.limit || items.length), 1), 1500);
    const offset = Math.max(Number(req.query?.offset || 0), 0);
    const pageItems = items.slice(offset, offset + limit);

    if (summaryOnly && !includeItems) {
      return res.status(200).json({
        ok: true,
        summary,
        featureImportanceSummary,
        total: items.length,
        sourceBranch: databaseItems.length ? `postgres+${branch}` : branch,
        workerVersion: store.workerVersion || "unknown",
        serverReviewCount: serverItems.length,
        databaseReviewCount: databaseItems.length,
        durationMs: Date.now() - started,
      });
    }

    return res.status(200).json({
      ok: true,
      items: pageItems,
      summary,
      featureImportanceSummary,
      total: items.length,
      limit,
      offset,
      sourceBranch: databaseItems.length ? `postgres+${branch}` : branch,
      workerVersion: store.workerVersion || "unknown",
      serverReviewCount: serverItems.length,
      databaseReviewCount: databaseItems.length,
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
