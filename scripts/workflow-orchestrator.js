#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { buildProviderCooldown } from "./worker/provider-quota.js";
import { buildProviderAcceptanceState, buildTrainingAutomationState } from "./worker/orchestration-policy.js";

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
const minute = Number(new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  minute: "2-digit",
}).format(now));
const day = Number(new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  day: "2-digit",
}).format(now));

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), relativePath), "utf8"));
  } catch {
    return null;
  }
}

function reportAgeHours(report) {
  const generatedAt = Date.parse(report?.generatedAt || "");
  return Number.isFinite(generatedAt) ? Math.max(0, (now.getTime() - generatedAt) / 3600000) : Infinity;
}

function needsRefresh(report, maxAgeHours, hasGap = () => true) {
  return reportAgeHours(report) >= maxAgeHours || hasGap(report);
}

function readUpcomingFixtures(reference = now) {
  const fixtures = [];
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(reference);
    date.setUTCDate(date.getUTCDate() + offset);
    const dateKey = date.toISOString().slice(0, 10);
    const filePath = path.join(process.cwd(), "data", "days", `${dateKey}.json`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const snapshots = Object.values(payload?.predictionSnapshots || {});
      for (const match of Array.isArray(payload?.matches) ? payload.matches : []) {
        const kickoffAt = Date.parse(match?.kickoff || "");
        const home = String(match?.homeTeamName || "").trim();
        const away = String(match?.awayTeamName || "").trim();
        if (!Number.isFinite(kickoffAt) || !home || !away || /\b(tbd|unknown|null)\b/i.test(`${home} ${away}`)) continue;
        const minutesToKickoff = Math.round((kickoffAt - reference.getTime()) / 60000);
        if (minutesToKickoff < -180 || minutesToKickoff > 7 * 24 * 60) continue;
        const league = String(match.league || "");
        const friendly = /friendl|oefen/i.test(league);
        fixtures.push({
          matchId: String(match.id || match.sofaId || ""),
          kickoff: new Date(kickoffAt).toISOString(),
          minutesToKickoff,
          league: match.league || null,
          friendly,
          homeTeam: home,
          awayTeam: away,
          hasPreMatchSnapshot: snapshots.some((snapshot) =>
            String(snapshot?.matchId || "") === String(match.id || match.sofaId || "") &&
            Number.isFinite(Date.parse(snapshot?.generatedAt || snapshot?.cutoffAt || "")) &&
            Date.parse(snapshot?.generatedAt || snapshot?.cutoffAt || "") < kickoffAt
          ),
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
const prematchOddsWindow = upcomingFixtures.filter((fixture) => fixture.minutesToKickoff >= 31 && fixture.minutesToKickoff <= 360);
const openingOddsWindow = upcomingFixtures.filter((fixture) => fixture.minutesToKickoff > 360 && fixture.minutesToKickoff <= 36 * 60);
// Reguliere competitiewedstrijden krijgen maximaal een week vooraf een
// immutable snapshot. Friendlies blijven bewust in het compacte 36-uursvenster
// omdat selecties en speeldata daar vaker wijzigen.
const missingSnapshotWindow = upcomingFixtures.filter((fixture) => {
  const horizon = fixture.friendly ? 36 * 60 : 7 * 24 * 60;
  return fixture.minutesToKickoff > 30 && fixture.minutesToKickoff <= horizon && !fixture.hasPreMatchSnapshot;
});
const missingRegularSnapshotWindow = missingSnapshotWindow.filter((fixture) => !fixture.friendly);
const activeMatchWindow = upcomingFixtures.filter((fixture) => fixture.minutesToKickoff >= -180 && fixture.minutesToKickoff <= 180);
const primarySlot = minute < 30;
const reports = {
  h2h: readJson("monitor/h2h-upcoming-backfill.json"),
  form: readJson("monitor/upcoming-team-form-enrichment.json"),
  squads: readJson("monitor/upcoming-team-squad-enrichment.json"),
  lineups: readJson("monitor/lineup-availability-monitor.json"),
  odds: readJson("monitor/odds-coverage-scout.json"),
  sportmonks: readJson("monitor/sportmonks-fixture-mapping.json"),
  apiFootballAcceptance: readJson("monitor/api-football-provider-acceptance.json"),
  apiFootballCoverage: readJson("monitor/api-football-coverage-scout.json"),
  evaluation: readJson("monitor/prediction-evaluation-report.json"),
  snapshotGrowth: readJson("monitor/snapshot-growth-monitor.json"),
};
const trainingAutomation = buildTrainingAutomationState(readJson("training/catboost-ready.json"), {
  calibrationMin: 50,
  promotionMin: 150,
});
const apiFootballAcceptance = buildProviderAcceptanceState(reports.apiFootballAcceptance, { now, retryHours: 24 });
const providerQuota = {
  apiFootballH2h: buildProviderCooldown(reports.h2h, { now, cooldownHours: 12 }),
};

const dataNeeds = {
  calendar: upcomingFixtures.length === 0,
  form: needsRefresh(reports.form, 8, (report) => Number(report?.enriched || 0) < Number(report?.checked || 0)),
  h2h: !providerQuota.apiFootballH2h.active && needsRefresh(
    reports.h2h,
    12,
    (report) => Number(report?.filled || 0) < Number(report?.checked || 0)
  ),
  squads: needsRefresh(reports.squads, 12, (report) => Number(report?.enriched || 0) < Number(report?.checked || 0)),
  lineups: needsRefresh(reports.lineups, 6, (report) => Number(report?.confirmedLineupCoverage || 0) < 0.45),
  odds: needsRefresh(reports.odds, 6, (report) => Number(report?.coverage || 0) < 0.6),
  sportmonks: needsRefresh(reports.sportmonks, 12, (report) => Number(report?.mappedFixtures || 0) < 1),
  evaluation: needsRefresh(reports.evaluation, 24),
  learning: needsRefresh(reports.snapshotGrowth, 24, () => trainingAutomation.calibrationGap > 0),
  apiFootballAcceptance: apiFootballAcceptance.checkDue,
  apiFootballMapping: apiFootballAcceptance.accepted && needsRefresh(reports.apiFootballCoverage, 24),
};

function plannedWorkflows() {
  if (target && target !== "auto") {
    if (target === "all") {
      return [
        "live-score.yml",
        "worker.yml",
        "week-ahead-fixtures.yml",
        "form-enrichment.yml",
        "h2h-enrichment.yml",
        "team-squad-enrichment.yml",
        "sportmonks-fixture-mapping.yml",
        "free-prematch-odds.yml",
        "data-integrity-maintenance.yml",
        "learn.yml",
        "api-football-acceptance.yml",
        "api-football-coverage-scout.yml",
        "nightly-model-maintenance.yml",
      ];
    }
    return [target.endsWith(".yml") || target.endsWith(".yaml") ? target : `${target}.yml`];
  }

  const workflows = [];
  const activeDaytime = hour >= 7 && hour <= 23;

  if (activeDaytime || activeMatchWindow.length) workflows.push("live-score.yml");
  // Capturevensters zijn leidend. Een verouderd algemeen dekkingsrapport mag
  // een eenmalige T-75/T-45/T-20- of closing-capture nooit blokkeren.
  if (lineupWindow.length) workflows.push("pre-kickoff-lineups.yml");
  if (
    closingOddsWindow.length ||
    (primarySlot && prematchOddsWindow.length) ||
    (primarySlot && hour % 3 === 2 && openingOddsWindow.length)
  ) workflows.push("free-prematch-odds.yml");

  // Iedere wedstrijd krijgt prospectief minimaal een immutable pre-match
  // snapshot. Dit voorkomt dat later alleen een current-prediction fallback
  // beschikbaar is voor de evaluatie.
  if (primarySlot && missingSnapshotWindow.length) workflows.push("worker.yml");

  if (primarySlot) {
    if (dataNeeds.calendar || hour % 4 === 0) workflows.push("week-ahead-fixtures.yml");
    if (dataNeeds.form && hour % 4 === 0) workflows.push("form-enrichment.yml");
    if (dataNeeds.h2h && hour % 6 === 0) workflows.push("h2h-enrichment.yml");
    if (dataNeeds.squads && hour % 6 === 2) workflows.push("team-squad-enrichment.yml");
    if (dataNeeds.sportmonks && hour % 6 === 3) workflows.push("sportmonks-fixture-mapping.yml");
    if (hour === 2) workflows.push("dashboard-cache-r2.yml", "friendly-discovery.yml");
    if (hour === 3 && dataNeeds.evaluation) workflows.push("prediction-evaluation.yml");
    if (hour === 4 && dataNeeds.learning) workflows.push("learn.yml");
    if (hour === 5) workflows.push("odds-snapshot-scout.yml");
    if (hour === 6 && dataNeeds.apiFootballAcceptance) workflows.push("api-football-acceptance.yml");
    if (hour % 6 === 0 && dataNeeds.apiFootballMapping) workflows.push("api-football-coverage-scout.yml");
    if (hour === 4) workflows.push("competition-catalog-sync.yml");
    if (hour === 5 && day === 1) workflows.push("fixture-discovery.yml");
  }

  if (mode !== "minimal") {
    // One full refresh after the European evening window captures final xG/shots,
    // referee assignments and incidents that lightweight live refreshes omit.
    if (hour === 1 && primarySlot) workflows.push("worker.yml");
    if (hour === 6 && primarySlot && trainingAutomation.canCalibrate) workflows.push("nightly-model-maintenance.yml");
    if (hour === 5 && primarySlot) workflows.push("data-integrity-maintenance.yml");
  }

  if (mode === "full") {
    if ((day === 1 || day === 15) && primarySlot) workflows.push("prediction-evaluation.yml");
    if (hour === 9 && primarySlot) workflows.push("coverage-repairs.yml");
    if (hour === 3 && primarySlot) workflows.push("free-source-batches.yml");
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
  localMinuteAmsterdam: minute,
  localDayAmsterdam: day,
  fixtureSignals: {
    upcoming: upcomingFixtures.length,
    nearestKickoff: upcomingFixtures[0] || null,
    lineupWindow: lineupWindow.length,
    lineupWindows: Object.fromEntries(Object.entries(lineupWindows).map(([key, rows]) => [key, rows.length])),
    closingOddsWindow: closingOddsWindow.length,
    prematchOddsWindow: prematchOddsWindow.length,
    openingOddsWindow: openingOddsWindow.length,
    missingPreMatchSnapshots: missingSnapshotWindow.length,
    missingRegularPreMatchSnapshots: missingRegularSnapshotWindow.length,
    activeMatchWindow: activeMatchWindow.length,
  },
  dataNeeds,
  providerQuota,
  trainingAutomation,
  apiFootballAcceptance,
  reportAgeHours: Object.fromEntries(Object.entries(reports).map(([key, report]) => [key, Number(reportAgeHours(report).toFixed(2))])),
  workflows,
};

fs.mkdirSync(path.join(process.cwd(), "monitor"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "monitor", "workflow-orchestrator-plan.json"), JSON.stringify(plan, null, 2));
console.log(JSON.stringify(plan, null, 2));

if (emitGithubOutput && process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `workflows=${workflows.join(" ")}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${workflows.length}\n`);
}
