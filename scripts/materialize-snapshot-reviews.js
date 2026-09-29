#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { loadSnapshotLedger } from "../shared/predictionSnapshotLedger.js";
import { materializeSnapshotBackedReviews, rebindFallbackReviewsToSnapshots } from "./worker/snapshot-review-materialization.js";

const ROOT = process.cwd();
const DAYS_DIR = path.join(ROOT, "data", "days");
const HISTORY_FILE = path.join(ROOT, "data", "history-summary.json");
const REPORT_FILE = path.join(ROOT, "monitor", "snapshot-review-linking.json");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
}

async function main() {
  const loaded = await loadSnapshotLedger({ root: ROOT });
  const ledgerReviews = loaded.ledger?.postMatchReviews || {};
  const ledgerSnapshots = loaded.ledger?.predictionSnapshots || {};
  let linked = 0;
  let unchanged = 0;
  let rebound = 0;
  let kept = 0;
  let reviewed = 0;
  let snapshotBacked = 0;
  const changedDays = [];

  if (fs.existsSync(DAYS_DIR)) {
    for (const fileName of fs.readdirSync(DAYS_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))) {
      const filePath = path.join(DAYS_DIR, fileName);
      const current = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const result = materializeSnapshotBackedReviews(current, ledgerReviews);
      linked += result.linked;
      unchanged += result.unchanged;
      // Fallback-reviews alsnog aan immutable pre-kickoff snapshots binden;
      // de reviewmetrics worden daarbij vanuit de snapshot-kansen herberekend.
      const rebind = rebindFallbackReviewsToSnapshots(result.day, ledgerSnapshots);
      rebound += rebind.rebound;
      kept += rebind.kept;
      const reviews = Object.values(rebind.day.reviews || {});
      reviewed += reviews.length;
      snapshotBacked += reviews.filter((review) => review?.evaluationSource === "prediction_snapshot").length;
      if (result.linked > 0 || rebind.rebound > 0) {
        writeJson(filePath, rebind.day);
        changedDays.push(fileName.slice(0, 10));
      }
    }
  }

  if (fs.existsSync(HISTORY_FILE)) {
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    history.postMatchReviews = { ...(history.postMatchReviews || {}), ...ledgerReviews };
    writeJson(HISTORY_FILE, history);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    status: Object.keys(ledgerReviews).length ? "completed" : "failed_no_ledger_reviews",
    sources: {
      r2Available: !!loaded.sources.r2?.available,
      localAvailable: !!loaded.sources.local?.available,
      ledgerReviews: Object.keys(ledgerReviews).length,
    },
    linkedThisRun: linked,
    alreadyLinked: unchanged,
    reboundFromFallback: rebound,
    fallbackWithoutSnapshot: kept,
    ledgerSnapshots: Object.keys(ledgerSnapshots).length,
    changedDays,
    dayReviews: reviewed,
    snapshotBackedDayReviews: snapshotBacked,
    snapshotBackedDayReviewCoverage: reviewed ? snapshotBacked / reviewed : 0,
  };
  writeJson(REPORT_FILE, report);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "completed") process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
