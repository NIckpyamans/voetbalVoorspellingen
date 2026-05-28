#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { todayAmsterdamKey } from "../shared/date.js";
import { buildFixtureCalendarStatus } from "../shared/fixtureCalendar.js";

const ROOT = process.cwd();
const DEFAULT_MIN_SNAPSHOT_ROWS = Number(process.env.SNAPSHOT_MIN_TRAINING_ROWS || 50);

function readJsonSafe(relativePath, fallback) {
  try {
    const filePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function readTextSafe(relativePath) {
  try {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
  } catch {
    return "";
  }
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function configured(...names) {
  return names.some((name) => String(process.env[name] || "").trim().length > 0);
}

const packageJson = readJsonSafe("package.json", {});
const trainingExport = readJsonSafe(path.join("training", "catboost-ready.json"), {});
const meta = readJsonSafe(path.join("data", "meta.json"), {});
const indexHtml = readTextSafe("index.html");
const indexTsx = readTextSafe("index.tsx");
const learnWorkflow = readTextSafe(path.join(".github", "workflows", "learn.yml"));
const today = todayAmsterdamKey();
const fixtureDays = Object.fromEntries(
  (Array.isArray(meta.dates) ? meta.dates : []).map((dateKey) => [
    dateKey,
    readJsonSafe(path.join("data", "days", `${dateKey}.json`), { matches: [] }),
  ])
);
const lastRun = Number(meta?.lastRun || 0);
const fixtureCalendar = buildFixtureCalendarStatus({
  today,
  days: fixtureDays,
  meta,
  lastRunFresh: !!lastRun && Date.now() - lastRun <= 180 * 60_000,
});

const oddsKeyConfigured = configured("ODDS_API_KEY", "THE_ODDS_API_KEY");
const oddsTemplateConfigured = configured("ODDS_API_URL_TEMPLATE");
const dbConfigured = configured("DATABASE_URL", "POSTGRES_URL", "SUPABASE_DB_URL");

const report = {
  generatedAt: new Date().toISOString(),
  mode: "no-secret-readiness",
  odds: {
    providerNameConfigured: configured("ODDS_PROVIDER_NAME"),
    apiKeyConfigured: oddsKeyConfigured,
    urlTemplateConfigured: oddsTemplateConfigured,
    readyForRealOdds: oddsKeyConfigured && oddsTemplateConfigured,
    status: oddsKeyConfigured && oddsTemplateConfigured ? "ready" : "credentials_needed",
    note: "Er worden geen API-keys of geheime waarden gelogd.",
  },
  database: {
    schemaFileExists: exists(path.join("database", "schema.sql")),
    connectionConfigured: dbConfigured,
    applyCommand: "npm run db:schema:apply",
    status: dbConfigured ? "ready_to_apply_schema" : "database_url_needed",
  },
  training: {
    exportExists: exists(path.join("training", "catboost-ready.json")),
    totalRows: Number(trainingExport.totalRows || 0),
    snapshotBackedRows: Number(trainingExport.snapshotBackedRows || 0),
    fallbackRows: Number(trainingExport.fallbackRows || 0),
    minSnapshotRows: Number(trainingExport.trainingPolicy?.minSnapshotRows || DEFAULT_MIN_SNAPSHOT_ROWS),
    snapshotBoostActive: Boolean(trainingExport.trainingPolicy?.snapshotBoostActive),
    snapshotMaturity: trainingExport.trainingPolicy?.maturity || "unknown",
    snapshotWeight: trainingExport.trainingPolicy?.snapshotWeight ?? null,
    fallbackWeight: trainingExport.trainingPolicy?.fallbackWeight ?? null,
    generatedAt: trainingExport.generatedAt || null,
    scheduledLearning: learnWorkflow.includes("schedule:"),
    status:
      Number(trainingExport.snapshotBackedRows || 0) >= Number(trainingExport.trainingPolicy?.minSnapshotRows || DEFAULT_MIN_SNAPSHOT_ROWS)
        ? "snapshot_training_mature"
        : Number(trainingExport.snapshotBackedRows || 0) > 0
          ? "snapshot_training_warming_up"
          : "waiting_for_finished_snapshot_predictions",
  },
  fixtureCalendar: {
    today,
    status: fixtureCalendar.status,
    healthy: fixtureCalendar.healthy,
    emptyWindowOk: fixtureCalendar.emptyWindowOk,
    todayCount: fixtureCalendar.todayCount,
    tomorrowCount: fixtureCalendar.tomorrowCount,
    nextMatchDate: fixtureCalendar.nextMatchDate,
    nextMatchCount: fixtureCalendar.nextMatchCount,
    explanation: fixtureCalendar.explanation,
  },
  frontend: {
    tailwindDependency: Boolean(packageJson.devDependencies?.tailwindcss),
    autoprefixerDependency: Boolean(packageJson.devDependencies?.autoprefixer),
    postcssConfigExists: exists("postcss.config.cjs"),
    tailwindConfigExists: exists("tailwind.config.cjs"),
    tailwindCssImported: indexTsx.includes("./styles.css"),
    tailwindCdnRemoved: !indexHtml.includes("cdn.tailwindcss.com"),
    status:
      packageJson.devDependencies?.tailwindcss &&
      exists("postcss.config.cjs") &&
      exists("tailwind.config.cjs") &&
      indexTsx.includes("./styles.css") &&
      !indexHtml.includes("cdn.tailwindcss.com")
        ? "production_tailwind_build"
        : "tailwind_build_incomplete",
  },
};

process.stdout.write(JSON.stringify(report, null, 2) + "\n");
