#!/usr/bin/env node
// Maandelijkse Neon cold-storage onderhoudsronde: archiveert oude
// prediction-snapshots en source-payloads naar Cloudflare R2 en compact de
// achtergebleven rijen. Draait standaard alleen op de eerste van de maand
// (NEON_COLD_STORAGE_DAY wijzigt dat), zodat de 5 GB free-datatrager niet
// halverwege de maand opraakt. Handmatig forceren kan met --force.
//
//   node scripts/neon-cold-storage-maintenance.js            # alleen dag 1
//   node scripts/neon-cold-storage-maintenance.js --force
//
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const REPORT_FILE = path.join(ROOT, "monitor", "neon-cold-storage.json");
const FORCE = process.argv.includes("--force") || String(process.env.NEON_COLD_STORAGE_FORCE || "").toLowerCase() === "true";
const RUN_DAY = Math.max(1, Math.min(28, Number(process.env.NEON_COLD_STORAGE_DAY || 1)));

const STEPS = [
  { name: "archive-prediction-snapshots-to-r2", script: "scripts/archive-prediction-snapshots-to-r2.js" },
  { name: "archive-source-record-payloads-to-r2", script: "scripts/archive-source-record-payloads-to-r2.js" },
  { name: "compact-prediction-snapshots", script: "scripts/compact-prediction-snapshots.js" },
  { name: "compact-source-record-payloads", script: "scripts/compact-source-record-payloads.js" },
];

function dayOfMonth() {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", day: "2-digit" }).format(new Date()));
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const due = FORCE || dayOfMonth() === RUN_DAY;
  const report = { generatedAt: new Date().toISOString(), due, forced: FORCE, runDay: RUN_DAY, steps: [], ok: true };
  if (!due) {
    report.status = "skipped_not_monthly_run_day";
    writeReport(report);
    return;
  }
  for (const step of STEPS) {
    const result = spawnSync(process.execPath, [step.script, "--apply"], {
      cwd: ROOT,
      encoding: "utf8",
      env: process.env,
      timeout: 10 * 60 * 1000,
    });
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim().slice(-1500);
    const stepReport = { name: step.name, exitCode: result.status ?? -1, outputTail: output };
    report.steps.push(stepReport);
    if (result.error || result.status !== 0) {
      report.ok = false;
      report.status = report.status || `step_failed:${step.name}`;
      report.steps.at(-1).spawnError = result.error?.message || null;
      console.log(`[neon-cold-storage] ${step.name}: mislukt; verdere onderhoudsstappen worden gestopt zodat er niets ongearchiveerd wordt verwijderd.`);
      break;
    }
    console.log(`[neon-cold-storage] ${step.name}: exit=${result.status}`);
  }
  report.status = report.status || "completed";
  writeReport(report);
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.error(`[neon-cold-storage] ${error?.stack || error?.message || error}`);
  process.exit(1);
});
