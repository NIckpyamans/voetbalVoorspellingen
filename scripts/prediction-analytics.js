const CONFIDENCE_BUCKETS = [
  { key: "0-45", label: "laag <45%", min: 0, max: 0.45 },
  { key: "45-55", label: "45-55%", min: 0.45, max: 0.55 },
  { key: "55-65", label: "55-65%", min: 0.55, max: 0.65 },
  { key: "65-75", label: "65-75%", min: 0.65, max: 0.75 },
  { key: "75-100", label: "hoog 75%+", min: 0.75, max: 1.01 },
];

function numeric(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values, digits = 3) {
  const valid = values.map(numeric).filter((value) => value != null);
  if (!valid.length) return null;
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(digits));
}

function percentile(values, target, digits = 2) {
  const valid = values.map(numeric).filter((value) => value != null).sort((a, b) => a - b);
  if (!valid.length) return null;
  const index = Math.min(valid.length - 1, Math.max(0, Math.ceil(valid.length * target) - 1));
  return Number(valid[index].toFixed(digits));
}

export function hitRate(hits, total) {
  return Number((Number(hits || 0) / Math.max(Number(total || 0), 1)).toFixed(3));
}

export function groupReviewsBy(items, getKey) {
  const groups = {};
  for (const item of items || []) {
    const key = String(getKey(item) || "unknown");
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

function hasUsableOdds(item) {
  const odds = item?.oddsAtPrediction || item?.odds || null;
  if (!odds || typeof odds !== "object") return false;
  return ["home", "draw", "away"].some((field) => {
    const value = Number(odds[field]);
    return Number.isFinite(value) && value > 1.01;
  });
}

function confidenceBucketFor(value) {
  const confidence = Math.max(0, Math.min(1, Number(value || 0)));
  return CONFIDENCE_BUCKETS.find((bucket) => confidence >= bucket.min && confidence < bucket.max) || CONFIDENCE_BUCKETS[0];
}

export function calibrateOutcomeProbabilities(probabilities, modelPerformance, options = {}) {
  const raw = {
    homeProb: Number(probabilities?.homeProb || 0),
    drawProb: Number(probabilities?.drawProb || 0),
    awayProb: Number(probabilities?.awayProb || 0),
  };
  const total = raw.homeProb + raw.drawProb + raw.awayProb;
  if (!Number.isFinite(total) || total <= 0) {
    return {
      probabilities: { homeProb: 0.3333, drawProb: 0.3333, awayProb: 0.3334 },
      applied: false,
      method: "fallback_normalization",
      reason: "Geen geldige 1X2-kansen om te kalibreren.",
    };
  }

  const normalized = {
    homeProb: raw.homeProb / total,
    drawProb: raw.drawProb / total,
    awayProb: raw.awayProb / total,
  };
  const reviewMatches = Number(modelPerformance?.overall?.matches || 0);
  const averageAbsoluteError = numeric(modelPerformance?.calibrationSummary?.averageAbsoluteError);
  if (reviewMatches < Number(options.minReviews || 40) || averageAbsoluteError == null) {
    return {
      probabilities: {
        homeProb: Number(normalized.homeProb.toFixed(4)),
        drawProb: Number(normalized.drawProb.toFixed(4)),
        awayProb: Number(normalized.awayProb.toFixed(4)),
      },
      applied: false,
      method: "insufficient_review_calibration",
      reviewMatches,
      averageAbsoluteError,
      reason: "Nog onvoldoende reviewdata voor probability shrinkage.",
    };
  }

  const topProbability = Math.max(normalized.homeProb, normalized.drawProb, normalized.awayProb);
  const highBucket = (modelPerformance?.calibrationBuckets || []).find((bucket) => bucket.key === "75-100");
  const highBucketError = highBucket?.matches >= 10 ? Number(highBucket.calibrationError || 0) : 0;
  const globalShrink = clamp((averageAbsoluteError - 0.08) * 0.45, 0, Number(options.maxShrinkage || 0.09));
  const highConfidenceShrink = topProbability >= 0.62 && highBucketError < -0.08
    ? clamp(Math.abs(highBucketError) * 0.12, 0, 0.035)
    : 0;
  const shrinkage = clamp(globalShrink + highConfidenceShrink, 0, Number(options.maxShrinkage || 0.1));
  if (shrinkage <= 0.001) {
    return {
      probabilities: {
        homeProb: Number(normalized.homeProb.toFixed(4)),
        drawProb: Number(normalized.drawProb.toFixed(4)),
        awayProb: Number(normalized.awayProb.toFixed(4)),
      },
      applied: false,
      method: "calibration_within_tolerance",
      reviewMatches,
      averageAbsoluteError,
      shrinkage: 0,
      reason: "Historische kalibratiefout blijft binnen de ingestelde marge.",
    };
  }

  const calibrated = {
    homeProb: normalized.homeProb * (1 - shrinkage) + (1 / 3) * shrinkage,
    drawProb: normalized.drawProb * (1 - shrinkage) + (1 / 3) * shrinkage,
    awayProb: normalized.awayProb * (1 - shrinkage) + (1 / 3) * shrinkage,
  };
  const calibratedTotal = calibrated.homeProb + calibrated.drawProb + calibrated.awayProb;
  return {
    probabilities: {
      homeProb: Number((calibrated.homeProb / calibratedTotal).toFixed(4)),
      drawProb: Number((calibrated.drawProb / calibratedTotal).toFixed(4)),
      awayProb: Number((calibrated.awayProb / calibratedTotal).toFixed(4)),
    },
    applied: true,
    method: "review_based_probability_shrinkage",
    reviewMatches,
    averageAbsoluteError,
    shrinkage: Number(shrinkage.toFixed(4)),
    reason: "Backtest-kalibratie toont overconfidence; 1X2-kansen conservatief richting marktneutraal getrokken.",
  };
}

export function calibrateConfidenceWithBacktest(confidence, modelPerformance, options = {}) {
  const rawConfidence = clamp(Number(confidence || 0), 0, 1);
  const reviewMatches = Number(modelPerformance?.overall?.matches || 0);
  const bucket = confidenceBucketFor(rawConfidence);
  const bucketStats = (modelPerformance?.calibrationBuckets || []).find((item) => item.key === bucket.key) || null;
  const minBucketMatches = Number(options.minBucketMatches || 15);
  const confidenceCap = Number.isFinite(Number(options.confidenceCap)) ? Number(options.confidenceCap) : 0.93;
  const floor = Number.isFinite(Number(options.floor)) ? Number(options.floor) : 0.24;

  if (reviewMatches < Number(options.minReviews || 40) || !bucketStats || Number(bucketStats.matches || 0) < minBucketMatches) {
    return {
      rawConfidence: Number(rawConfidence.toFixed(3)),
      calibratedConfidence: Number(clamp(rawConfidence, floor, confidenceCap).toFixed(3)),
      applied: false,
      method: "insufficient_bucket_reviews",
      bucket: bucket.key,
      bucketMatches: Number(bucketStats?.matches || 0),
      reviewMatches,
      reason: "Niet genoeg historische reviews in deze confidencebucket.",
    };
  }

  const calibrationError = Number(bucketStats.calibrationError || 0);
  const sampleWeight = clamp(Number(bucketStats.matches || 0) / 80, 0.35, 1);
  const correction = clamp(calibrationError * (0.45 + sampleWeight * 0.25), -0.12, 0.07);
  const calibratedConfidence = clamp(rawConfidence + correction, floor, confidenceCap);
  return {
    rawConfidence: Number(rawConfidence.toFixed(3)),
    calibratedConfidence: Number(calibratedConfidence.toFixed(3)),
    applied: Math.abs(correction) >= 0.005,
    method: "confidence_bucket_backtest_calibration",
    bucket: bucket.key,
    bucketMatches: Number(bucketStats.matches || 0),
    avgBucketConfidence: bucketStats.avgConfidence,
    observedOutcomeRate: bucketStats.observedOutcomeRate,
    calibrationError,
    correction: Number(correction.toFixed(3)),
    reviewMatches,
    reason:
      correction < -0.005
        ? "Historische bucket is overconfident; confidence verlaagd."
        : correction > 0.005
          ? "Historische bucket presteert beter dan confidence; confidence licht verhoogd."
          : "Historische bucket ligt dicht genoeg bij de getoonde confidence.",
  };
}

export function summarizeReviewGroup(key, reviews) {
  const items = reviews || [];
  const matches = items.length;
  const exactHits = items.filter((item) => item.exactHit).length;
  const outcomeHits = items.filter((item) => item.outcomeHit).length;
  const probabilityHits = items.filter((item) => item.probabilityOutcomeHit).length;
  const bttsReviews = items.filter((item) => item.bttsHit != null);
  const over25Reviews = items.filter((item) => item.over25Hit != null);
  const totalGoalError = items.reduce((sum, item) => sum + Number(item.totalGoalError || 0), 0);
  const confidence = items.reduce((sum, item) => sum + Number(item.confidence || 0), 0);
  const modelAgreement = items.reduce((sum, item) => sum + Number(item.modelAgreement || 0), 0);
  const brierValues = items.map((item) => item.brierScore).filter((value) => numeric(value) != null);
  const logLossValues = items.map((item) => item.logLoss).filter((value) => numeric(value) != null);
  const roiValues = items.map((item) => item.roi).filter((value) => numeric(value) != null);
  const snapshotBacked = items.filter((item) => item.evaluationSource === "prediction_snapshot").length;
  const oddsReady = items.filter(hasUsableOdds).length;
  const leakageKnown = items.filter((item) => item.leakageGuard?.cutoffBeforeKickoff === true).length;
  return {
    key,
    matches,
    exactHitRate: hitRate(exactHits, matches),
    outcomeHitRate: hitRate(outcomeHits, matches),
    probabilityOutcomeHitRate: hitRate(probabilityHits, matches),
    bttsHitRate: hitRate(bttsReviews.filter((item) => item.bttsHit).length, bttsReviews.length),
    over25HitRate: hitRate(over25Reviews.filter((item) => item.over25Hit).length, over25Reviews.length),
    avgGoalError: Number((totalGoalError / Math.max(matches, 1)).toFixed(2)),
    avgConfidence: Number((confidence / Math.max(matches, 1)).toFixed(3)),
    avgModelAgreement: Number((modelAgreement / Math.max(matches, 1)).toFixed(3)),
    avgBrierScore: average(brierValues, 4),
    avgLogLoss: average(logLossValues, 4),
    roiTotal: roiValues.length ? Number(roiValues.reduce((sum, value) => sum + Number(value), 0).toFixed(4)) : null,
    metricCoverage: {
      brier: hitRate(brierValues.length, matches),
      logLoss: hitRate(logLossValues.length, matches),
      roi: hitRate(roiValues.length, matches),
      odds: hitRate(oddsReady, matches),
      snapshot: hitRate(snapshotBacked, matches),
      leakageCutoffKnown: hitRate(leakageKnown, matches),
    },
  };
}

export function buildCalibrationBuckets(reviews) {
  const groups = Object.fromEntries(CONFIDENCE_BUCKETS.map((bucket) => [bucket.key, { ...bucket, items: [] }]));
  for (const review of reviews || []) {
    const bucket = confidenceBucketFor(review?.confidence);
    groups[bucket.key].items.push(review);
  }

  return Object.values(groups).map((bucket) => {
    const items = bucket.items;
    const matches = items.length;
    const avgConfidence = average(items.map((item) => item.confidence), 3) ?? 0;
    const observedOutcomeRate = hitRate(items.filter((item) => item.probabilityOutcomeHit).length, matches);
    const observedWinnerRate = hitRate(items.filter((item) => item.outcomeHit).length, matches);
    const calibrationError = matches ? Number((observedOutcomeRate - avgConfidence).toFixed(3)) : null;
    return {
      key: bucket.key,
      label: bucket.label,
      matches,
      avgConfidence,
      observedOutcomeRate,
      observedWinnerRate,
      calibrationError,
      avgBrierScore: average(items.map((item) => item.brierScore), 4),
      avgLogLoss: average(items.map((item) => item.logLoss), 4),
    };
  });
}

function buildMetricCoverage(items) {
  const total = items.length;
  return {
    brier: hitRate(items.filter((item) => numeric(item.brierScore) != null).length, total),
    logLoss: hitRate(items.filter((item) => numeric(item.logLoss) != null).length, total),
    roi: hitRate(items.filter((item) => numeric(item.roi) != null).length, total),
    clv: hitRate(items.filter((item) => numeric(item.clv) != null).length, total),
    oddsAtPrediction: hitRate(items.filter(hasUsableOdds).length, total),
    snapshots: hitRate(items.filter((item) => item.evaluationSource === "prediction_snapshot").length, total),
  };
}

function buildLeakageSummary(items) {
  const total = items.length;
  const snapshotBacked = items.filter((item) => item.evaluationSource === "prediction_snapshot").length;
  const fallback = items.filter((item) => item.evaluationSource === "current_prediction_fallback").length;
  const cutoffKnown = items.filter((item) => item.leakageGuard?.cutoffBeforeKickoff === true).length;
  const highRisk = items.filter((item) => item.leakageGuard?.risk === "high").length;
  const sourceTimestampKnown = items.filter((item) => item.leakageGuard?.sourceTimestampsKnown).length;
  return {
    snapshotBacked,
    fallback,
    cutoffKnown,
    highRisk,
    sourceTimestampKnown,
    snapshotCoverage: hitRate(snapshotBacked, total),
    cutoffCoverage: hitRate(cutoffKnown, total),
    sourceTimestampCoverage: hitRate(sourceTimestampKnown, total),
  };
}

export function buildModelPerformanceFromReviews(reviews) {
  const items = Object.values(reviews || {});
  const byLeague = Object.entries(groupReviewsBy(items, (item) => item.league))
    .map(([key, group]) => summarizeReviewGroup(key, group))
    .sort((a, b) => b.matches - a.matches || b.outcomeHitRate - a.outcomeHitRate);
  const byPhase = Object.entries(groupReviewsBy(items, (item) => item.phaseBucket))
    .map(([key, group]) => summarizeReviewGroup(key, group))
    .sort((a, b) => b.matches - a.matches || b.outcomeHitRate - a.outcomeHitRate);
  const byModel = Object.entries(groupReviewsBy(items, (item) => item.modelName || "ensemble"))
    .map(([key, group]) => summarizeReviewGroup(key, group))
    .sort((a, b) => b.matches - a.matches || b.outcomeHitRate - a.outcomeHitRate);
  const byModelVersion = Object.entries(groupReviewsBy(items, (item) => item.modelVersion || "unknown"))
    .map(([key, group]) => summarizeReviewGroup(key, group))
    .sort((a, b) => b.matches - a.matches || b.outcomeHitRate - a.outcomeHitRate);
  const confidenceBuckets = Object.entries(
    groupReviewsBy(items, (item) => {
      const confidence = Number(item.confidence || 0);
      if (confidence >= 0.68) return "hoog";
      if (confidence >= 0.52) return "gemiddeld";
      return "laag";
    })
  )
    .map(([key, group]) => summarizeReviewGroup(key, group))
    .sort((a, b) => ({ hoog: 0, gemiddeld: 1, laag: 2 }[a.key] - { hoog: 0, gemiddeld: 1, laag: 2 }[b.key]));

  const overall = summarizeReviewGroup("overall", items);
  const calibrationBuckets = buildCalibrationBuckets(items);
  const calibrationError = average(
    calibrationBuckets.filter((bucket) => bucket.matches >= 5).map((bucket) => Math.abs(Number(bucket.calibrationError || 0))),
    3
  );
  const probabilityLayerBetter = Number(overall.probabilityOutcomeHitRate || 0) > Number(overall.outcomeHitRate || 0) + 0.03;
  const modelComparisonStatus =
    byModel.length <= 1
      ? "Alle reviews staan nu op ensemble; losse submodellen worden nog niet apart als eigen model beoordeeld."
      : `Beste model in reviews: ${byModel[0]?.key || "onbekend"}.`;
  return {
    generatedAt: new Date().toISOString(),
    overall,
    byLeague: byLeague.slice(0, 24),
    byPhase,
    byModel,
    byModelVersion: byModelVersion.slice(0, 12),
    modelComparisonStatus,
    modelSelectionAdvice: probabilityLayerBetter
      ? "De 1X2-kanslaag scoort beter dan de uitkomst van de gekozen exacte score. Gebruik de scorematrix voor exacte score, maar laat winnaar/gelijk sterker door de 1X2-kanslaag bewaken."
      : "De huidige ensemble-selectie ligt voldoende in lijn met de 1X2-kanslaag.",
    confidenceBuckets,
    calibrationBuckets,
    calibrationSummary: {
      averageAbsoluteError: calibrationError,
      status: calibrationError == null ? "unknown" : calibrationError <= 0.08 ? "goed" : calibrationError <= 0.14 ? "matig" : "zwak",
    },
    metricCoverage: buildMetricCoverage(items),
    weakestLeagues: byLeague
      .filter((item) => item.matches >= 5)
      .sort((a, b) => a.outcomeHitRate - b.outcomeHitRate || b.avgGoalError - a.avgGoalError)
      .slice(0, 8),
    summary:
      items.length > 0
        ? `Modelperformance: ${Math.round(overall.outcomeHitRate * 100)}% winnaar/gelijk, ${Math.round(overall.exactHitRate * 100)}% exacte score, Brier ${overall.avgBrierScore ?? "n.v.t."}, log loss ${overall.avgLogLoss ?? "n.v.t."}. ${modelComparisonStatus}`
        : "Nog geen modelperformance beschikbaar.",
  };
}

export function buildBacktestSummaryFromReviews(reviews) {
  const items = Object.values(reviews || {});
  const byMonth = Object.entries(
    groupReviewsBy(items, (item) => String(item.date || "").slice(0, 7) || "unknown")
  )
    .map(([key, group]) => summarizeReviewGroup(key, group))
    .sort((a, b) => String(b.key).localeCompare(String(a.key)));
  const topExactPicks = items.filter((item) => item.topExactScorePick);
  const nonTopExactPicks = items.filter((item) => !item.topExactScorePick);
  const highConfidence = items.filter((item) => Number(item.confidence || 0) >= 0.68);
  const lowConfidence = items.filter((item) => Number(item.confidence || 0) < 0.52);
  const snapshotBacked = items.filter((item) => item.evaluationSource === "prediction_snapshot");
  const fallback = items.filter((item) => item.evaluationSource !== "prediction_snapshot");
  const oddsReady = items.filter(hasUsableOdds);
  const calibrationBuckets = buildCalibrationBuckets(items);
  const latestWindow = byMonth[0] || null;
  return {
    generatedAt: new Date().toISOString(),
    windows: byMonth.slice(0, 18),
    strategies: [
      summarizeReviewGroup("top-5 exact-score picks", topExactPicks),
      summarizeReviewGroup("overige voorspellingen", nonTopExactPicks),
      summarizeReviewGroup("hoog vertrouwen", highConfidence),
      summarizeReviewGroup("laag vertrouwen", lowConfidence),
      summarizeReviewGroup("snapshot-backed", snapshotBacked),
      summarizeReviewGroup("fallback reviews", fallback),
      summarizeReviewGroup("odds-ready reviews", oddsReady),
    ],
    calibrationBuckets,
    leakageSummary: buildLeakageSummary(items),
    metricCoverage: buildMetricCoverage(items),
    latestWindow,
    summary:
      items.length > 0
        ? `Backtest uit opgeslagen reviews: ${items.length} wedstrijden, laatste venster ${latestWindow?.key || "onbekend"}, Brier ${latestWindow?.avgBrierScore ?? "n.v.t."}.`
        : "Nog geen backtestdata beschikbaar.",
  };
}

function collectPredictionRecords(store, todayKey) {
  const matches = Array.isArray(store.matches?.[todayKey]) ? store.matches[todayKey] : [];
  const predictions = Array.isArray(store.predictions?.[todayKey]) ? store.predictions[todayKey] : [];
  const predictionByMatch = new Map(predictions.map((prediction) => [prediction.matchId, prediction]));
  return matches.map((match) => ({
    match,
    prediction: predictionByMatch.get(match.id) || null,
  }));
}

function sourceTimestampCoverageForRecord(match, prediction) {
  const explicit = numeric(prediction?.featureSourceMetadata?.coverage?.timestampCoverage);
  if (explicit != null) return explicit;
  const sourceAsOf = prediction?.sourceAsOf || match?.sourceAsOf || {};
  const keys = ["fixture", "h2h", "homeForm", "awayForm", "standings", "marketProfile", "lineups", "referee"];
  const relevant = keys.filter((key) => sourceAsOf[key] != null);
  if (!relevant.length) return null;
  return Number((relevant.length / keys.length).toFixed(3));
}

function summarizeCompletenessGroup(key, records) {
  const scores = records
    .map(({ match, prediction }) => numeric(prediction?.dataCompletenessScore ?? prediction?.dataCompleteness?.score ?? match?.dataCompletenessScore ?? match?.dataCompleteness?.score))
    .filter((value) => value != null);
  const missingCounts = {};
  for (const { match, prediction } of records) {
    const missing = prediction?.dataCompleteness?.missing || match?.dataCompleteness?.missing || [];
    for (const reason of missing) missingCounts[reason] = Number(missingCounts[reason] || 0) + 1;
  }
  return {
    key,
    matches: records.length,
    averageScore: average(scores, 3),
    p25Score: percentile(scores, 0.25, 3),
    lowCompleteness: records.filter(({ match, prediction }) => Number(prediction?.dataCompletenessScore ?? prediction?.dataCompleteness?.score ?? match?.dataCompletenessScore ?? 0) < 0.58).length,
    topMissing: Object.entries(missingCounts)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count: Number(count) })),
  };
}

export function buildDataCompletenessAudit(store, todayKey) {
  const records = collectPredictionRecords(store, todayKey);
  const total = Math.max(records.length, 1);
  const fieldChecks = {
    h2h: ({ match, prediction }) => Number(prediction?.h2h?.played || match?.h2h?.played || 0) > 0,
    form: ({ prediction }) => Number(prediction?.homeTeamProfile?.matches || prediction?.homeRecent?.gamesPlayed || 0) > 0,
    standings: ({ match, prediction }) => Number(prediction?.homePos || match?.homePos || 0) > 0 && Number(prediction?.awayPos || match?.awayPos || 0) > 0,
    teamIdentity: ({ match, prediction }) =>
      !!(
        (prediction?.teamIdentity?.home?.key || match?.teamIdentity?.home?.key || prediction?.homeTeam || match?.homeTeamName) &&
        (prediction?.teamIdentity?.away?.key || match?.teamIdentity?.away?.key || prediction?.awayTeam || match?.awayTeamName)
      ),
    providerTeamIds: ({ match }) => !!(match?.homeTeamId && match?.awayTeamId),
    xgShots: ({ match, prediction }) =>
      !!prediction?.homeTeamProfile?.xG ||
      !!match?.homeSeasonStats?.xG ||
      match?.homeSeasonStats?.externalSources?.includes?.("Understat") ||
      match?.homeSeasonStats?.externalSources?.includes?.("FBref"),
    marketProfile: ({ match, prediction }) => !!(prediction?.marketCalibration || match?.marketCalibration),
    liveOdds: ({ prediction }) => hasUsableOdds(prediction),
    lineups: ({ match, prediction }) => !!(prediction?.lineupSummary?.confirmed || match?.lineupSummary?.confirmed),
    lineupStatusKnown: ({ match, prediction }) => !!(prediction?.lineupStatus || match?.lineupStatus),
    referee: ({ match, prediction }) => Number(prediction?.refereeProfile?.matches || match?.refereeProfile?.matches || 0) > 0,
    refereeStatusKnown: ({ match, prediction }) => !!(prediction?.refereeStatus || match?.refereeStatus),
    sourceMetadata: ({ prediction }) => !!prediction?.featureSourceMetadata,
  };
  const coverage = Object.fromEntries(
    Object.entries(fieldChecks).map(([field, check]) => [field, hitRate(records.filter(check).length, total)])
  );
  const missingReasons = {};
  for (const { match, prediction } of records) {
    const missing = prediction?.dataCompleteness?.missing || match?.dataCompleteness?.missing || [];
    for (const reason of missing) missingReasons[reason] = Number(missingReasons[reason] || 0) + 1;
  }
  const scores = records
    .map(({ match, prediction }) => numeric(prediction?.dataCompletenessScore ?? prediction?.dataCompleteness?.score ?? match?.dataCompletenessScore ?? match?.dataCompleteness?.score))
    .filter((value) => value != null);
  const sourceTimestampCoverageValues = records
    .map(({ match, prediction }) => sourceTimestampCoverageForRecord(match, prediction))
    .filter((value) => value != null);
  const byLeague = Object.entries(groupReviewsBy(records, ({ match, prediction }) => prediction?.league || match?.league || "unknown"))
    .map(([key, group]) => summarizeCompletenessGroup(key, group))
    .sort((a, b) => (a.averageScore ?? 0) - (b.averageScore ?? 0));
  const lowCompletenessMatches = records
    .filter(({ match, prediction }) => Number(prediction?.dataCompletenessScore ?? prediction?.dataCompleteness?.score ?? match?.dataCompletenessScore ?? 0) < 0.58)
    .slice(0, 8)
    .map(({ match, prediction }) => ({
      matchId: match?.id || prediction?.matchId || null,
      league: prediction?.league || match?.league || null,
      homeTeam: prediction?.homeTeam || match?.homeTeamName || null,
      awayTeam: prediction?.awayTeam || match?.awayTeamName || null,
      score: Number((prediction?.dataCompletenessScore ?? prediction?.dataCompleteness?.score ?? match?.dataCompletenessScore ?? 0).toFixed?.(3) || 0),
      missing: prediction?.dataCompleteness?.missing || match?.dataCompleteness?.missing || [],
    }));
  return {
    generatedAt: new Date().toISOString(),
    date: todayKey,
    matches: records.length,
    averageScore: average(scores, 3),
    p25Score: percentile(scores, 0.25, 3),
    coverage,
    sourceTimestampCoverage: average(sourceTimestampCoverageValues, 3),
    missingReasons: Object.entries(missingReasons)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .map(([reason, count]) => ({ reason, count: Number(count), coverageGap: hitRate(Number(count), total) })),
    lowCompletenessMatches,
    weakestLeagues: byLeague.slice(0, 8),
    summary:
      records.length > 0
        ? `Datacompleetheid vandaag: ${Math.round(Number(average(scores, 3) || 0) * 100)}%, laagste kwart ${Math.round(Number(percentile(scores, 0.25, 3) || 0) * 100)}%.`
        : "Geen wedstrijden voor datacompleetheid-audit.",
  };
}

export function buildOddsIntegrationReadiness(store, todayKey) {
  const todayPredictions = Array.isArray(store.predictions?.[todayKey]) ? store.predictions[todayKey] : [];
  const snapshots = Object.values(store.predictionSnapshots || {});
  const reviews = Object.values(store.postMatchReviews || {});
  const configuredProviders = [
    process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY ? "the-odds-api" : null,
    process.env.ODDS_API_URL_TEMPLATE ? "custom-url-template" : null,
    process.env.FOOTBALL_DATA_TOKEN || process.env.FOOTBALL_DATA_API_KEY ? "football-data.org" : null,
  ].filter(Boolean);
  const envStatus = {
    ODDS_PROVIDER_NAME: !!process.env.ODDS_PROVIDER_NAME,
    ODDS_API_URL_TEMPLATE: !!process.env.ODDS_API_URL_TEMPLATE,
    ODDS_API_KEY: !!process.env.ODDS_API_KEY,
    THE_ODDS_API_KEY: !!process.env.THE_ODDS_API_KEY,
    FOOTBALL_DATA_TOKEN: !!(process.env.FOOTBALL_DATA_TOKEN || process.env.FOOTBALL_DATA_API_KEY),
  };
  const urlTemplateReady = !!process.env.ODDS_API_URL_TEMPLATE;
  const keyReady = !!(process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY);
  const providerNameReady = !!process.env.ODDS_PROVIDER_NAME || keyReady || urlTemplateReady;
  const requiredFields = [
    "provider",
    "bookmaker",
    "market",
    "home",
    "draw",
    "away",
    "capturedAt",
    "closingHome",
    "closingDraw",
    "closingAway",
    "closingCapturedAt",
  ];
  return {
    generatedAt: new Date().toISOString(),
    date: todayKey,
    providerConfigured: configuredProviders.length > 0,
    configuredProviders,
    configurationStatus:
      providerNameReady && urlTemplateReady && keyReady
        ? "ready_for_live_pre_match_odds"
        : keyReady && !urlTemplateReady
          ? "api_key_without_url_template"
          : urlTemplateReady && !keyReady
            ? "url_template_without_api_key"
            : "credentials_needed",
    envStatus,
    environmentVariables: ["ODDS_PROVIDER_NAME", "ODDS_API_URL_TEMPLATE", "ODDS_API_KEY", "THE_ODDS_API_KEY", "FOOTBALL_DATA_TOKEN"],
    requiredFields,
    currentCoverage: {
      predictions: hitRate(todayPredictions.filter(hasUsableOdds).length, todayPredictions.length),
      snapshots: hitRate(snapshots.filter(hasUsableOdds).length, snapshots.length),
      reviews: hitRate(reviews.filter(hasUsableOdds).length, reviews.length),
      historicalMarketOnly: hitRate(todayPredictions.filter((item) => item?.oddsStatus === "historical_market_profile_only").length, todayPredictions.length),
    },
    storageReady: {
      oddsStatus: todayPredictions.some((item) => typeof item?.oddsStatus === "string") || snapshots.some((item) => typeof item?.oddsStatus === "string"),
      roiStatus: reviews.some((item) => typeof item?.roiStatus === "string") || todayPredictions.some((item) => typeof item?.roiStatus === "string"),
      clvStatus: reviews.some((item) => typeof item?.clvStatus === "string") || todayPredictions.some((item) => typeof item?.clvStatus === "string"),
    },
    pipelineSteps: [
      "fetch pre-match 1X2 odds before kickoff",
      "store odds_at_prediction in immutable snapshot",
      "fetch or derive closing odds after market close",
      "settle ROI and CLV only after result",
      "exclude odds captured after cutoff from model input",
    ],
    nextAction: configuredProviders.length
      ? urlTemplateReady && keyReady
        ? "Provider staat klaar: controleer eerst een kleine wedstrijddag en bewaar closing odds apart."
        : "Maak de odds-secret flow compleet: ODDS_API_URL_TEMPLATE plus ODDS_API_KEY/THE_ODDS_API_KEY zijn samen nodig."
      : "Kies of configureer eerst een echte oddsprovider; historische football-data.co.uk profielen blijven alleen calibratie-input.",
  };
}
