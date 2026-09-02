import { isHiddenInternationalOrWorldCupEntity } from "../../shared/competitionVisibility.js";
import { snapshotTrainingEligibility } from "./snapshot-policy.js";

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
    ensembleMeta: snapshot.ensembleMeta || snapshot.prediction?.ensembleMeta || null,
    dbFeatureContext: snapshot.dbFeatureContext || snapshot.inputSnapshot?.dbFeatureContext || null,
    snapshotStatus: snapshot.status || null,
    snapshotBacked: true,
    recoverySource: review ? "post_match_review" : "immutable_evaluation",
  };
}

export function recoverTrainingRows(ledger) {
  return Object.values(ledger?.predictionSnapshots || {})
    .map((snapshot) => snapshotTrainingRow(
      snapshot,
      ledger?.postMatchReviews?.[snapshot.matchId],
      ledger?.evaluations?.[snapshot.predictionId]
    ))
    .filter(Boolean);
}
