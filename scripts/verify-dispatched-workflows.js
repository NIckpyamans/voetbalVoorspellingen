#!/usr/bin/env node

// Controleert na een `gh workflow run` of de gedispatchte workflow echt is
// gaan draaien. Achtergrond: GitHub bewaart per concurrency-groep maar één
// wachtende run. Een volgende dispatch kon daardoor een net gestarte run
// annuleren voordat er één job begon, terwijl de orchestrator groen bleef.
// Deze stap maakt dat zichtbaar en laat de orchestrator falen.

import { execFile } from "child_process";

const WORKFLOW_GRACE_MS = 15000;
const ABORT_WINDOW_MS = 90000;

export function parseWorkflowList(value) {
  return [...new Set(String(value || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

function runCreatedAt(run) {
  return Date.parse(run?.createdAt || "") || NaN;
}

function ageSeconds(run, now) {
  const created = runCreatedAt(run);
  return Number.isFinite(created) ? Math.max(0, (now - created) / 1000) : Infinity;
}

// Beslist of een gevonden child-run gezond is. `run` is de nieuwste run van
// de workflow, `jobCount` het aantal jobs dat GitHub voor die run kent.
export function evaluateDispatchedRun({ workflow, run, jobCount = null, dispatchedAt, now = Date.now() }) {
  const dispatched = Date.parse(dispatchedAt || "") || now;
  if (!run) {
    return { workflow, ok: false, state: "missing", reason: "geen run gevonden na dispatch" };
  }
  const created = runCreatedAt(run);
  if (!Number.isFinite(created) || created < dispatched - WORKFLOW_GRACE_MS) {
    return { workflow, ok: false, state: "missing", reason: "nieuwste run is ouder dan de dispatch" };
  }
  const status = String(run.status || "").toLowerCase();
  const conclusion = String(run.conclusion || "").toLowerCase();
  if (["queued", "in_progress", "waiting", "pending", "requested"].includes(status)) {
    return { workflow, ok: true, state: status, runId: run.databaseId, reason: "run is queued of in_progress" };
  }
  if (status !== "completed") {
    return { workflow, ok: true, state: status || "unknown", runId: run.databaseId, reason: "run is nog niet afgerond" };
  }
  if (conclusion === "success" || conclusion === "skipped" || conclusion === "neutral") {
    return { workflow, ok: true, state: conclusion, runId: run.databaseId, reason: "run geslaagd" };
  }
  const started = jobCount === null || Number(jobCount) > 0;
  if ((conclusion === "cancelled" || conclusion === "cancelled_early") && (!started || ageSeconds(run, now) <= ABORT_WINDOW_MS / 1000)) {
    return {
      workflow,
      ok: false,
      state: conclusion,
      runId: run.databaseId,
      reason: started ? "run binnen 90s geannuleerd" : "run geannuleerd voordat een job startte",
    };
  }
  return {
    workflow,
    ok: false,
    state: conclusion || "failed",
    runId: run.databaseId,
    reason: `run eindigde als ${conclusion || "failed"}`,
  };
}

function ghJson(args) {
  return new Promise((resolve) => {
    execFile("gh", args, { encoding: "utf8" }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        resolve(JSON.parse(stdout || "null"));
      } catch {
        resolve(null);
      }
    });
  });
}

async function latestRun(workflow, branch) {
  const runs = await ghJson([
    "run", "list",
    "--workflow", workflow,
    "--branch", branch,
    "--limit", "10",
    "--json", "databaseId,status,conclusion,createdAt,event",
  ]);
  if (!Array.isArray(runs) || !runs.length) return null;
  return [...runs].sort((left, right) => (runCreatedAt(right) || 0) - (runCreatedAt(left) || 0))[0];
}

async function countJobs(run) {
  if (!run?.databaseId) return 0;
  const detail = await ghJson(["run", "view", String(run.databaseId), "--json", "jobs"]);
  return Array.isArray(detail?.jobs) ? detail.jobs.length : 0;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const workflows = parseWorkflowList(process.env.WORKFLOWS || process.argv.slice(2).join(" "));
  if (!workflows.length) {
    console.log("Geen gedispatchte workflows om te controleren.");
    return;
  }
  const branch = String(process.env.DATA_BRANCH || "codex/step3b-layout");
  const dispatchedAt = process.env.DISPATCH_STARTED_AT || new Date().toISOString();
  const attempts = Math.max(1, Number(process.env.DISPATCH_VERIFY_ATTEMPTS || 12));
  const delayMs = Math.max(1000, Number(process.env.DISPATCH_VERIFY_DELAY_MS || 5000));

  const pending = new Map(workflows.map((workflow) => [workflow, null]));
  for (let attempt = 1; attempt <= attempts && pending.size; attempt += 1) {
    for (const workflow of [...pending.keys()]) {
      const run = await latestRun(workflow, branch);
      if (!run) continue;
      const created = runCreatedAt(run);
      if (!Number.isFinite(created) || created < Date.parse(dispatchedAt) - WORKFLOW_GRACE_MS) continue;
      const jobCount = String(run.status || "").toLowerCase() === "completed" && !["success", "skipped", "neutral"].includes(String(run.conclusion || "").toLowerCase())
        ? await countJobs(run)
        : null;
      const outcome = evaluateDispatchedRun({ workflow, run, jobCount, dispatchedAt });
      // Een run die nog queued staat is gezond; een afgeronde run ook. Alleen
      // bij een mislukking of ontbrekende run blijven we kijken.
      if (outcome.ok) pending.delete(workflow);
      else pending.set(workflow, outcome);
    }
    if (!pending.size) break;
    if (attempt < attempts) await sleep(delayMs);
  }

  const results = [];
  for (const [workflow, outcome] of pending) {
    results.push(outcome || evaluateDispatchedRun({ workflow, run: null, dispatchedAt }));
  }
  const failed = results.filter((row) => !row.ok);
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    dispatchedAt,
    branch,
    checked: workflows,
    failed,
  }, null, 2));
  if (failed.length) {
    for (const row of failed) {
      console.error(`::error::${row.workflow}: ${row.reason}${row.runId ? ` (run ${row.runId})` : ""}`);
    }
    process.exit(1);
  }
}

const isMain = String(process.argv[1] || "").replace(/\\/g, "/").endsWith("scripts/verify-dispatched-workflows.js");
if (isMain) {
  main().catch((error) => {
    console.error(`[dispatch-verify] ${error?.message || error}`);
    process.exit(1);
  });
}
