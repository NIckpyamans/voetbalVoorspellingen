#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { todayAmsterdamKey } from "../shared/date.js";
import { buildFixtureCalendarStatus } from "../shared/fixtureCalendar.js";

const ROOT = process.cwd();
const DEFAULT_MIN_SNAPSHOT_ROWS = Number(process.env.SNAPSHOT_MIN_TRAINING_ROWS || 50);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || String(process.env[key] || "").trim()) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

for (const fileName of [".env.local", ".env.production.local", ".env"]) {
  loadEnvFile(path.join(ROOT, fileName));
}

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
const dataQualityAudit = readJsonSafe(path.join("monitor", "data-quality-audit.json"), {});
const sourceLineageBackfill = readJsonSafe(path.join("monitor", "source-lineage-backfill.json"), {});
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
    migrationPlanExists: exists(path.join("docs", "database-migration-plan.md")),
    status: dbConfigured ? "ready_to_apply_schema" : "database_url_needed",
    nextStep: dbConfigured
      ? "Voer npm run db:schema:apply uit en controleer daarna prediction/database writes."
      : "Vul DATABASE_URL, POSTGRES_URL of SUPABASE_DB_URL als secret voordat schema apply kan draaien.",
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
    nextTargetRows: Number(trainingExport.trainingPolicy?.nextTargetRows || 150),
    nextTargetGap: Math.max(0, Number(trainingExport.trainingPolicy?.nextTargetRows || 150) - Number(trainingExport.snapshotBackedRows || 0)),
  },
  dataQuality: {
    auditExists: exists(path.join("monitor", "data-quality-audit.json")),
    generatedAt: dataQualityAudit.generatedAt || null,
    pendingResultBackfills: Number(dataQualityAudit?.totals?.pendingResultBackfills || 0),
    missingPastScores: Number(dataQualityAudit?.totals?.missingPastScores || 0),
    h2hCoverage: Number(dataQualityAudit?.totals?.h2hCoverage || 0),
    status:
      !dataQualityAudit.generatedAt
        ? "run_monitor_data_quality"
        : Number(dataQualityAudit?.totals?.pendingResultBackfills || 0) || Number(dataQualityAudit?.totals?.missingPastScores || 0)
          ? "result_backfill_needed"
          : Number(dataQualityAudit?.totals?.h2hCoverage || 0) < 0.85
            ? "h2h_backfill_needed"
            : "data_quality_ready",
    runCommand: "npm run monitor:data-quality",
  },
  oddsClosingLine: {
    liveOddsReady: oddsKeyConfigured && oddsTemplateConfigured,
    databaseReadyForStorage: dbConfigured,
    roiClvReady: oddsKeyConfigured && oddsTemplateConfigured && dbConfigured,
    status:
      oddsKeyConfigured && oddsTemplateConfigured && dbConfigured
        ? "ready_for_live_roi_clv_review"
        : oddsKeyConfigured && oddsTemplateConfigured
          ? "database_needed_for_roi_clv_storage"
          : "odds_credentials_needed",
    note: "ROI/CLV pas live beoordelen wanneer echte odds_at_prediction plus closing odds in de database staan.",
  },
  sourceLineage: {
    backfillGenerated: Boolean(sourceLineageBackfill.generatedAt),
    generatedAt: sourceLineageBackfill.generatedAt || null,
    sourceRecords: Number(sourceLineageBackfill.sourceRecords || 0),
    sourceAuditRows: Number(sourceLineageBackfill.sourceAuditRows || 0),
    applyStatus: sourceLineageBackfill.applyStatus || "not_generated",
    sqlFile: sourceLineageBackfill.sqlFile || null,
    status: sourceLineageBackfill.generatedAt
      ? dbConfigured
        ? "ready_to_apply_or_applied"
        : "generated_waiting_for_database"
      : "run_db_source_lineage_backfill",
    runCommand: "npm run db:source-lineage:backfill",
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
