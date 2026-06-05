#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
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
loadLocalEnv(ROOT);

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
const freeSourceStrategy = readJsonSafe(path.join("docs", "data-context", "free-source-strategy.json"), {});
const followedClubContext = readJsonSafe(path.join("docs", "data-context", "followed-clubs-context.json"), {});
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

async function readDatabaseCoverage() {
  if (!dbConfigured) return { databaseConfigured: false };
  try {
    const sql = getSql();
    if (!sql) return { databaseConfigured: false };
    const [counts] = await sql.query(`
      select
        (select count(*)::int from matches) as matches,
        (select count(*)::int from matches where coalesce(weather_payload, '{}'::jsonb) <> '{}'::jsonb) as weather_matches,
        (select count(*)::int from historical_odds_snapshots) as historical_odds_snapshots,
        (select count(*)::int from match_stats) as match_stats,
        (select count(*)::int from team_match_stats) as team_match_stats,
        (select count(*)::int from team_season_stats where coalesce(style_profile, '{}'::jsonb) <> '{}'::jsonb) as styled_team_seasons,
        (select count(*)::int from competition_season_clubs) as season_clubs,
        (select count(*)::int from standings_snapshots where source = 'season-reset-zero') as zero_standings,
        (select count(*)::int from h2h_edges) as h2h_edges
    `);
    const totalMatches = Math.max(Number(counts.matches || 0), 1);
    return {
      databaseConfigured: true,
      ...counts,
      weatherCoverage: Number((Number(counts.weather_matches || 0) / totalMatches).toFixed(3)),
      matchStatsCoverage: Number((Number(counts.match_stats || 0) / totalMatches).toFixed(3)),
      status:
        Number(counts.historical_odds_snapshots || 0) > 0 &&
        Number(counts.match_stats || 0) > 0 &&
        Number(counts.team_match_stats || 0) > 0 &&
        Number(counts.season_clubs || 0) > 0 &&
        Number(counts.h2h_edges || 0) > 0
          ? "database_feature_coverage_ready"
          : "database_feature_coverage_incomplete",
    };
  } catch (error) {
    return { databaseConfigured: true, status: "database_coverage_check_failed", error: error.message };
  }
}

async function readDatabaseFixtureCalendar() {
  if (!dbConfigured) return { databaseConfigured: false };
  try {
    const sql = getSql();
    if (!sql) return { databaseConfigured: false };
    const rows = await sql.query(
      `
        select date_key, count(*)::int as matches, array_agg(distinct data_source) as sources
        from matches
        where date_key >= $1
          and status_normalized in ('scheduled', 'live')
        group by date_key
        order by date_key
        limit 14
      `,
      [today]
    );
    const next = rows[0] || null;
    return {
      databaseConfigured: true,
      upcomingDays: rows.length,
      nextMatchDate: next?.date_key || null,
      nextMatchCount: Number(next?.matches || 0),
      sources: [...new Set(rows.flatMap((row) => row.sources || []).filter(Boolean))],
      status: rows.length ? "database_fixture_calendar_ready" : "database_fixture_calendar_empty",
    };
  } catch (error) {
    return { databaseConfigured: true, status: "database_fixture_calendar_failed", error: error.message };
  }
}

const databaseCoverage = await readDatabaseCoverage();
const databaseFixtureCalendar = await readDatabaseFixtureCalendar();
const todayMonth = Number(today.slice(5, 7));
const likelyEuropeanOffseason = [6, 7].includes(todayMonth) && databaseFixtureCalendar.status === "database_fixture_calendar_empty";
const fixtureCalendarStatus =
  fixtureCalendar.healthy
    ? fixtureCalendar.status
    : likelyEuropeanOffseason
      ? "confirmed_offseason_window"
      : !databaseFixtureCalendar.nextMatchDate
    ? fixtureCalendar.status
    : "database_fixture_calendar_fallback";
const fixtureCalendarHealthy = fixtureCalendar.healthy || Boolean(databaseFixtureCalendar.nextMatchDate) || likelyEuropeanOffseason;

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
    modelQualityByDbFeatureSourceCount: trainingExport.modelQualityByDbFeatureSourceCount || [],
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
  databaseFeatureCoverage: databaseCoverage,
  freeSources: {
    strategyConfigured: Boolean(freeSourceStrategy.version),
    mode: freeSourceStrategy.mode || "unknown",
    sourceCount: Array.isArray(freeSourceStrategy.sources) ? freeSourceStrategy.sources.length : 0,
    highPrioritySources: Array.isArray(freeSourceStrategy.sources)
      ? freeSourceStrategy.sources.filter((source) => source.priority === "high").length
      : 0,
    followedClubContextGenerated: Boolean(followedClubContext.generatedAt),
    followedClubs: Array.isArray(followedClubContext.clubs) ? followedClubContext.clubs.length : 0,
    followedClubsEnriched: Array.isArray(followedClubContext.clubs)
      ? followedClubContext.clubs.filter((club) => club.external?.theSportsDb?.ok).length
      : 0,
    sourceRecordSync: followedClubContext.sourceRecordSync || null,
    status:
      freeSourceStrategy.version &&
      Array.isArray(followedClubContext.clubs) &&
      followedClubContext.clubs.length > 0 &&
      followedClubContext.clubs.every((club) => club.external?.theSportsDb?.ok)
        ? "free_source_context_ready"
        : "free_source_context_incomplete",
    runCommand: "npm run context:clubs",
  },
  sourceLineage: {
    backfillGenerated: Boolean(sourceLineageBackfill.generatedAt),
    generatedAt: sourceLineageBackfill.generatedAt || null,
    sourceRecords: Number(sourceLineageBackfill.sourceRecords || 0),
    sourceAuditRows: Number(sourceLineageBackfill.sourceAuditRows || 0),
    appliedSourceRecords: Number(sourceLineageBackfill.appliedCounts?.source_records || 0),
    appliedSourceAuditRows: Number(sourceLineageBackfill.appliedCounts?.source_audit || 0),
    predictionSnapshotsInDatabase: Number(sourceLineageBackfill.appliedCounts?.prediction_snapshots || 0),
    auditBackfillStatus: sourceLineageBackfill.auditBackfillStatus || null,
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
    status: fixtureCalendarStatus,
    healthy: fixtureCalendarHealthy,
    emptyWindowOk: fixtureCalendar.emptyWindowOk || Boolean(databaseFixtureCalendar.nextMatchDate) || likelyEuropeanOffseason,
    todayCount: fixtureCalendar.todayCount,
    tomorrowCount: fixtureCalendar.tomorrowCount,
    nextMatchDate: fixtureCalendar.nextMatchDate || databaseFixtureCalendar.nextMatchDate,
    nextMatchCount: fixtureCalendar.nextMatchCount || databaseFixtureCalendar.nextMatchCount,
    databaseFallback: databaseFixtureCalendar,
    explanation: fixtureCalendar.healthy
      ? fixtureCalendar.explanation
      : likelyEuropeanOffseason
        ? "Geen komende fixtures gevonden; dit valt in het Europese zomer/offseasonvenster. Blijf OpenFootball/Football-Data batchimports plannen voor nieuwe seizoenen."
      : databaseFixtureCalendar.nextMatchDate
        ? `JSON/cache heeft geen directe fixtures, maar de database bevat gratis bronfixtures vanaf ${databaseFixtureCalendar.nextMatchDate}.`
        : fixtureCalendar.explanation,
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
