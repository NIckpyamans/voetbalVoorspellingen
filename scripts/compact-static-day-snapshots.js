#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { compactStaticPredictionSnapshot, selectStaticSnapshotIds, writeJsonFile } from "./worker/archive.js";

const ROOT = process.cwd();
const DAYS_DIR = path.join(ROOT, "data", "days");
const APPLY = process.argv.includes("--apply");
const MAX_PER_MATCH = Math.max(1, Number(process.env.STATIC_SNAPSHOTS_PER_MATCH || 2));
const MIN_FILE_BYTES = Math.max(0, Number(process.env.STATIC_SNAPSHOT_COMPACT_MIN_BYTES || 4 * 1024 * 1024));
const report = { apply: APPLY, maxPerMatch: MAX_PER_MATCH, minimumFileBytes: MIN_FILE_BYTES, checked: 0, changed: 0, removed: 0, files: [] };

for (const fileName of fs.existsSync(DAYS_DIR) ? fs.readdirSync(DAYS_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)) : []) {
  const filePath = path.join(DAYS_DIR, fileName);
  const beforeBytes = fs.statSync(filePath).size;
  if (beforeBytes < MIN_FILE_BYTES) continue;
  report.checked += 1;
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const snapshots = payload?.predictionSnapshots || {};
  const byMatch = new Map();
  for (const [predictionId, snapshot] of Object.entries(snapshots)) {
    const matchId = String(snapshot?.matchId || "").trim();
    if (!matchId) continue;
    if (!byMatch.has(matchId)) byMatch.set(matchId, []);
    byMatch.get(matchId).push(predictionId);
  }
  const retained = {};
  for (const ids of byMatch.values()) {
    for (const predictionId of selectStaticSnapshotIds(ids, snapshots, MAX_PER_MATCH)) {
      retained[predictionId] = compactStaticPredictionSnapshot(snapshots[predictionId]);
    }
  }
  const removed = Object.keys(snapshots).length - Object.keys(retained).length;
  const compacted = { ...payload, predictionSnapshots: retained };
  const afterBytes = Buffer.byteLength(JSON.stringify(compacted));
  if (removed <= 0 && afterBytes >= beforeBytes) continue;
  report.changed += 1;
  report.removed += removed;
  report.files.push({ file: `data/days/${fileName}`, beforeBytes, afterBytes, removed });
  if (APPLY) writeJsonFile(filePath, compacted);
}

console.log(JSON.stringify(report, null, 2));
