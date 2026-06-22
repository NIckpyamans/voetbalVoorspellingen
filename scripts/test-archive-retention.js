import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pruneStaticDayFiles, retainedStaticDateKeys } from "./worker/archive.js";

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

console.log("[archive-retention] assertions passed");
