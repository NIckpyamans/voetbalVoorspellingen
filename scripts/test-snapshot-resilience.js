#!/usr/bin/env node

import assert from "node:assert/strict";
import { mergeSnapshotLedgers } from "../shared/predictionSnapshotLedger.js";
import { evaluateImmutableSnapshot } from "./worker/snapshot-evaluation.js";
import { compactTrainingSnapshotRow, mergeTrainingSnapshots } from "./worker/training-snapshot.js";

const original = {
  predictionId: "p1",
  matchId: "m1",
  generatedAt: "2026-07-15T12:00:00.000Z",
  cutoffAt: "2026-07-15T12:00:00.000Z",
  kickoff: "2026-07-15T14:00:00.000Z",
  probabilities: { home: 0.6, draw: 0.25, away: 0.15 },
  expectedScore: "2-1",
  features: { ppg_diff: 0.4 },
};
const overwritten = { ...original, expectedScore: "0-0", generatedAt: "2026-07-15T13:00:00.000Z" };
const ledger = mergeSnapshotLedgers({ predictionSnapshots: { p1: original } }, { predictionSnapshots: { p1: overwritten } });
assert.equal(ledger.predictionSnapshots.p1.expectedScore, "2-1", "immutable snapshot must not be overwritten");

const evaluation = evaluateImmutableSnapshot(original, { actualScore: "2-1", actualOutcome: "H" });
assert.equal(evaluation.exactHit, true);
assert.equal(evaluation.outcomeHit, true);

const mergedTraining = mergeTrainingSnapshots(
  { rows: [{ predictionId: "p1", snapshotBacked: true, featureVector: { ppg_diff: 0.4 }, label: "H" }] },
  { rows: [] }
);
assert.equal(mergedTraining.rows.length, 1, "a smaller fallback may not erase training rows");
assert.equal(mergedTraining.preservation.snapshotBackedRows, 1);

const compactFallback = compactTrainingSnapshotRow({
  matchId: "fallback-1",
  snapshotBacked: false,
  label: "H",
  featureVector: { shouldNot: "be stored" },
  dbFeatureContext: { shouldNot: "be stored" },
  review: { predictedOutcome: "H", confidence: 0.5, featureImportance: [{ huge: true }] },
  ensembleMeta: { agreement: 0.2, monteCarloProbabilities: { simulations: 10000 } },
});
assert.equal(compactFallback.featureVector, undefined, "fallback feature vectors belong in R2, not the repository");
assert.equal(compactFallback.dbFeatureContext, undefined);
assert.deepEqual(compactFallback.review, { predictedOutcome: "H", confidence: 0.5 });
assert.deepEqual(compactFallback.ensembleMeta, { agreement: 0.2 });

console.log("[snapshot-resilience] immutable ledger, evaluation and non-shrinking training: PASS");
