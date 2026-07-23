function probabilities(row) {
  const value = row?.probabilities || row?.ensembleMeta?.baseProbabilities || null;
  if (!value) return null;
  const home = Number(value.home ?? value.homeProb);
  const draw = Number(value.draw ?? value.drawProb);
  const away = Number(value.away ?? value.awayProb);
  return [home, draw, away].every(Number.isFinite) ? { home, draw, away } : null;
}

export function trainingCalibrationRows(training) {
  return (Array.isArray(training?.rows) ? training.rows : [])
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
      actual_outcome: String(row.label || row.review?.actualOutcome || "").toUpperCase(),
    }))
    .filter((row) => row.prediction_id && row.match_id && row.league && row.probabilities)
    .filter((row) => ["H", "D", "A"].includes(row.actual_outcome))
    .sort((left, right) => Date.parse(left.generated_at || "") - Date.parse(right.generated_at || ""));
}
