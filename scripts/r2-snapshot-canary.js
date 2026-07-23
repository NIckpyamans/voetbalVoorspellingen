#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { runSnapshotCanary } from "./worker/r2-snapshot-canary.js";

const REPORT_FILE = path.join(process.cwd(), "monitor", "r2-snapshot-canary.json");

async function main() {
  const report = { generatedAt: new Date().toISOString(), ...(await runSnapshotCanary()) };
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
