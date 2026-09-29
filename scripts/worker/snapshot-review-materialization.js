// Koppelt post-match reviews aan immutable pre-match snapshots. Eerst worden
// al snapshot-backed reviews uit het ledger overgenomen; daarna worden reviews
// die op de actuele-prediction-fallback draaien opnieuw gebonden aan een
// beschikbaar pre-kickoff snapshot, waarbij alle kansmetrics opnieuw uit de
// snapshot-kansen worden berekend. De oude waarden blijven bewaard in
// `reboundFrom` zodat er geen informatie verloren gaat.

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function outcomeFromGoals(homeGoals, awayGoals) {
  const home = Number(homeGoals);
  const away = Number(awayGoals);
  return home > away ? "H" : home < away ? "A" : "D";
}

// Zelfde tie-break als server-worker getPredictedOutcome.
export function mostLikelyOutcome(probabilities = {}) {
  const home = Number(probabilities.home ?? probabilities.homeProb ?? 0);
  const draw = Number(probabilities.draw ?? probabilities.drawProb ?? 0);
  const away = Number(probabilities.away ?? probabilities.awayProb ?? 0);
  if (home >= draw && home >= away) return "H";
  if (away >= draw && away >= home) return "A";
  return "D";
}

export function brierFromProbabilities(probabilities, actualOutcome) {
  const values = { H: Number(probabilities?.home || 0), D: Number(probabilities?.draw || 0), A: Number(probabilities?.away || 0) };
  const score = Object.entries(values).reduce((sum, [outcome, probability]) => {
    const expected = outcome === actualOutcome ? 1 : 0;
    return sum + Math.pow(probability - expected, 2);
  }, 0);
  return Number(score.toFixed(4));
}

export function logLossFromProbabilities(probabilities, actualOutcome) {
  const values = { H: Number(probabilities?.home || 0), D: Number(probabilities?.draw || 0), A: Number(probabilities?.away || 0) };
  const probability = clamp(Number(values[actualOutcome] || 0), 0.000001, 0.999999);
  return Number((-Math.log(probability)).toFixed(4));
}

function outcomeOdd(oddsAtPrediction, outcome) {
  if (!oddsAtPrediction) return null;
  const raw = outcome === "H" ? oddsAtPrediction.home : outcome === "D" ? oddsAtPrediction.draw : oddsAtPrediction.away;
  const odd = Number(raw);
  return Number.isFinite(odd) && odd > 1 ? odd : null;
}

function roiFromOdds(oddsAtPrediction, predictedOutcome, actualOutcome) {
  const odd = outcomeOdd(oddsAtPrediction, predictedOutcome);
  if (!odd) return null;
  return Number((predictedOutcome === actualOutcome ? odd - 1 : -1).toFixed(4));
}

function clvFromOdds(oddsAtPrediction, predictedOutcome) {
  const preMatchOdd = outcomeOdd(oddsAtPrediction, predictedOutcome);
  const closingRaw = predictedOutcome === "H"
    ? oddsAtPrediction?.closingHome
    : predictedOutcome === "D"
      ? oddsAtPrediction?.closingDraw
      : oddsAtPrediction?.closingAway;
  const closingOdd = Number(closingRaw);
  if (!preMatchOdd || !(Number.isFinite(closingOdd) && closingOdd > 1)) return null;
  return Number(((preMatchOdd - closingOdd) / closingOdd).toFixed(4));
}

function snapshotProbabilities(snapshot) {
  const probabilities = snapshot?.probabilities || snapshot?.prediction?.probabilities || null;
  if (!probabilities) return null;
  const home = Number(probabilities.home ?? probabilities.homeProb);
  const draw = Number(probabilities.draw ?? probabilities.drawProb);
  const away = Number(probabilities.away ?? probabilities.awayProb);
  if (![home, draw, away].every((value) => Number.isFinite(value) && value >= 0)) return null;
  return { home, draw, away };
}

function latestSnapshotForMatch(snapshots, matchId, kickoffMs) {
  const candidates = Object.values(snapshots || {})
    .filter((snapshot) => String(snapshot?.matchId || "") === String(matchId || ""))
    .filter((snapshot) => {
      const generatedMs = Date.parse(snapshot?.generatedAt || "");
      return !Number.isFinite(kickoffMs) || !Number.isFinite(generatedMs) || generatedMs <= kickoffMs;
    })
    .sort((left, right) => Date.parse(right?.generatedAt || "") - Date.parse(left?.generatedAt || ""));
  return candidates[0] || null;
}

export function materializeSnapshotBackedReviews(day, ledgerReviews) {
  const next = { ...(day || {}), reviews: { ...(day?.reviews || {}) } };
  const matchIds = new Set((day?.matches || []).map((match) => String(match?.id || "")).filter(Boolean));
  let linked = 0;
  let unchanged = 0;
  for (const matchId of matchIds) {
    const candidate = ledgerReviews?.[matchId];
    if (candidate?.evaluationSource !== "prediction_snapshot" || !candidate?.predictionId) continue;
    const current = next.reviews[matchId];
    if (
      current?.evaluationSource === "prediction_snapshot" &&
      current?.predictionId === candidate.predictionId &&
      current?.evaluatedAt === candidate.evaluatedAt
    ) {
      unchanged += 1;
      continue;
    }
    next.reviews[matchId] = candidate;
    linked += 1;
  }
  return { day: next, linked, unchanged };
}

// Herberekent een review vanaf een immutable pre-match snapshot. Alleen
// voorspellings-gebaseerde velden en metrics worden vervangen; uitslagvelden
// (actualScore, actualOutcome, hits) blijven behouden.
export function rebindReviewToSnapshot(review, snapshot) {
  const probabilities = snapshotProbabilities(snapshot);
  if (!review || !snapshot || !probabilities) return null;

  const expectedScore = snapshot.expectedScore || snapshot.prediction?.expectedScore || {};
  const predHomeGoals = Number(expectedScore.home ?? review.predictedScore?.split("-")[0] ?? 0);
  const predAwayGoals = Number(expectedScore.away ?? review.predictedScore?.split("-")[1] ?? 0);
  const predictedOutcome = outcomeFromGoals(predHomeGoals, predAwayGoals);
  const probabilityOutcome = mostLikelyOutcome(probabilities);
  const actualOutcome = String(review.actualOutcome || outcomeFromGoals(...String(review.actualScore || "0-0").split("-").map(Number)) || "");
  const [actualHomeGoals, actualAwayGoals] = String(review.actualScore || "0-0").split("-").map(Number);
  const predictedTotalGoals = predHomeGoals + predAwayGoals;
  const actualTotalGoals = Number(actualHomeGoals) + Number(actualAwayGoals);
  const predictedBtts = snapshot.prediction?.btts != null ? Number(snapshot.prediction.btts) >= 0.5 : predHomeGoals > 0 && predAwayGoals > 0;
  const predictedOver25 = snapshot.prediction?.over25 != null ? Number(snapshot.prediction.over25) >= 0.5 : predictedTotalGoals >= 3;
  const oddsAtPrediction = snapshot.oddsAtPrediction || snapshot.prediction?.oddsAtPrediction || review.oddsAtPrediction || null;
  const roi = snapshot.prediction?.roi ?? roiFromOdds(oddsAtPrediction, probabilityOutcome, actualOutcome);
  const clv = snapshot.prediction?.clv ?? clvFromOdds(oddsAtPrediction, probabilityOutcome);
  const modelEdges = snapshot.prediction?.modelEdges || snapshot.explanation?.modelEdges || null;

  return {
    ...review,
    predictionId: snapshot.predictionId || review.predictionId || null,
    generatedAt: snapshot.generatedAt || review.generatedAt || null,
    cutoffAt: snapshot.cutoffAt || snapshot.generatedAt || review.cutoffAt || null,
    modelVersion: snapshot.modelVersion || review.modelVersion || null,
    featureSchemaVersion: snapshot.featureSchemaVersion || review.featureSchemaVersion || null,
    inputSnapshotHash: snapshot.inputSnapshotHash || review.inputSnapshotHash || null,
    modelName: modelEdges?.model || modelEdges?.modelName || review.modelName || "ensemble",
    riskProfile: modelEdges?.riskProfile || review.riskProfile || "unknown",
    modelAgreement: Number(modelEdges?.modelAgreement ?? review.modelAgreement ?? 0),
    confidence: Number(snapshot.confidence ?? review.confidence ?? 0),
    predictedScore: `${predHomeGoals}-${predAwayGoals}`,
    predictedOutcome,
    probabilityOutcome,
    predictedTotalGoals,
    predictedBtts,
    predictedOver25,
    bttsHit: predictedBtts === Boolean(review.actualBtts),
    over25Hit: predictedOver25 === Boolean(review.actualOver25),
    brierScore: brierFromProbabilities(probabilities, actualOutcome),
    logLoss: logLossFromProbabilities(probabilities, actualOutcome),
    roi,
    roiStatus: roi == null ? "odds_missing" : "settled",
    clv,
    clvStatus: clv == null ? "closing_odds_missing" : "settled",
    oddsAtPrediction,
    oddsStatus: snapshot.oddsStatus || review.oddsStatus || null,
    oddsMissingReason: snapshot.oddsMissingReason ?? review.oddsMissingReason ?? null,
    featureSourceMetadata: snapshot.featureSourceMetadata || snapshot.prediction?.featureSourceMetadata || review.featureSourceMetadata || null,
    leakageGuard: snapshot.leakageGuard || review.leakageGuard || null,
    leakageRisk: null,
    outcomeHit: predictedOutcome === actualOutcome,
    probabilityOutcomeHit: probabilityOutcome === actualOutcome,
    exactHit: predHomeGoals === actualHomeGoals && predAwayGoals === actualAwayGoals,
    totalGoalError: Math.abs(predHomeGoals - actualHomeGoals) + Math.abs(predAwayGoals - actualAwayGoals),
    totalGoalBias: Number((actualTotalGoals - predictedTotalGoals).toFixed(2)),
    homeGoalBias: Number((actualHomeGoals - predHomeGoals).toFixed(2)),
    awayGoalBias: Number((actualAwayGoals - predAwayGoals).toFixed(2)),
    evaluationSource: "prediction_snapshot",
    reboundFrom: {
      ...(review.reboundFrom || {}),
      previousEvaluationSource: review.evaluationSource || "unknown",
      previousPredictionId: review.predictionId || null,
      previousMetrics: {
        predictedScore: review.predictedScore ?? null,
        predictedOutcome: review.predictedOutcome ?? null,
        probabilityOutcome: review.probabilityOutcome ?? null,
        brierScore: review.brierScore ?? null,
        logLoss: review.logLoss ?? null,
        roi: review.roi ?? null,
        clv: review.clv ?? null,
      },
      reboundAt: new Date().toISOString(),
    },
  };
}

// Bindt fallback-reviews opnieuw aan beschikbare pre-kickoff snapshots uit het
// ledger. Reviews die al snapshot-backed zijn blijven ongewijzigd.
export function rebindFallbackReviewsToSnapshots(day, ledgerSnapshots) {
  const next = { ...(day || {}), reviews: { ...(day?.reviews || {}) } };
  const kickoffByMatch = new Map(
    (day?.matches || []).map((match) => [String(match?.id || ""), Date.parse(match?.kickoff || match?.date || "")])
  );
  let rebound = 0;
  let kept = 0;
  for (const [matchId, review] of Object.entries(next.reviews || {})) {
    if (!review || review.evaluationSource === "prediction_snapshot") continue;
    const snapshot = latestSnapshotForMatch(ledgerSnapshots, matchId, kickoffByMatch.get(matchId));
    const reboundReview = snapshot ? rebindReviewToSnapshot(review, snapshot) : null;
    if (reboundReview) {
      next.reviews[matchId] = reboundReview;
      rebound += 1;
    } else {
      kept += 1;
    }
  }
  return { day: next, rebound, kept };
}
