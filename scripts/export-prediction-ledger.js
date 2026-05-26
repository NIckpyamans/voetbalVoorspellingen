#!/usr/bin/env node

import fs from "fs";
import path from "path";

const DATA_FILE = path.resolve(process.cwd(), "server_data.json");
const OUT_DIR = path.resolve(process.cwd(), "training");
const LEDGER_FILE = path.join(OUT_DIR, "prediction-ledger.jsonl");
const MANIFEST_FILE = path.join(OUT_DIR, "prediction-ledger-manifest.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function compact(value) {
  return value == null ? null : value;
}

function isoFromValue(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  const ms = Number.isFinite(numeric) ? numeric : Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function indexReviewsByPredictionId(reviews) {
  const index = new Map();
  for (const review of Object.values(reviews || {})) {
    if (review?.predictionId) index.set(String(review.predictionId), review);
  }
  return index;
}

function fallbackReviewsWithoutSnapshot(reviews, snapshotPredictionIds) {
  return Object.values(reviews || {}).filter((review) => {
    const predictionId = review?.predictionId ? String(review.predictionId) : "";
    return !predictionId || !snapshotPredictionIds.has(predictionId);
  });
}

function recordFromSnapshot(snapshot, review = null) {
  return {
    ledgerVersion: "prediction-ledger-v1",
    recordType: "snapshot",
    predictionId: snapshot?.predictionId || null,
    matchId: snapshot?.matchId || null,
    generatedAt: snapshot?.generatedAt || null,
    cutoffAt: snapshot?.cutoffAt || null,
    kickoff: snapshot?.kickoff || null,
    date: snapshot?.date || null,
    league: snapshot?.league || null,
    season: snapshot?.season || null,
    homeTeam: snapshot?.homeTeam || null,
    awayTeam: snapshot?.awayTeam || null,
    homeTeamId: snapshot?.homeTeamId || null,
    awayTeamId: snapshot?.awayTeamId || null,
    teamIdentity: compact(snapshot?.teamIdentity),
    schemaVersion: snapshot?.schemaVersion || null,
    modelVersion: snapshot?.modelVersion || null,
    featureSchemaVersion: snapshot?.featureSchemaVersion || null,
    algorithmVersion: snapshot?.algorithmVersion || null,
    inputSnapshotHash: snapshot?.inputSnapshotHash || null,
    inputSnapshot: compact(snapshot?.inputSnapshot),
    features: compact(snapshot?.features),
    probabilities: compact(snapshot?.probabilities),
    confidence: snapshot?.confidence ?? null,
    confidenceRaw: snapshot?.confidenceRaw ?? null,
    calibration: compact(snapshot?.calibration),
    expectedScore: compact(snapshot?.expectedScore),
    explanation: compact(snapshot?.explanation),
    oddsAtPrediction: compact(snapshot?.oddsAtPrediction),
    oddsStatus: snapshot?.oddsStatus || null,
    oddsProviderStatus: snapshot?.oddsProviderStatus || null,
    roiStatus: snapshot?.roiStatus || null,
    clvStatus: snapshot?.clvStatus || null,
    dataCompleteness: compact(snapshot?.dataCompleteness),
    missingData: compact(snapshot?.missingData),
    featureSourceMetadata: compact(snapshot?.featureSourceMetadata),
    leakageGuard: compact(snapshot?.leakageGuard),
    actualResult: review?.actualScore || review?.score || null,
    exactHit: review?.exactHit ?? null,
    outcomeHit: review?.outcomeHit ?? null,
    probabilityOutcomeHit: review?.probabilityOutcomeHit ?? null,
    brierScore: review?.brierScore ?? null,
    logLoss: review?.logLoss ?? null,
    roi: review?.roi ?? null,
    clv: review?.clv ?? null,
    evaluationSource: review?.evaluationSource || null,
    evaluatedAt: isoFromValue(review?.createdAt) || isoFromValue(review?.evaluatedAt),
  };
}

function recordFromFallbackReview(review) {
  return {
    ledgerVersion: "prediction-ledger-v1",
    recordType: "fallback_review",
    predictionId: review?.predictionId || null,
    matchId: review?.matchId || null,
    generatedAt: review?.generatedAt || null,
    cutoffAt: review?.cutoffAt || null,
    kickoff: review?.kickoff || null,
    date: review?.date || null,
    league: review?.league || null,
    homeTeam: review?.homeTeam || null,
    awayTeam: review?.awayTeam || null,
    modelVersion: review?.modelVersion || null,
    probabilities: compact(review?.probabilities),
    confidence: review?.confidence ?? null,
    oddsAtPrediction: compact(review?.oddsAtPrediction || review?.odds),
    oddsStatus: review?.oddsStatus || null,
    roiStatus: review?.roiStatus || null,
    clvStatus: review?.clvStatus || null,
    featureSourceMetadata: compact(review?.featureSourceMetadata),
    leakageGuard: compact(review?.leakageGuard),
    actualResult: review?.actualScore || review?.score || null,
    exactHit: review?.exactHit ?? null,
    outcomeHit: review?.outcomeHit ?? null,
    probabilityOutcomeHit: review?.probabilityOutcomeHit ?? null,
    brierScore: review?.brierScore ?? null,
    logLoss: review?.logLoss ?? null,
    roi: review?.roi ?? null,
    clv: review?.clv ?? null,
    evaluationSource: review?.evaluationSource || "current_prediction_fallback",
    evaluatedAt: isoFromValue(review?.createdAt) || isoFromValue(review?.evaluatedAt),
  };
}

function main() {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`Missing ${DATA_FILE}`);
  }
  const data = readJson(DATA_FILE);
  const snapshots = Object.values(data.predictionSnapshots || {}).filter((snapshot) => snapshot?.predictionId);
  const reviewsByPredictionId = indexReviewsByPredictionId(data.postMatchReviews || {});
  const snapshotPredictionIds = new Set(snapshots.map((snapshot) => String(snapshot.predictionId)));
  const records = [
    ...snapshots.map((snapshot) => recordFromSnapshot(snapshot, reviewsByPredictionId.get(String(snapshot.predictionId)) || null)),
    ...fallbackReviewsWithoutSnapshot(data.postMatchReviews || {}, snapshotPredictionIds).map(recordFromFallbackReview),
  ];

  records.sort((a, b) => String(a.generatedAt || a.date || "").localeCompare(String(b.generatedAt || b.date || "")));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(LEDGER_FILE, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);

  const manifest = {
    generatedAt: new Date().toISOString(),
    ledgerVersion: "prediction-ledger-v1",
    output: path.relative(process.cwd(), LEDGER_FILE),
    records: records.length,
    snapshots: snapshots.length,
    fallbackReviews: records.filter((record) => record.recordType === "fallback_review").length,
    snapshotReviewsLinked: records.filter((record) => record.recordType === "snapshot" && record.evaluationSource).length,
    modelVersions: [...new Set(records.map((record) => record.modelVersion).filter(Boolean))].sort(),
    note: "JSONL export is append/import friendly; use prediction_id + input_snapshot_hash as immutable identity.",
  };
  fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

main();
