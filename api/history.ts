import { fetchServerStore } from "./_dataSource.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";
import { databaseConfigured, getSql, readDatabaseHistoryItems } from "../shared/database.js";

const logger = createLogger("api.history");

function mapServerReview(review: any) {
  const predictedOutcome =
    review.predictedOutcome === "H"
      ? "Thuis"
      : review.predictedOutcome === "A"
        ? "Uit"
        : review.predictedOutcome === "D"
          ? "Gelijk"
          : review.predictedOutcome || null;
  const actualOutcome =
    review.actualOutcome === "H"
      ? "Thuis"
      : review.actualOutcome === "A"
        ? "Uit"
        : review.actualOutcome === "D"
          ? "Gelijk"
          : review.actualOutcome || null;
  const winnerCorrect =
    typeof review.outcomeHit === "boolean"
      ? review.outcomeHit
      : predictedOutcome && actualOutcome
      ? predictedOutcome === actualOutcome
      : false;
  const predictedGoals = parseGoals(review.predictedScore);
  const actualGoals = parseGoals(review.actualScore);
  const totalGoalError =
    review.totalGoalError != null
      ? Number(review.totalGoalError || 0)
      : predictedGoals && actualGoals
        ? Math.abs(predictedGoals.home - actualGoals.home) + Math.abs(predictedGoals.away - actualGoals.away)
        : 0;
  return {
    matchId: review.matchId,
    predictionId: review.predictionId || null,
    prediction: review.predictedScore,
    actual: review.actualScore,
    wasCorrect: !!review.exactHit,
    errorMargin: totalGoalError,
    timestamp: Number(review.createdAt || Date.now()),
    homeTeam: review.homeTeamName || null,
    awayTeam: review.awayTeamName || null,
    league: review.league || null,
    winnerCorrect,
    predictedOutcome,
    actualOutcome,
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

async function readDatabaseHistoryFallback(limit = 1500) {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql.query(
    `
      select
        pe.prediction_id,
        pe.match_id,
        pe.exact_hit,
        pe.outcome_hit,
        pe.probability_outcome_hit,
        pe.brier_score,
        pe.log_loss,
        pe.roi,
        pe.roi_status,
        pe.clv,
        pe.clv_status,
        pe.evaluation_source,
        pe.evaluated_at,
        ps.generated_at,
        ps.cutoff_at,
        ps.model_version,
        ps.feature_schema_version,
        ps.input_snapshot_hash,
        ps.prediction_payload,
        ps.expected_score,
        ps.confidence,
        ps.confidence_raw,
        ps.data_completeness,
        ps.leakage_guard,
        ps.feature_source_metadata
      from prediction_evaluations pe
      join prediction_snapshots ps on ps.prediction_id = pe.prediction_id
      order by pe.evaluated_at desc
      limit $1
    `,
    [Math.min(Math.max(Number(limit || 1500), 1), 5000)]
  );
  return rows.map((row: any) => {
    const prediction = row.prediction_payload || {};
    const input = prediction.inputSnapshot || {};
    const expected = row.expected_score || prediction.expectedScore || {};
    const predHome = prediction.predHomeGoals ?? expected.home ?? null;
    const predAway = prediction.predAwayGoals ?? expected.away ?? null;
    return {
      matchId: row.match_id,
      predictionId: row.prediction_id,
      predictedScore: predHome != null && predAway != null ? `${predHome}-${predAway}` : expected.label || null,
      actualScore: prediction.review?.actualScore || null,
      exactHit: row.exact_hit,
      outcomeHit: row.outcome_hit,
      probabilityOutcomeHit: row.probability_outcome_hit,
      totalGoalError: prediction.review?.totalGoalError ?? null,
      createdAt: row.evaluated_at ? Date.parse(row.evaluated_at) : Date.now(),
      evaluatedAt: row.evaluated_at,
      homeTeamName: prediction.homeTeam || input.homeTeam || null,
      awayTeamName: prediction.awayTeam || input.awayTeam || null,
      league: prediction.league || input.league || null,
      predictedOutcome: prediction.review?.predictedOutcome || null,
      actualOutcome: prediction.review?.actualOutcome || null,
      confidence: row.confidence,
      confidenceRaw: row.confidence_raw,
      calibration: prediction.calibration || null,
      exactScoreConfidence: prediction.exactScoreConfidence || null,
      brierScore: row.brier_score,
      logLoss: row.log_loss,
      roi: row.roi,
      roiStatus: row.roi_status,
      clv: row.clv,
      clvStatus: row.clv_status,
      generatedAt: row.generated_at,
      cutoffAt: row.cutoff_at,
      modelVersion: row.model_version,
      featureSchemaVersion: row.feature_schema_version,
      inputSnapshotHash: row.input_snapshot_hash,
      evaluationSource: row.evaluation_source,
      leakageGuard: row.leakage_guard,
      oddsAtPrediction: prediction.oddsAtPrediction || prediction.odds || null,
      oddsStatus: prediction.oddsStatus || null,
      oddsProviderStatus: prediction.oddsProviderStatus || null,
      oddsMissingReason: prediction.oddsMissingReason || null,
      featureSourceMetadata: row.feature_source_metadata,
      featureImportance: Array.isArray(prediction.featureImportance) ? prediction.featureImportance : [],
      sourceReliability: prediction.modelEdges?.sourceReliability || prediction.sourceReliability || null,
      qualityGate: prediction.qualityGate || prediction.modelEdges?.qualityGate || row.data_completeness || null,
      leagueCalibration: prediction.modelEdges?.leagueCalibration || prediction.leagueCalibration || null,
      sourceTimestampCoverage: row.leakage_guard?.sourceTimestampCoverage ?? null,
      bestBetRank: prediction.bestBetRank || null,
      topConfidencePick: prediction.topConfidencePick || false,
      topExactScorePick: prediction.topExactScorePick || false,
      topExactReasons: prediction.topExactReasons || prediction.exactScoreReasons || [],
      modelName: prediction.modelName || prediction.modelEdges?.modelName || null,
      modelAgreement: prediction.modelEdges?.modelAgreement || 0,
      riskProfile: prediction.modelEdges?.riskProfile || null,
    };
  });
}

function pct(value: number, total: number) {
  return total ? Number(((value / total) * 100).toFixed(1)) : 0;
}

function parseGoals(score: any) {
  const [home, away] = String(score || "").split(/[-:]/).map(Number);
  return Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null;
}

function outcomeFromScore(score: any) {
  const goals = parseGoals(score);
  if (!goals) return null;
  if (goals.home > goals.away) return "Thuis";
  if (goals.away > goals.home) return "Uit";
  return "Gelijk";
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
  const predictedOutcome = item.predictedOutcome || outcomeFromScore(item.prediction);
  const actualOutcome = item.actualOutcome || outcomeFromScore(item.actual);
  if (item.wasCorrect) row.exact += 1;
  if (item.winnerCorrect) row.outcome += 1;
  row.goalError += Number(item.errorMargin || 0);
  if (predictedOutcome === "Thuis" || predictedOutcome === "H") row.predictedHomeWins += 1;
  if (actualOutcome === "Thuis" || actualOutcome === "H") row.actualHomeWins += 1;
  if (predictedOutcome === "Gelijk" || predictedOutcome === "D") row.predictedDraws += 1;
  if (actualOutcome === "Gelijk" || actualOutcome === "D") row.actualDraws += 1;
  if (predictedOutcome === "Uit" || predictedOutcome === "A") row.predictedAwayWins += 1;
  if (actualOutcome === "Uit" || actualOutcome === "A") row.actualAwayWins += 1;
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
  const leagueBuckets: Record<string, any> = {};
  const modelBuckets: Record<string, any> = {};
  const teamBuckets: Record<string, any> = {};
  const dataQualityBuckets: Record<string, any> = {};
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

    updateBucket(leagueBuckets, item.league || "Onbekend", item);
    updateBucket(modelBuckets, item.modelVersion || item.modelName || "onbekend model", item);
    const sourceScore = Number(item.sourceReliability?.score ?? item.qualityGate?.dataCompleteness?.score ?? item.qualityGate?.score ?? -1);
    const qualityKey = sourceScore < 0 ? "onbekend" : sourceScore >= 0.62 ? "hoog" : sourceScore >= 0.45 ? "middel" : "laag";
    updateBucket(dataQualityBuckets, qualityKey, item);
    for (const team of [item.homeTeam, item.awayTeam]) {
      if (team) updateBucket(teamBuckets, team, item);
    }
  }

  const top = (map: Record<string, any>, minTotal = 1, limit = 10) =>
    Object.values(map)
      .map(finalizeBucket)
      .filter((row: any) => row.total >= minTotal)
      .sort((a: any, b: any) => b.outcomePct - a.outcomePct || b.exactPct - a.exactPct || b.total - a.total)
      .slice(0, limit);

  const total = items.length;
  const byLeague = top(leagueBuckets, 1, 12);
  const byModel = top(modelBuckets, 1, 8);
  const byTeam = top(teamBuckets, 2, 12);
  const byDataQuality = top(dataQualityBuckets, 1, 6);
  const oddsCoveragePct = pct(withOdds, total);
  const recommendations = [
    oddsCoveragePct < 25
      ? `Oddsdekking is ${oddsCoveragePct}%; draai prematch odds-collector vaker en prioriteer wedstrijden zonder odds_snapshot.`
      : null,
    byLeague[0]?.total >= 30 && byLeague[0]?.outcomePct < 52
      ? `${byLeague[0].key}: 1X2 ${byLeague[0].outcomePct}%; verlaag confidence of verschuif league calibration.`
      : null,
    byDataQuality.find((row: any) => row.key === "laag" && row.total >= 30 && row.outcomePct < 50)
      ? "Lage datakwaliteit presteert zwak; cap confidence agressiever bij missende bronnen."
      : null,
    byModel[0]?.total >= 50 && byModel[0]?.exactPct < 8
      ? `${byModel[0].key}: exact-score hitrate ${byModel[0].exactPct}%; scorematrix/calibratie hertrainen met recentere reviews.`
      : null,
  ].filter(Boolean);
  return {
    total,
    exact,
    outcome,
    exactPct: pct(exact, total),
    outcomePct: pct(outcome, total),
    oddsCoveragePct,
    snapshotCoveragePct: pct(withSnapshot, total),
    avgBrier: brierCount ? Number((brierSum / brierCount).toFixed(3)) : null,
    avgLogLoss: logLossCount ? Number((logLossSum / logLossCount).toFixed(3)) : null,
    byLeague,
    byModel,
    byTeam,
    byDataQuality,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}

async function buildOddsDiagnostics(store: any) {
  if (databaseConfigured()) {
    const sql = getSql();
    if (sql) {
      try {
        const [summary] = await sql.query(`
          select
            (select count(*)::int from prediction_snapshots) as prediction_snapshots,
            (select count(*)::int from odds_snapshots where status not in ('missing','historical_market_profile_only')) as prediction_odds,
            (select count(*)::int from historical_odds_snapshots where available_before_kickoff = true) as prematch_odds,
            (select count(*)::int from historical_odds_snapshots where closing_captured_at is not null) as closing_odds
        `);
        const total = Number(summary?.prediction_snapshots || 0);
        const withOdds = Number(summary?.prediction_odds || 0);
        return {
          predictionSnapshots: total,
          predictionOdds: withOdds,
          missingPredictionOdds: Math.max(0, total - withOdds),
          predictionOddsCoveragePct: total ? Number(((withOdds / total) * 100).toFixed(1)) : 0,
          prematchOdds: Number(summary?.prematch_odds || 0),
          closingOdds: Number(summary?.closing_odds || 0),
          nextAction: "Run `npm run db:odds:prematch:collect` met provider keys; prioriteer snapshots zonder odds.",
        };
      } catch {
        // Fall through to JSON snapshot estimate.
      }
    }
  }

  const snapshots = Object.values(store?.predictionSnapshots || {}) as any[];
  const withOdds = snapshots.filter((snapshot) => snapshot?.oddsAtPrediction || snapshot?.oddsStatus === "available" || snapshot?.oddsStatus === "partial").length;
  return {
    predictionSnapshots: snapshots.length,
    predictionOdds: withOdds,
    missingPredictionOdds: Math.max(0, snapshots.length - withOdds),
    predictionOddsCoveragePct: snapshots.length ? Number(((withOdds / snapshots.length) * 100).toFixed(1)) : 0,
    prematchOdds: null,
    closingOdds: null,
    nextAction: "Run `npm run db:odds:prematch:collect`; JSON fallback heeft geen odds table.",
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
    const requestedLimit = Math.min(Math.max(Number(req.query?.limit || 750), 1), 1500);
    const offset = Math.max(Number(req.query?.offset || 0), 0);
    const databaseDiagnostics: any = {
      configured: databaseConfigured(),
      primaryCount: 0,
      fallbackCount: 0,
      primaryError: null,
      fallbackError: null,
    };
    let databaseRawItems: any[] = [];
    if (databaseDiagnostics.configured) {
      try {
        databaseRawItems = (await readDatabaseHistoryItems({ limit: 5000 })) || [];
        databaseDiagnostics.primaryCount = databaseRawItems.length;
      } catch (err: any) {
        databaseDiagnostics.primaryError = err?.message || String(err);
      }
      if (databaseRawItems.length === 0) {
        try {
          databaseRawItems = await readDatabaseHistoryFallback(5000);
          databaseDiagnostics.fallbackCount = databaseRawItems.length;
        } catch (err: any) {
          databaseDiagnostics.fallbackError = err?.message || String(err);
        }
      }
    }
    const databaseItems = databaseRawItems.map((review: any) => mapServerReview(review));
    const items = mergeHistoryItems(databaseItems, serverItems);
    const featureImportanceSummary = buildFeatureImportanceSummary(items);
    const summary = buildHistorySummary(items);
    (summary as any).oddsDiagnostics = await buildOddsDiagnostics(store);
    const summaryOnly = req.query?.summary === "1" || req.query?.summary === "true";
    const includeItems = req.query?.includeItems === "1" || req.query?.includeItems === "true";
    const limit = summaryOnly && !includeItems ? 0 : requestedLimit;
    const pageItems = includeItems || !summaryOnly ? items.slice(offset, offset + requestedLimit) : [];

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
        databaseDiagnostics,
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
      databaseDiagnostics,
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
