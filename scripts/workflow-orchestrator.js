#!/usr/bin/env node

import fs from "fs";
import path from "path";

const emitGithubOutput = process.argv.includes("--emit-github-output");
const mode = String(process.env.ORCHESTRATOR_MODE || "conservative").toLowerCase();
const target = String(process.env.ORCHESTRATOR_TARGET || "").trim();
const branch = String(process.env.DATA_BRANCH || "codex/step3b-layout");
const now = new Date(process.env.ORCHESTRATOR_NOW || Date.now());
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

function readUpcomingFixtures(reference = now) {
  const fixtures = [];
  for (let offset = 0; offset <= 1; offset += 1) {
    const date = new Date(reference);
    date.setUTCDate(date.getUTCDate() + offset);
    const dateKey = date.toISOString().slice(0, 10);
    const filePath = path.join(process.cwd(), "data", "days", `${dateKey}.json`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      for (const match of Array.isArray(payload?.matches) ? payload.matches : []) {
        const kickoffAt = Date.parse(match?.kickoff || "");
        const home = String(match?.homeTeamName || "").trim();
        const away = String(match?.awayTeamName || "").trim();
        if (!Number.isFinite(kickoffAt) || !home || !away || /\b(tbd|unknown|null)\b/i.test(`${home} ${away}`)) continue;
        const minutesToKickoff = Math.round((kickoffAt - reference.getTime()) / 60000);
        if (minutesToKickoff < -180 || minutesToKickoff > 36 * 60) continue;
        fixtures.push({
          matchId: String(match.id || match.sofaId || ""),
          kickoff: new Date(kickoffAt).toISOString(),
          minutesToKickoff,
          league: match.league || null,
          homeTeam: home,
          awayTeam: away,
        });
      }
    } catch (error) {
      console.warn(`[orchestrator] Kon ${filePath} niet lezen: ${error?.message || error}`);
    }
  }
  return fixtures.sort((left, right) => left.minutesToKickoff - right.minutesToKickoff);
}

const upcomingFixtures = readUpcomingFixtures();
const lineupWindows = {
  t75: upcomingFixtures.filter((fixture) => fixture.minutesToKickoff >= 61 && fixture.minutesToKickoff <= 90),
  t45: upcomingFixtures.filter((fixture) => fixture.minutesToKickoff >= 31 && fixture.minutesToKickoff <= 60),
  t20: upcomingFixtures.filter((fixture) => fixture.minutesToKickoff >= 5 && fixture.minutesToKickoff <= 30),
};
const lineupWindow = unique(Object.values(lineupWindows).flat().map((fixture) => fixture.matchId))
  .map((matchId) => upcomingFixtures.find((fixture) => fixture.matchId === matchId));
const closingOddsWindow = upcomingFixtures.filter((fixture) => fixture.minutesToKickoff >= 5 && fixture.minutesToKickoff <= 30);
const activeMatchWindow = upcomingFixtures.filter((fixture) => fixture.minutesToKickoff >= -180 && fixture.minutesToKickoff <= 180);

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

  if (activeDaytime || activeMatchWindow.length) workflows.push("live-score.yml");
  if (lineupWindow.length || [10, 14, 18, 21].includes(hour)) workflows.push("pre-kickoff-lineups.yml");
  if ([6, 12, 18].includes(hour)) workflows.push("worker.yml");
  if (closingOddsWindow.length || [8, 11, 14, 17, 20].includes(hour)) workflows.push("free-prematch-odds.yml");

  if (mode !== "minimal") {
    if (hour === 4) workflows.push("nightly-model-maintenance.yml");
    if (hour === 5) workflows.push("data-integrity-maintenance.yml");
    if (hour === 6) workflows.push("api-football-coverage-scout.yml");
    if (hour === 7) workflows.push("learn.yml");
    if (hour === 8) workflows.push("odds-snapshot-scout.yml");
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
  fixtureSignals: {
    upcoming: upcomingFixtures.length,
    nearestKickoff: upcomingFixtures[0] || null,
    lineupWindow: lineupWindow.length,
    lineupWindows: Object.fromEntries(Object.entries(lineupWindows).map(([key, rows]) => [key, rows.length])),
    closingOddsWindow: closingOddsWindow.length,
    activeMatchWindow: activeMatchWindow.length,
  },
  workflows,
};

fs.mkdirSync(path.join(process.cwd(), "monitor"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "monitor", "workflow-orchestrator-plan.json"), JSON.stringify(plan, null, 2));
console.log(JSON.stringify(plan, null, 2));

if (emitGithubOutput && process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `workflows=${workflows.join(" ")}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${workflows.length}\n`);
}
