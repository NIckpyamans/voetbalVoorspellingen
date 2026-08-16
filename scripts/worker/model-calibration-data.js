import { competitionSegment } from "./competition-segmentation.js";

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
    }))
    .filter((row) => row.prediction_id && row.match_id && row.league && row.probabilities)
    .filter((row) => ["H", "D", "A"].includes(row.actual_outcome));

  // Multiple immutable snapshots of one fixture are valuable for traceability,
  // but they are not independent calibration samples. Keep the latest pre-match
  // observation per fixture/model so a single result cannot dominate both the
  // training and validation windows.
  const latestByMatchAndModel = new Map();
  for (const row of candidates) {
    const key = `${row.match_id}::${row.model_version}`;
    const existing = latestByMatchAndModel.get(key);
    if (!existing || Date.parse(row.generated_at || "") > Date.parse(existing.generated_at || "")) {
      latestByMatchAndModel.set(key, row);
    }
  }

  return [...latestByMatchAndModel.values()]
    .sort((left, right) => Date.parse(left.generated_at || "") - Date.parse(right.generated_at || ""));
}
