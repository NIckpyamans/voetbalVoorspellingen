#!/usr/bin/env node

import fs from "node:fs";
import { execFileSync } from "node:child_process";

const warnTrackedBytes = Number(process.env.WARN_TRACKED_BYTES || 75 * 1024 * 1024);
// De bestaande compacte dagexports zitten al boven de oude 75 MB-grens.
// Houd die grens als waarschuwing en reserveer de harde fout voor echte groei
// of een afzonderlijk te groot data-/trainingsbestand.
// De bestaande R2-herstelproef heeft een eenmalige trainingsprojectie toegevoegd.
// Nieuwe evaluatieruns committen deze exports niet meer; bewaak vanaf de huidige
// basis streng op verdere groei zonder bestaande trainingsdata te verwijderen.
const maxTrackedBytes = Number(process.env.MAX_TRACKED_BYTES || 132 * 1024 * 1024);
const maxDataFileBytes = Number(process.env.MAX_DATA_FILE_BYTES || 12 * 1024 * 1024);
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

const warning = trackedBytes > warnTrackedBytes;
console.log(JSON.stringify({ trackedFiles: files.length, trackedBytes, warnTrackedBytes, maxTrackedBytes, warning, oversizedDataFiles }, null, 2));
if (warning) console.warn("[repository-size] waarschuwing: repository boven streefbudget; migreer volgende statische exports naar R2.");
if (trackedBytes > maxTrackedBytes || oversizedDataFiles.length > 0) {
  console.error("[repository-size] budget overschreden; bewaar volledige datasets in Neon/storage.");
  process.exit(1);
}
