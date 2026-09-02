import { snapshotTrainingEligibility } from "./snapshot-policy.js";

const clamp = (value) => Math.max(1e-9, Math.min(1 - 1e-9, Number(value || 0)));

function normalizedProbabilities(value) {
  const raw = [Number(value?.home ?? value?.homeProb ?? 0), Number(value?.draw ?? value?.drawProb ?? 0), Number(value?.away ?? value?.awayProb ?? 0)];
  const total = raw.reduce((sum, item) => sum + Math.max(0, item), 0);
  if (total <= 0) return null;
  const [home, draw, away] = raw.map((item) => clamp(Math.max(0, item) / total));
  return { home, draw, away };
}

function outcomeForScore(home, away) {
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return home > away ? "H" : home < away ? "A" : "D";
}

export function normalizeEvaluationResult(value) {
  if (!value) return null;
  const directOutcome = String(value.actualOutcome || value.actual_outcome || "").toUpperCase();
  let home = Number(value.finalHomeGoals ?? value.final_home_goals);
  let away = Number(value.finalAwayGoals ?? value.final_away_goals);
  const score = String(value.actualScore || value.score || "");
  if ((!Number.isFinite(home) || !Number.isFinite(away)) && /^\d+\s*-\s*\d+$/.test(score)) {
    [home, away] = score.split("-").map(Number);
  }
  const outcome = ["H", "D", "A"].includes(directOutcome) ? directOutcome : outcomeForScore(home, away);
  if (!outcome) return null;
  return { actualOutcome: outcome, finalHomeGoals: home, finalAwayGoals: away };
}

export function evaluateImmutableSnapshot(snapshot, rawResult, options = {}) {
  const eligibility = snapshotTrainingEligibility(snapshot);
  if (!eligibility.eligible) return null;
  const result = normalizeEvaluationResult(rawResult);
  const probabilities = normalizedProbabilities(snapshot?.probabilities || snapshot?.prediction);
  if (!snapshot?.predictionId || !result || !probabilities) return null;
  const generatedAt = snapshot.generatedAt || snapshot.cutoffAt || null;
  const cutoffAt = snapshot.cutoffAt || generatedAt;
  const kickoff = snapshot.kickoff || options.kickoff || null;
  if (cutoffAt && kickoff && Date.parse(cutoffAt) > Date.parse(kickoff)) return null;

  const values = [["H", probabilities.home], ["D", probabilities.draw], ["A", probabilities.away]];
  const predictedOutcome = values.sort((a, b) => b[1] - a[1])[0][0];
  const vector = { H: [1, 0, 0], D: [0, 1, 0], A: [0, 0, 1] }[result.actualOutcome];
  const brierScore = ((probabilities.home-vector[0])**2 + (probabilities.draw-vector[1])**2 + (probabilities.away-vector[2])**2) / 3;
  const actualProbability = result.actualOutcome === "H" ? probabilities.home : result.actualOutcome === "D" ? probabilities.draw : probabilities.away;
  const expected = snapshot.expectedScore || {};
  const scoreParts = String(typeof expected === "string" ? expected : "").match(/^(\d+)\s*-\s*(\d+)$/);
  const expectedHome = Number(scoreParts?.[1] ?? expected.home ?? snapshot.prediction?.predHomeGoals);
  const expectedAway = Number(scoreParts?.[2] ?? expected.away ?? snapshot.prediction?.predAwayGoals);
  const exactHit = Number.isFinite(expectedHome) && Number.isFinite(expectedAway)
    ? expectedHome === result.finalHomeGoals && expectedAway === result.finalAwayGoals
    : null;

  const odds = snapshot.oddsAtPrediction || snapshot.prediction?.oddsAtPrediction || null;
  const capturedAt = odds?.capturedAt || null;
  const prematch = !!odds && capturedAt && kickoff && Date.parse(capturedAt) < Date.parse(kickoff);
  const selectedOdd = Number(predictedOutcome === "H" ? odds?.home : predictedOutcome === "D" ? odds?.draw : odds?.away);
  const roi = prematch && selectedOdd > 1 ? (predictedOutcome === result.actualOutcome ? selectedOdd - 1 : -1) : null;
  const closingOdd = Number(predictedOutcome === "H" ? odds?.closingHome : predictedOutcome === "D" ? odds?.closingDraw : odds?.closingAway);
  const closingCapturedAt = odds?.closingCapturedAt || null;
  const closingValid = prematch && closingCapturedAt && Date.parse(closingCapturedAt) > Date.parse(capturedAt) && closingOdd > 1;

  return {
    predictionId: snapshot.predictionId,
    matchId: snapshot.matchId,
    exactHit,
    outcomeHit: predictedOutcome === result.actualOutcome,
    probabilityOutcomeHit: predictedOutcome === result.actualOutcome,
    brierScore: Number(brierScore.toFixed(6)),
    logLoss: Number((-Math.log(actualProbability)).toFixed(6)),
    roi: roi == null ? null : Number(roi.toFixed(6)),
    roiStatus: roi == null ? "prematch_odds_missing" : "settled",
    clv: closingValid ? Number((selectedOdd / closingOdd - 1).toFixed(6)) : null,
    clvStatus: closingValid ? "settled" : "timestamped_closing_odds_missing",
    predictedOutcome,
    actualOutcome: result.actualOutcome,
    finalHomeGoals: result.finalHomeGoals,
    finalAwayGoals: result.finalAwayGoals,
    evaluationSource: options.evaluationSource || "r2-immutable-ledger-evaluator",
    generatedAt,
    cutoffAt,
    kickoff,
    snapshotWindow: eligibility.snapshotWindow,
    minutesBeforeKickoff: eligibility.minutesBeforeKickoff,
    evaluatedAt: new Date().toISOString(),
  };
}

function expectedScoreLabel(snapshot) {
  const expected = snapshot?.expectedScore || snapshot?.prediction?.expectedScore || {};
  if (typeof expected === "string" && /^\d+\s*-\s*\d+$/.test(expected)) return expected.replace(/\s+/g, "");
  const home = Number(expected?.home ?? snapshot?.prediction?.predHomeGoals);
  const away = Number(expected?.away ?? snapshot?.prediction?.predAwayGoals);
  return Number.isFinite(home) && Number.isFinite(away) ? `${home}-${away}` : null;
}

export function buildSnapshotBackedReview(snapshot, rawResult, evaluation, previousReview = null) {
  if (!snapshot?.predictionId || !evaluation?.predictionId || snapshot.predictionId !== evaluation.predictionId) return null;
  const actualScore = Number.isFinite(Number(evaluation.finalHomeGoals)) && Number.isFinite(Number(evaluation.finalAwayGoals))
    ? `${Number(evaluation.finalHomeGoals)}-${Number(evaluation.finalAwayGoals)}`
    : previousReview?.actualScore || rawResult?.actualScore || rawResult?.score || null;
  const predictedScore = expectedScoreLabel(snapshot) || previousReview?.predictedScore || null;
  if (!actualScore || !predictedScore) return null;
  return {
    ...(previousReview || {}),
    matchId: snapshot.matchId,
    predictionId: snapshot.predictionId,
    date: snapshot.date || previousReview?.date || String(snapshot.kickoff || "").slice(0, 10) || null,
    league: snapshot.league || previousReview?.league || rawResult?.league || null,
    homeTeamName: snapshot.homeTeam || snapshot.inputSnapshot?.homeTeam || previousReview?.homeTeamName || rawResult?.homeTeamName || null,
    awayTeamName: snapshot.awayTeam || snapshot.inputSnapshot?.awayTeam || previousReview?.awayTeamName || rawResult?.awayTeamName || null,
    predictedScore,
    actualScore,
    predictedOutcome: evaluation.predictedOutcome,
    probabilityOutcome: evaluation.predictedOutcome,
    actualOutcome: evaluation.actualOutcome,
    exactHit: evaluation.exactHit,
    outcomeHit: evaluation.outcomeHit,
    probabilityOutcomeHit: evaluation.outcomeHit,
    brierScore: evaluation.brierScore,
    logLoss: evaluation.logLoss,
    roi: evaluation.roi,
    roiStatus: evaluation.roiStatus,
    clv: evaluation.clv,
    clvStatus: evaluation.clvStatus,
    generatedAt: snapshot.generatedAt || evaluation.generatedAt || null,
    cutoffAt: snapshot.cutoffAt || snapshot.generatedAt || evaluation.cutoffAt || null,
    modelVersion: snapshot.modelVersion || snapshot.prediction?.modelVersion || previousReview?.modelVersion || null,
    featureSchemaVersion: snapshot.featureSchemaVersion || previousReview?.featureSchemaVersion || null,
    sourceTimestampCoverage: snapshot.sourceTimestampCoverage ?? snapshot.prediction?.sourceTimestampCoverage ?? previousReview?.sourceTimestampCoverage ?? null,
    evaluationSource: "prediction_snapshot",
    immutableEvaluationSource: evaluation.evaluationSource,
    leakageRisk: null,
    evaluatedAt: evaluation.evaluatedAt,
  };
}
