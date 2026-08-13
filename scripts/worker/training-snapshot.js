function rowKey(row) {
  if (row?.matchId) {
    const modelVersion = row?.modelVersion || row?.review?.modelVersion || "unknown";
    return `match:${row.matchId}:${modelVersion}`;
  }
  return String(row?.predictionId || `${row?.matchId || "unknown"}:${row?.generatedAt || "latest"}`);
}

function rowQuality(row) {
  return (row?.snapshotBacked ? 100 : 0) + (row?.label ? 10 : 0) + (row?.featureVector ? 5 : 0) + (row?.review ? 1 : 0);
}

function shouldReplace(existing, candidate) {
  const qualityDelta = rowQuality(candidate) - rowQuality(existing);
  if (qualityDelta !== 0) return qualityDelta > 0;
  return Date.parse(candidate?.generatedAt || "") >= Date.parse(existing?.generatedAt || "");
}

const COMPACT_REVIEW_FIELDS = [
  "matchId", "predictionId", "date", "league", "dataSource", "phaseBucket", "homeTeamId", "awayTeamId",
  "homeTeamName", "awayTeamName", "predictedScore", "actualScore", "predictedOutcome", "probabilityOutcome",
  "actualOutcome", "predictedBtts", "actualBtts", "bttsHit", "predictedOver25", "actualOver25", "over25Hit",
  "predictedTotalGoals", "actualTotalGoals", "modelName", "riskProfile", "modelAgreement", "confidence",
  "exactScoreConfidence", "brierScore", "logLoss", "roi", "roiStatus", "clv", "clvStatus", "oddsStatus",
  "sourceTimestampCoverage", "modelVersion", "featureSchemaVersion", "generatedAt", "cutoffAt", "evaluationSource",
  "leakageRisk", "outcomeHit", "probabilityOutcomeHit", "exactHit", "totalGoalError", "totalGoalBias",
  "homeGoalBias", "awayGoalBias", "bestBetRank", "topConfidencePick", "topExactScorePick", "failureSignals", "createdAt",
];

function pickDefined(source, fields) {
  const output = {};
  for (const field of fields) if (source?.[field] !== undefined) output[field] = source[field];
  return output;
}

// Fallback reviews are monitoring evidence, not immutable model samples. Their
// complete payload remains in R2; the repository only needs this compact audit view.
export function compactTrainingSnapshotRow(row) {
  if (!row || row.snapshotBacked) return row;
  const ensemble = row.ensembleMeta || {};
  return {
    ...pickDefined(row, [
      "date", "matchId", "league", "homeTeam", "awayTeam", "status", "score", "label", "predictionId",
      "generatedAt", "cutoffAt", "snapshotBacked", "snapshotStatus",
    ]),
    review: pickDefined(row.review, COMPACT_REVIEW_FIELDS),
    ensembleMeta: pickDefined(ensemble, [
      "active", "baseModel", "blendModel", "agreement", "baseProbabilities", "heuristicProbabilities",
    ]),
  };
}

export function mergeTrainingSnapshots(previous, next) {
  const rows = new Map();
  for (const row of [...(previous?.rows || []), ...(next?.rows || [])]) {
    const key = rowKey(row);
    const existing = rows.get(key);
    if (!existing || shouldReplace(existing, row)) rows.set(key, row);
  }
  const mergedRows = [...rows.values()].map(compactTrainingSnapshotRow).sort((a, b) =>
    String(a?.date || "").localeCompare(String(b?.date || "")) || String(a?.matchId || "").localeCompare(String(b?.matchId || ""))
  );
  return {
    ...(previous || {}),
    ...(next || {}),
    generatedAt: new Date().toISOString(),
    reviewCount: Math.max(Number(previous?.reviewCount || 0), Number(next?.reviewCount || 0)),
    rows: mergedRows,
    preservation: {
      previousRows: previous?.rows?.length || 0,
      generatedRows: next?.rows?.length || 0,
      mergedRows: mergedRows.length,
      snapshotBackedRows: mergedRows.filter((row) => row?.snapshotBacked).length,
    },
  };
}
