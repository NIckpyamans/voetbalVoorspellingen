import fs from "fs";
import path from "path";
import { fetchDayData, fetchMetaData, fetchStandingsData } from "./_dataSource.js";
import { addDaysToDateKey, todayAmsterdamKey } from "../shared/date.js";
import { buildFixtureCalendarStatus } from "../shared/fixtureCalendar.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";

const logger = createLogger("api.system-health");
const ROOT = process.cwd();
const MAX_FRESH_AGE_MINUTES = Number(process.env.HEALTH_MAX_WORKER_AGE_MINUTES || 180);

function readJsonSafe(relativePath: string, fallback: any) {
  const filePath = path.join(ROOT, relativePath);
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    logger.warning("read_json_failed", { relativePath, error: getErrorDetails(error) });
    return fallback;
  }
}

function readLocalDay(dateKey: string) {
  const day = readJsonSafe(path.join("data", "days", `${dateKey}.json`), null);
  if (Array.isArray(day?.matches)) return day;

  const store = readJsonSafe("server_data.json", null);
  return Array.isArray(store?.matches?.[dateKey]) ? { matches: store.matches[dateKey] } : null;
}

function countMatches(day: any) {
  return Array.isArray(day?.matches) ? day.matches.length : 0;
}

async function fetchHealthJson(label: string, loader: () => Promise<any>, fallback: any) {
  try {
    const result = await loader();
    return {
      available: true,
      data: result?.data ?? fallback,
      branch: result?.branch || null,
      sourceUrl: result?.sourceUrl || null,
      cached: !!result?.cached,
      error: null,
    };
  } catch (error) {
    logger.warning("health_repo_fetch_failed", { label, error: getErrorDetails(error) });
    return {
      available: false,
      data: fallback,
      branch: null,
      sourceUrl: null,
      cached: false,
      error: getErrorDetails(error),
    };
  }
}

function getFileInfo(relativePath: string) {
  const filePath = path.join(ROOT, relativePath);
  try {
    const stat = fs.statSync(filePath);
    return {
      exists: true,
      bytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return { exists: false, bytes: 0, updatedAt: null };
  }
}

function sourceStatus(meta: any) {
  const scout = meta?.dataScout || {};
  const sources = scout?.sources || meta?.sourceCoverage?.backupSources || {};
  const normalizedSources = Array.isArray(sources)
    ? sources.map((value: any, index: number) => ({
        name: value?.name || value?.key || `source-${index + 1}`,
        ...value,
      }))
    : Object.entries(sources).map(([name, value]: [string, any]) => ({
        name,
        ...value,
      }));

  return normalizedSources.map((value: any) => ({
    name: value?.name || value?.key || "unknown",
    status: value?.status || "unknown",
    note: value?.note || null,
    lastOk: value?.lastOk || null,
  }));
}

export async function buildSystemHealth(mode = "health") {
  const started = Date.now();
  const today = todayAmsterdamKey();
  const yesterday = addDaysToDateKey(today, -1);
  const tomorrow = addDaysToDateKey(today, 1);
  const freshRepoOptions = { cacheBust: true, bypassMemoryCache: true };
  const [remoteMeta, remoteStandings, remoteYesterday, remoteToday, remoteTomorrow] = await Promise.all([
    fetchHealthJson("meta", () => fetchMetaData(freshRepoOptions), {}),
    fetchHealthJson("standings", () => fetchStandingsData(freshRepoOptions), {}),
    fetchHealthJson(`day:${yesterday}`, () => fetchDayData(yesterday, freshRepoOptions), null),
    fetchHealthJson(`day:${today}`, () => fetchDayData(today, freshRepoOptions), null),
    fetchHealthJson(`day:${tomorrow}`, () => fetchDayData(tomorrow, freshRepoOptions), null),
  ]);
  const meta = remoteMeta.available ? remoteMeta.data : readJsonSafe(path.join("data", "meta.json"), {});
  const standings = remoteStandings.available ? remoteStandings.data : readJsonSafe(path.join("data", "standings.json"), {});
  const findings = readJsonSafe(path.join("monitor", "daily-findings.json"), { days: {} });
  const serverDataInfo = getFileInfo("server_data.json");
  const metaInfo = getFileInfo(path.join("data", "meta.json"));
  const standingsInfo = getFileInfo(path.join("data", "standings.json"));

  const lastRun = Number(meta?.lastRun || 0);
  const ageMinutes = lastRun ? Math.round((Date.now() - lastRun) / 60_000) : null;
  const counts = {
    yesterday: countMatches(remoteYesterday.available ? remoteYesterday.data : readLocalDay(yesterday)),
    today: countMatches(remoteToday.available ? remoteToday.data : readLocalDay(today)),
    tomorrow: countMatches(remoteTomorrow.available ? remoteTomorrow.data : readLocalDay(tomorrow)),
  };
  const lastRunFresh = !!lastRun && ageMinutes != null && ageMinutes <= MAX_FRESH_AGE_MINUTES;
  const knownDates = Array.isArray(meta?.dates) ? meta.dates : [yesterday, today, tomorrow];
  const fixtureDays = Object.fromEntries(
    knownDates.map((dateKey: string) => {
      const remoteDay =
        dateKey === yesterday
          ? remoteYesterday
          : dateKey === today
            ? remoteToday
            : dateKey === tomorrow
              ? remoteTomorrow
              : null;
      const day = remoteDay?.available ? remoteDay.data : readLocalDay(dateKey);
      return [dateKey, day || { matches: [] }];
    })
  );
  const fixtureCalendar = buildFixtureCalendarStatus({
    today,
    days: fixtureDays,
    meta,
    lastRunFresh,
  });

  const checks = {
    storage: serverDataInfo.exists || metaInfo.exists || remoteMeta.available,
    splitData: remoteMeta.available && remoteStandings.available && (remoteYesterday.available || remoteToday.available || remoteTomorrow.available),
    workerFresh: lastRunFresh,
    todayOrTomorrowData: counts.today > 0 || counts.tomorrow > 0 || fixtureCalendar.emptyWindowOk,
    fixtureCalendar: fixtureCalendar.healthy,
    standings: Object.keys(standings?.standings || {}).length > 0,
    monitor: !!findings?.days,
  };

  const issues = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([key]) => key);

  const status = issues.length ? "degraded" : "ok";

  return {
    ok: status === "ok",
    status,
    mode,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - started,
    worker: {
      lastRun,
      ageMinutes,
      maxFreshAgeMinutes: MAX_FRESH_AGE_MINUTES,
      freshnessStatus: checks.workerFresh ? "fresh" : "stale",
      refreshCadence: "live-score elke 2 uur, volledige worker 2x per dag",
      workerVersion: meta?.workerVersion || "unknown",
      sourceBranch: meta?.sourceBranch || remoteMeta.branch || process.env.DATA_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || "unknown",
    },
    data: {
      dates: { yesterday, today, tomorrow },
      matchCounts: counts,
      fixtureCalendar,
      standingsCount: Object.keys(standings?.standings || {}).length,
      cupSheetCount: Object.keys(standings?.cupSheets || {}).length,
      reviewCount: Number(meta?.reviewCount || 0),
      teamLearningCount: Number(meta?.teamLearningCount || 0),
      sourceCoverage: meta?.sourceCoverage || null,
      dataCompletenessAudit: meta?.dataCompletenessAudit || null,
      oddsIntegrationReadiness: meta?.oddsIntegrationReadiness || null,
      modelPerformance: meta?.modelPerformance || null,
      backtestSummary: meta?.backtestSummary || null,
      anomalyReport: meta?.anomalyReport || null,
    },
    cache: {
      ttlMs: Number(process.env.DATA_CACHE_TTL_MS || 60_000),
      serverData: serverDataInfo,
      meta: metaInfo,
      standings: standingsInfo,
      repository: {
        meta: { available: remoteMeta.available, branch: remoteMeta.branch, cached: remoteMeta.cached, sourceUrl: remoteMeta.sourceUrl },
        standings: { available: remoteStandings.available, branch: remoteStandings.branch, cached: remoteStandings.cached, sourceUrl: remoteStandings.sourceUrl },
        days: {
          yesterday: { available: remoteYesterday.available, branch: remoteYesterday.branch, cached: remoteYesterday.cached },
          today: { available: remoteToday.available, branch: remoteToday.branch, cached: remoteToday.cached },
          tomorrow: { available: remoteTomorrow.available, branch: remoteTomorrow.branch, cached: remoteTomorrow.cached },
        },
      },
    },
    externalSources: sourceStatus(meta),
    checks,
    issues,
    warnings: {
      dataQuality:
        Number(meta?.anomalyReport?.criticalCount || 0) > 0
          ? `${Number(meta?.anomalyReport?.criticalCount || 0)} kritische datakwaliteit-groep(en), zie anomalyReport.`
          : null,
      fixtureCalendar: fixtureCalendar.severity === "none" ? null : fixtureCalendar.explanation,
    },
  };
}

export async function sendSystemHealth(_req: any, res: any, mode = "health") {
  try {
    const payload = await buildSystemHealth(mode);
    setCorsHeaders(_req, res);
    res.setHeader("Cache-Control", mode === "health" ? "no-store" : "s-maxage=60, stale-while-revalidate=60");
    const statusCode = payload.ok || mode === "health" || mode === "status" ? 200 : 503;
    return res.status(statusCode).json(payload);
  } catch (error) {
    logger.error("system_health_failed", { error: getErrorDetails(error) });
    return res.status(500).json({
      ok: false,
      status: "error",
      mode,
      error: getErrorDetails(error),
    });
  }
}
