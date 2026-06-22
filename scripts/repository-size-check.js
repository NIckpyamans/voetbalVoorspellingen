#!/usr/bin/env node

import fs from "node:fs";
import { execFileSync } from "node:child_process";

const maxTrackedBytes = Number(process.env.MAX_TRACKED_BYTES || 75 * 1024 * 1024);
const maxDataFileBytes = Number(process.env.MAX_DATA_FILE_BYTES || 8 * 1024 * 1024);
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
let trackedBytes = 0;
const oversizedDataFiles = [];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const bytes = fs.statSync(file).size;
  trackedBytes += bytes;
  if ((file.startsWith("data/") || file.startsWith("training/")) && bytes > maxDataFileBytes) {
    oversizedDataFiles.push({ file, bytes });
  }
}

console.log(JSON.stringify({ trackedFiles: files.length, trackedBytes, maxTrackedBytes, oversizedDataFiles }, null, 2));
if (trackedBytes > maxTrackedBytes || oversizedDataFiles.length > 0) {
  console.error("[repository-size] budget overschreden; bewaar volledige datasets in Neon/storage.");
  process.exit(1);
}
