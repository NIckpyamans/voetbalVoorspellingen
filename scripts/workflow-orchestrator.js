#!/usr/bin/env node

import fs from "fs";
import path from "path";

const emitGithubOutput = process.argv.includes("--emit-github-output");
const mode = String(process.env.ORCHESTRATOR_MODE || "conservative").toLowerCase();
const target = String(process.env.ORCHESTRATOR_TARGET || "").trim();
const branch = String(process.env.DATA_BRANCH || "codex/step3b-layout");
const now = new Date();
const hour = Number(new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  hour12: false,
}).format(now));
const day = Number(new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  day: "2-digit",
}).format(now));

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function plannedWorkflows() {
  if (target && target !== "auto") {
    if (target === "all") {
      return [
        "live-score.yml",
        "worker.yml",
        "free-prematch-odds.yml",
        "data-integrity-maintenance.yml",
        "learn.yml",
        "api-football-coverage-scout.yml",
        "nightly-model-maintenance.yml",
      ];
    }
    return [target.endsWith(".yml") || target.endsWith(".yaml") ? target : `${target}.yml`];
  }

  const workflows = [];
  const activeDaytime = hour >= 7 && hour <= 23;

  if (activeDaytime) workflows.push("live-score.yml");
  if ([10, 14, 18, 21].includes(hour)) workflows.push("pre-kickoff-lineups.yml");
  if ([6, 12, 18].includes(hour)) workflows.push("worker.yml");
  if ([8, 11, 14, 17, 20].includes(hour)) workflows.push("free-prematch-odds.yml");

  if (mode !== "minimal") {
    if (hour === 4) workflows.push("nightly-model-maintenance.yml");
    if (hour === 5) workflows.push("data-integrity-maintenance.yml");
    if (hour === 6) workflows.push("api-football-coverage-scout.yml");
    if (hour === 7) workflows.push("learn.yml");
  }

  if (mode === "full") {
    if (day === 1 || day === 15) workflows.push("prediction-evaluation.yml");
    if (hour === 9) workflows.push("coverage-repairs.yml");
    if (hour === 3) workflows.push("free-source-batches.yml");
  }

  return unique(workflows);
}

const workflows = plannedWorkflows();
const plan = {
  generatedAt: now.toISOString(),
  branch,
  mode,
  target: target || "auto",
  localHourAmsterdam: hour,
  localDayAmsterdam: day,
  workflows,
};

fs.mkdirSync(path.join(process.cwd(), "monitor"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "monitor", "workflow-orchestrator-plan.json"), JSON.stringify(plan, null, 2));
console.log(JSON.stringify(plan, null, 2));

if (emitGithubOutput && process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `workflows=${workflows.join(" ")}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${workflows.length}\n`);
}
