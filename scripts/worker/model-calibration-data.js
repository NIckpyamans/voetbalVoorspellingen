import { competitionSegment } from "./competition-segmentation.js";
import { SNAPSHOT_WINDOWS, snapshotTrainingEligibility } from "./snapshot-policy.js";

function probabilities(row) {
  const value = row?.probabilities || row?.ensembleMeta?.baseProbabilities || null;
  if (!value) return null;
  const home = Number(value.home ?? value.homeProb);
  const draw = Number(value.draw ?? value.drawProb);
  const away = Number(value.away ?? value.awayProb);
  return [home, draw, away].every(Number.isFinite) ? { home, draw, away } : null;
}

export function trainingCalibrationRows(training) {
  const candidates = (Array.isArray(training?.rows) ? training.rows : [])
    .filter((row) => row?.snapshotBacked)
    .filter((row) => snapshotTrainingEligibility({
      ...row,
      features: row.featureVector,
      inputSnapshotHash: row.inputSnapshotHash || row.predictionId,
    }).eligible)
    .filter((row) => /^(FT|AET|PEN)$/i.test(String(row?.status || "")))
    .map((row) => ({
      prediction_id: row.predictionId,
      match_id: row.matchId,
      model_version: row.modelVersion || row.review?.modelVersion || "unknown",
      probabilities: probabilities(row),
      generated_at: row.generatedAt,
      competition_id: null,
      league: row.league,
      competition_segment: competitionSegment(row),
      actual_outcome: String(row.label || row.review?.actualOutcome || "").toUpperCase(),
      snapshot_window: row.snapshotWindow || snapshotTrainingEligibility({ ...row, features: row.featureVector, inputSnapshotHash: row.predictionId }).snapshotWindow,
    }))
    .filter((row) => row.prediction_id && row.match_id && row.league && row.probabilities)
    .filter((row) => ["H", "D", "A"].includes(row.actual_outcome));

  // One fixture is one independent calibration sample. Prefer the latest
  // required decision window (T-20, T-45, T-75, T-24), not an arbitrary rerun.
  const latestByMatchAndModel = new Map();
  for (const row of candidates) {
    const key = `${row.match_id}::${row.model_version}`;
    const existing = latestByMatchAndModel.get(key);
    const candidatePriority = SNAPSHOT_WINDOWS[row.snapshot_window]?.priority || 0;
    const existingPriority = SNAPSHOT_WINDOWS[existing?.snapshot_window]?.priority || 0;
    if (!existing || candidatePriority > existingPriority || (candidatePriority === existingPriority && Date.parse(row.generated_at || "") > Date.parse(existing.generated_at || ""))) {
      latestByMatchAndModel.set(key, row);
    }
  }

  return [...latestByMatchAndModel.values()]
    .sort((left, right) => Date.parse(left.generated_at || "") - Date.parse(right.generated_at || ""));
}

export function ledgerCalibrationRows(ledger = {}) {
  const snapshots = ledger?.predictionSnapshots || {};
  const evaluations = ledger?.evaluations || {};
  const candidates = Object.entries(evaluations)
    .map(([predictionId, evaluation]) => {
      const snapshot = snapshots[predictionId];
      if (!snapshot || !evaluation) return null;
      const actualOutcome = String(evaluation.actualOutcome || evaluation.actual_outcome || "").toUpperCase();
      const rowProbabilities = probabilities(snapshot);
      if (!rowProbabilities || !["H", "D", "A"].includes(actualOutcome)) return null;
      const generatedAt = snapshot.generatedAt || snapshot.cutoffAt || evaluation.generatedAt || null;
      const kickoff = snapshot.kickoff || evaluation.kickoff || null;
      const eligibility = snapshotTrainingEligibility(snapshot);
      if (!eligibility.eligible) return null;
      return {
        prediction_id: snapshot.predictionId || predictionId,
        match_id: snapshot.matchId || evaluation.matchId,
        model_version: snapshot.modelVersion || snapshot.prediction?.modelVersion || "unknown",
        probabilities: rowProbabilities,
        generated_at: generatedAt,
        competition_id: snapshot.competitionId || null,
        league: snapshot.league || snapshot.prediction?.league || null,
        competition_segment: competitionSegment(snapshot),
        actual_outcome: actualOutcome,
        status: "FT",
        evaluation_source: evaluation.evaluationSource || "immutable_ledger",
        snapshot_window: eligibility.snapshotWindow,
      };
    })
    .filter((row) => row?.prediction_id && row?.match_id && row?.league);

  const latestByMatchAndModel = new Map();
  for (const row of candidates) {
    const key = `${row.match_id}::${row.model_version}`;
    const existing = latestByMatchAndModel.get(key);
    const candidatePriority = SNAPSHOT_WINDOWS[row.snapshot_window]?.priority || 0;
    const existingPriority = SNAPSHOT_WINDOWS[existing?.snapshot_window]?.priority || 0;
    if (!existing || candidatePriority > existingPriority || (candidatePriority === existingPriority && Date.parse(row.generated_at || "") > Date.parse(existing.generated_at || ""))) {
      latestByMatchAndModel.set(key, row);
    }
  }
  return [...latestByMatchAndModel.values()]
    .sort((left, right) => Date.parse(left.generated_at || "") - Date.parse(right.generated_at || ""));
}

export function mergeCalibrationRows(...rowSets) {
  const latestByMatchAndModel = new Map();
  for (const row of rowSets.flat().filter(Boolean)) {
    if (!row?.match_id || !row?.prediction_id || !row?.probabilities) continue;
    const key = `${row.match_id}::${row.model_version || "unknown"}`;
    const existing = latestByMatchAndModel.get(key);
    if (!existing || Date.parse(row.generated_at || "") >= Date.parse(existing.generated_at || "")) {
      latestByMatchAndModel.set(key, row);
    }
  }
  return [...latestByMatchAndModel.values()]
    .sort((left, right) => Date.parse(left.generated_at || "") - Date.parse(right.generated_at || ""));
}
