#!/usr/bin/env node
// Neon health watchdog: probeert Neon lichtgewicht, legt de status vast in
// monitor/neon-health.json en geeft herstelsignalen af zodat de workflow na
// een quota-overschrijding automatisch onderhoud kan hervatten. Hierdoor
// "reageert" Neon altijd: storingen worden zichtbaar zodra ze optreden en
// herstel wordt automatisch opgevolgd.
//
//   node scripts/neon-health-watchdog.js --emit-github-output
//
import fs from "node:fs";
import path from "node:path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { classifyNeonError, buildNeonHealthState } from "./worker/neon-health.js";

const ROOT = process.cwd();
const REPORT_FILE = path.join(ROOT, "monitor", "neon-health.json");

function readPrevious() {
  try {
    return JSON.parse(fs.readFileSync(REPORT_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeGithubOutput(state) {
  if (!process.argv.includes("--emit-github-output") || !process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `available=${state.available}\nstate=${state.state}\nrecovered=${state.recovered}\nquotaRecovered=${state.quotaRecovered}\nconsecutiveFailures=${state.consecutiveFailures}\n`
  );
}

async function probe(sql) {
  const startedAt = Date.now();
  try {
    await sql.query("select 1 as ok");
  } catch (error) {
    return { available: false, databaseWritable: false, reason: classifyNeonError(error), error: String(error?.message || error).slice(0, 500), probeMs: Date.now() - startedAt };
  }
  let databaseWritable = false;
  try {
    await sql.query("create temporary table footyai_neon_watchdog_probe (checked_at timestamptz)");
    databaseWritable = true;
  } catch {
    databaseWritable = false;
  }
  return { available: true, databaseWritable, reason: "available", probeMs: Date.now() - startedAt };
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  const previous = readPrevious();

  if (!sql) {
    const state = buildNeonHealthState(previous, { available: false, reason: "database_url_missing" });
    fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    fs.writeFileSync(REPORT_FILE, `${JSON.stringify(state, null, 2)}\n`);
    writeGithubOutput(state);
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  const result = await probe(sql);
  const state = buildNeonHealthState(previous, result);
  state.probeMs = result.probeMs;
  if (result.error) state.error = result.error;

  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(state, null, 2)}\n`);
  writeGithubOutput(state);
  console.log(JSON.stringify(state, null, 2));
  if (state.recovered) {
    console.log(`[neon-health] hersteld na ${state.previousState}; onderhoud kan worden hervat.`);
  }
}

main().catch((error) => {
  console.error(`[neon-health] ${error?.stack || error?.message || error}`);
  process.exit(1);
});
