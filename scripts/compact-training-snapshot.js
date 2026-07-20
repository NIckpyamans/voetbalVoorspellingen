#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { mergeTrainingSnapshots } from "./worker/training-snapshot.js";

const file = path.join(process.cwd(), "training", "training-snapshot.json");
const beforeBytes = fs.statSync(file).size;
const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
const compacted = mergeTrainingSnapshots({ rows: [] }, snapshot);
fs.writeFileSync(file, `${JSON.stringify(compacted, null, 2)}\n`);
const afterBytes = fs.statSync(file).size;

console.log(JSON.stringify({
  file,
  rows: compacted.rows.length,
  snapshotBackedRows: compacted.preservation.snapshotBackedRows,
  beforeBytes,
  afterBytes,
  savedBytes: beforeBytes - afterBytes,
}, null, 2));
