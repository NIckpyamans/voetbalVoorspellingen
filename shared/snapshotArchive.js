// Hulpjes voor het archiveren van prediction_snapshots naar R2. De vorige
// implementatie haalde tot 15.000 volledige rijen (inclusief payload,
// input_snapshot en features) in één query op. Neon antwoordde daardoor met
// HTTP 507 (respons groter dan 64 MB) en stopte de hele onderhoudsrun.
// We werken nu met keyset-paginering en kleine batches, zodat elke respons
// ruim onder de limiet blijft.

export const DEFAULT_SNAPSHOT_ARCHIVE_BATCH = 400;
export const MAX_SNAPSHOT_ARCHIVE_BATCH = 2000;
export const SNAPSHOT_ARCHIVE_EPOCH = "1970-01-01T00:00:00.000Z";

export function resolveSnapshotArchiveBatchSize(value, fallback = DEFAULT_SNAPSHOT_ARCHIVE_BATCH) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_SNAPSHOT_ARCHIVE_BATCH);
}

export function emptySnapshotArchiveCursor() {
  return { generatedAt: SNAPSHOT_ARCHIVE_EPOCH, predictionId: "" };
}

function toIso(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value || "");
}

// De cursor is de laatste rij van de batch: de query gaat strikt verder na
// (generated_at, prediction_id) en slaat zo niets over of dubbel op.
export function nextSnapshotArchiveCursor(rows) {
  const last = Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
  if (!last) return null;
  const generatedAt = toIso(last.generated_at);
  const predictionId = last.prediction_id === null || last.prediction_id === undefined
    ? ""
    : String(last.prediction_id);
  if (!generatedAt || !predictionId) return null;
  return { generatedAt, predictionId };
}

export function toSnapshotArchiveRecord(row) {
  return {
    predictionId: row.prediction_id,
    matchId: row.match_id,
    generatedAt: row.generated_at,
    cutoffAt: row.cutoff_at,
    modelVersion: row.model_version,
    featureSchemaVersion: row.feature_schema_version,
    algorithmVersion: row.algorithm_version,
    inputSnapshotHash: row.input_snapshot_hash,
    inputSnapshot: row.input_snapshot,
    features: row.features,
    probabilities: row.probabilities,
    confidence: row.confidence,
    confidenceRaw: row.confidence_raw,
    calibration: row.calibration,
    expectedScore: row.expected_score,
    explanation: row.explanation,
    dataCompleteness: row.data_completeness,
    featureSourceMetadata: row.feature_source_metadata,
    leakageGuard: row.leakage_guard,
    predictionPayload: row.prediction_payload,
  };
}

export function buildSnapshotArchivePayload(rows, options = {}) {
  return {
    generatedAt: options.generatedAt || new Date().toISOString(),
    source: "neon.prediction_snapshots",
    batch: Number(options.batch || 1),
    keepPerMatch: options.keepPerMatch,
    recentDaysProtected: options.recentDaysProtected,
    recordCount: rows.length,
    records: rows.map(toSnapshotArchiveRecord),
  };
}
