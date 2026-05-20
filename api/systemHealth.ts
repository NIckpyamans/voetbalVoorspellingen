import fs from "fs";
import path from "path";
import { addDaysToDateKey, todayAmsterdamKey } from "../shared/date.js";
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

function countDay(dateKey: string) {
  const day = readJsonSafe(path.join("data", "days", `${dateKey}.json`), null);
  if (Array.isArray(day?.matches)) return day.matches.length;

  const store = readJsonSafe("server_data.json", null);
  return Array.isArray(store?.matches?.[dateKey]) ? store.matches[dateKey].length : 0;
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
  const sources = scout?.sources || {};
  return Object.entries(sources).map(([name, value]: [string, any]) => ({
    name,
    status: value?.status || "unknown",
    note: value?.note || null,
    lastOk: value?.lastOk || null,
  }));
}

export function buildSystemHealth(mode = "health") {
  const started = Date.now();
  const today = todayAmsterdamKey();
  const yesterday = addDaysToDateKey(today, -1);
  const tomorrow = addDaysToDateKey(today, 1);
  const meta = readJsonSafe(path.join("data", "meta.json"), {});
  const standings = readJsonSafe(path.join("data", "standings.json"), {});
  const findings = readJsonSafe(path.join("monitor", "daily-findings.json"), { days: {} });
  const serverDataInfo = getFileInfo("server_data.json");
  const metaInfo = getFileInfo(path.join("data", "meta.json"));
  const standingsInfo = getFileInfo(path.join("data", "standings.json"));

  const lastRun = Number(meta?.lastRun || 0);
  const ageMinutes = lastRun ? Math.round((Date.now() - lastRun) / 60_000) : null;
  const counts = {
    yesterday: countDay(yesterday),
    today: countDay(today),
    tomorrow: countDay(tomorrow),
  };

  const checks = {
    storage: serverDataInfo.exists || metaInfo.exists,
    splitData: metaInfo.exists && standingsInfo.exists,
    workerFresh: !!lastRun && ageMinutes != null && ageMinutes <= MAX_FRESH_AGE_MINUTES,
    todayOrTomorrowData: counts.today > 0 || counts.tomorrow > 0,
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
      workerVersion: meta?.workerVersion || "unknown",
      sourceBranch: meta?.sourceBranch || process.env.DATA_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || "unknown",
    },
    data: {
      dates: { yesterday, today, tomorrow },
      matchCounts: counts,
      standingsCount: Object.keys(standings?.standings || {}).length,
      cupSheetCount: Object.keys(standings?.cupSheets || {}).length,
      reviewCount: Number(meta?.reviewCount || 0),
      teamLearningCount: Number(meta?.teamLearningCount || 0),
      sourceCoverage: meta?.sourceCoverage || null,
      modelPerformance: meta?.modelPerformance || null,
      backtestSummary: meta?.backtestSummary || null,
      anomalyReport: meta?.anomalyReport || null,
    },
    cache: {
      ttlMs: Number(process.env.DATA_CACHE_TTL_MS || 60_000),
      serverData: serverDataInfo,
      meta: metaInfo,
      standings: standingsInfo,
    },
    externalSources: sourceStatus(meta),
    checks,
    issues,
    warnings: {
      dataQuality:
        Number(meta?.anomalyReport?.criticalCount || 0) > 0
          ? `${Number(meta?.anomalyReport?.criticalCount || 0)} kritische datakwaliteit-groep(en), zie anomalyReport.`
          : null,
    },
  };
}

export function sendSystemHealth(_req: any, res: any, mode = "health") {
  try {
    const payload = buildSystemHealth(mode);
    setCorsHeaders(_req, res);
    res.setHeader("Cache-Control", mode === "health" ? "no-store" : "s-maxage=60, stale-while-revalidate=60");
    return res.status(payload.ok ? 200 : 503).json(payload);
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
