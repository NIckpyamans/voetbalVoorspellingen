#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  SNAPSHOT_LEDGER_LOCAL_FILE,
  SNAPSHOT_LEDGER_VERSION,
  loadSnapshotLedger,
  mergeSnapshotLedgers,
} from "../shared/predictionSnapshotLedger.js";
import { mergeTrainingSnapshots } from "./worker/training-snapshot.js";
import { recoverTrainingRows } from "./worker/training-recovery.js";

const ROOT = process.cwd();
const SERVER_DATA_FILE = path.join(ROOT, "server_data.json");
const TRAINING_FILE = path.join(ROOT, "training", "training-snapshot.json");

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function main() {
  const source = readJson(SERVER_DATA_FILE, {});
  const loadedLedger = await loadSnapshotLedger({ root: ROOT });
  const existingLedger = loadedLedger.ledger;
  const ledger = mergeSnapshotLedgers(existingLedger, {
    version: SNAPSHOT_LEDGER_VERSION,
    generatedAt: new Date().toISOString(),
    predictionSnapshots: source.predictionSnapshots || {},
    predictionSnapshotIndex: source.predictionSnapshotIndex || {},
    postMatchReviews: source.postMatchReviews || {},
    evaluations: source.predictionEvaluations || {},
  });

  const ledgerPath = path.resolve(ROOT, SNAPSHOT_LEDGER_LOCAL_FILE);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, gzipSync(Buffer.from(JSON.stringify(ledger), "utf8"), { level: 9 }));

  const previousTraining = readJson(TRAINING_FILE, { rows: [] });
  const recoveredRows = recoverTrainingRows(ledger);
  const training = mergeTrainingSnapshots(previousTraining, {
    generatedAt: new Date().toISOString(),
    reviewCount: Object.keys(ledger.postMatchReviews).length,
    rows: recoveredRows,
    source: "immutable-r2-ledger-recovery",
  });
  fs.mkdirSync(path.dirname(TRAINING_FILE), { recursive: true });
  fs.writeFileSync(TRAINING_FILE, `${JSON.stringify(training, null, 2)}\n`);

  console.log(JSON.stringify({
    ledgerPath,
    snapshots: Object.keys(ledger.predictionSnapshots).length,
    reviews: Object.keys(ledger.postMatchReviews).length,
    recoveredRows: recoveredRows.length,
    recoveredFromReviews: recoveredRows.filter((row) => row.recoverySource === "post_match_review").length,
    recoveredFromEvaluations: recoveredRows.filter((row) => row.recoverySource === "immutable_evaluation").length,
    trainingRows: training.rows.length,
    snapshotBackedRows: training.rows.filter((row) => row.snapshotBacked).length,
    sources: {
      r2Available: !!loadedLedger.sources.r2?.available,
      r2Snapshots: Object.keys(loadedLedger.sources.r2?.ledger?.predictionSnapshots || {}).length,
      localAvailable: !!loadedLedger.sources.local?.available,
      localSnapshots: Object.keys(loadedLedger.sources.local?.ledger?.predictionSnapshots || {}).length,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
