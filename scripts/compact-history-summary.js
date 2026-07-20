#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { compactHistorySummary } from "./worker/archive.js";

const file = path.join(process.cwd(), "data", "history-summary.json");
const beforeBytes = fs.statSync(file).size;
const history = JSON.parse(fs.readFileSync(file, "utf8"));
const compacted = compactHistorySummary(history);
fs.writeFileSync(file, `${JSON.stringify(compacted, null, 2)}\n`);
const afterBytes = fs.statSync(file).size;

console.log(JSON.stringify({
  file,
  reviews: Object.keys(compacted.postMatchReviews || {}).length,
  snapshots: Object.keys(compacted.predictionSnapshots || {}).length,
  beforeBytes,
  afterBytes,
  savedBytes: beforeBytes - afterBytes,
}, null, 2));
