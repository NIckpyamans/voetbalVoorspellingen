import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pruneStaticDayFiles, retainedStaticDateKeys, writeSplitDataFiles } from "./worker/archive.js";

const nowMs = Date.parse("2026-06-22T12:00:00Z");
const retained = retainedStaticDateKeys(
  ["2026-04-01", "2026-05-20", "2026-06-22", "2026-10-01", "invalid"],
  { nowMs, pastDays: 45, futureDays: 120 }
);
assert.deepEqual(retained, ["2026-05-20", "2026-06-22", "2026-10-01"]);

const daysDir = fs.mkdtempSync(path.join(os.tmpdir(), "footypredict-retention-"));
try {
  for (const fileName of ["2026-04-01.json", "2026-06-22.json", "README.txt"]) {
    fs.writeFileSync(path.join(daysDir, fileName), "{}");
  }
  assert.equal(pruneStaticDayFiles(daysDir, ["2026-06-22"]), 1);
  assert.deepEqual(fs.readdirSync(daysDir).sort(), ["2026-06-22.json", "README.txt"]);
} finally {
  fs.rmSync(daysDir, { recursive: true, force: true });
}

// Een lichte refresh mag geen dagbestanden herschrijven, maar moet wel buiten
// het retentievenster opruimen; anders groeit data/days onbeperkt door.
const lightweightDir = fs.mkdtempSync(path.join(os.tmpdir(), "footypredict-lightweight-"));
try {
  const lightweightDays = path.join(lightweightDir, "days");
  fs.mkdirSync(lightweightDays, { recursive: true });
  const existing = {
    "2026-06-22": JSON.stringify({ date: "2026-06-22", matches: [{ id: "keep-in-window" }] }),
    "2026-06-10": JSON.stringify({ date: "2026-06-10", matches: [{ id: "keep-recent" }] }),
    "2026-01-05": JSON.stringify({ date: "2026-01-05", matches: [{ id: "drop-stale" }] }),
    "2027-06-01": JSON.stringify({ date: "2027-06-01", matches: [{ id: "drop-far-future" }] }),
  };
  for (const [dateKey, body] of Object.entries(existing)) {
    fs.writeFileSync(path.join(lightweightDays, `${dateKey}.json`), body);
  }

  const result = writeSplitDataFiles(
    { matches: { "2026-06-22": [{ id: "fresh" }] }, predictions: {}, lastRun: nowMs, workerVersion: "test" },
    {
      splitDataDir: lightweightDir,
      preserveExistingDayFiles: true,
      retention: { nowMs, pastDays: 45, futureDays: 120 },
    },
  );

  assert.equal(result.prunedDayFiles, 2);
  assert.deepEqual(fs.readdirSync(lightweightDays).sort(), ["2026-06-10.json", "2026-06-22.json"]);
  // Bestaande bestanden binnen het venster blijven ongemoeid: de lichte refresh
  // herschrijft ze niet, maar het verse gegeven staat er wel in.
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(lightweightDays, "2026-06-22.json"), "utf8")).matches[0].id,
    "fresh",
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(lightweightDays, "2026-06-10.json"), "utf8")).matches[0].id,
    "keep-recent",
  );
} finally {
  fs.rmSync(lightweightDir, { recursive: true, force: true });
}

console.log("[archive-retention] assertions passed");
