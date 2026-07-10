import { fetchDayData, fetchMetaData, fetchRepoJson, fetchServerStore } from "./_dataSource.js";
import fs from "fs";
import path from "path";
import { addDaysToDateKey, todayAmsterdamKey } from "../shared/date.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";
import { mergeDuplicateServedMatches, normalizeServedMatch } from "../shared/matchNormalization.js";
import { buildMatchSourceCoverage, databaseConfigured, readDatabaseCounts, readDatabaseDay } from "../shared/database.js";
import { filterVisibleMatches } from "../shared/competitionVisibility.js";
import { readDashboardDayCache } from "../shared/dashboardR2Cache.js";
import { compactDashboardMatch } from "../shared/dashboardCompact.js";

const logger = createLogger("api.matches");

async function readRufloReport() {
  try {
    const remote = await fetchRepoJson("monitor/ruflo-agent-report.json");
    return remote.data;
  } catch {
    try {
      const reportPath = path.join(process.cwd(), "monitor", "ruflo-agent-report.json");
      if (!fs.existsSync(reportPath)) return null;
      return JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    } catch {
      return null;
    }
  }
}
async function readBiweeklyDigest() {
  try {
    const remote = await fetchRepoJson("monitor/biweekly-review-digest.json");
    return remote.data;
  } catch {
    try {
      const digestPath = path.join(process.cwd(), "monitor", "biweekly-review-digest.json");
      if (!fs.existsSync(digestPath)) return null;
      return JSON.parse(fs.readFileSync(digestPath, "utf-8"));
    } catch {
      return null;
    }
  }
}

async function readDataContext() {
  try {
    const remote = await fetchRepoJson("docs/data-context/analysis-context.json");
    return await enrichDataContext(remote.data);
  } catch {
    try {
      const contextPath = path.join(process.cwd(), "docs", "data-context", "analysis-context.json");
      if (!fs.existsSync(contextPath)) return null;
      return await enrichDataContext(JSON.parse(fs.readFileSync(contextPath, "utf-8")));
    } catch {
      return null;
    }
  }
}

async function readContextJson(relativePath: string) {
  try {
    const remote = await fetchRepoJson(relativePath);
    return remote.data;
  } catch {
    try {
      const localPath = path.join(process.cwd(), ...relativePath.split("/"));
      if (!fs.existsSync(localPath)) return null;
      return JSON.parse(fs.readFileSync(localPath, "utf-8"));
    } catch {
      return null;
    }
  }
}

async function enrichDataContext(context: any) {
  if (!context) return context;
  const [freeSourceStrategy, followedClubContext] = await Promise.all([
    readContextJson("docs/data-context/free-source-strategy.json"),
    readContextJson("docs/data-context/followed-clubs-context.json"),
  ]);
  return {
    ...context,
    freeSourceStrategy,
    followedClubContext,
  };
}

function readSourceLineageBackfill() {
  try {
    const manifestPath = path.join(process.cwd(), "monitor", "source-lineage-backfill.json");
    if (!fs.existsSync(manifestPath)) return null;
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return null;
  }
}

async function buildDatabaseIntegration(dataContext: any) {
  const configured = databaseConfigured();
  const sourceLineageBackfill = readSourceLineageBackfill();
  const counts = configured ? await readDatabaseCounts().catch(() => null) : null;
  return {
    sourceOfTruth: counts?.matches || counts?.prediction_snapshots ? "postgres" : configured ? "postgres-ready" : "json-cache",
    databaseConfigured: configured,
    counts,
    schemaApplyCommand: "npm run db:schema:apply",
    sourceLineageBackfill,
    dashboardContracts: dataContext?.defaultDashboardSections || [],
    databaseBackedSections: counts?.matches || counts?.prediction_snapshots ? dataContext?.defaultDashboardSections || [] : [],
    jsonFallbackSections: counts?.matches || counts?.prediction_snapshots ? [] : dataContext?.defaultDashboardSections || [],
    nextAction: configured
      ? counts?.matches
        ? "Dashboard leest Postgres waar data beschikbaar is; JSON blijft fallback."
        : "Worker/database sync draaien zodat matches en prediction snapshots gevuld worden."
      : "Vul DATABASE_URL of POSTGRES_URL om dashboardsecties database-backed te maken.",
  };
}

function attachReview(match: any, reviewsOrStore: any) {
  const reviews = reviewsOrStore?.postMatchReviews || reviewsOrStore?.reviews || reviewsOrStore || {};
  const review = reviews?.[match.id] || null;
  const sourceCoverage = match.freeSourceCoverage || match.sourceCoverage || buildMatchSourceCoverage(match, match.prediction || null);
  return {
    ...match,
    review,
    learningSummary: match.learningSummary || null,
    marketCalibration: match.marketCalibration || null,
    freeSourceCoverage: sourceCoverage,
    sourceCoverage,
  };
}

function attachReviewAndNormalize(match: any, store: any) {
  return normalizeServedMatch(attachReview(match, store));
}

async function readSplitMeta() {
  try {
    const { data } = await fetchMetaData();
    return data || {};
  } catch {
    return {};
  }
}

async function readSplitDay(dateKey: string) {
  const { data, branch } = await fetchDayData(dateKey);
  const day = data || {};
  return {
    matches: Array.isArray(day.matches) ? day.matches : [],
    reviews: day.reviews || {},
    lastRun: day.lastRun || null,
    workerVersion: day.workerVersion || "unknown",
    branch,
  };
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  const { date, live, days } = req.query;
  const detailMatchId = String(req.query?.matchId || req.query?.id || "");
  const detailRequest = Boolean(detailMatchId);
  const view = String(req.query?.view || req.query?.mode || "compact").toLowerCase();
  const full = view === "full" || view === "debug" || detailRequest;
  const includeEvents = full || req.query?.includeEvents === "true" || req.query?.compat === "events";
  const includeDiagnostics = !detailRequest && (full || req.query?.diagnostics === "true");
  const today = todayAmsterdamKey();
  const targetDate = typeof date === "string" && date ? date : today;
  const isLiveSensitiveRequest = targetDate === today || live === "true";

  setCorsHeaders(req, res);
  res.setHeader(
    "Cache-Control",
    isLiveSensitiveRequest ? "no-store" : "s-maxage=120, stale-while-revalidate=60"
  );

  try {
    const meta = await readSplitMeta();
    let diagnosticsPayload = {};
    if (includeDiagnostics) {
      const [biweeklyDigest, dataContext, rufloReport] = await Promise.all([
        readBiweeklyDigest(),
        readDataContext(),
        readRufloReport(),
      ]);
      const databaseIntegration = await buildDatabaseIntegration(dataContext);
      diagnosticsPayload = {
        featureDiagnostics: meta.featureDiagnostics || null,
        sourceCoverage: meta.sourceCoverage || null,
        dataScout: meta.dataScout || null,
        dataCompletenessAudit: meta.dataCompletenessAudit || null,
        oddsIntegrationReadiness: meta.oddsIntegrationReadiness || null,
        modelPerformance: meta.modelPerformance || null,
        backtestSummary: meta.backtestSummary || null,
        backtestSegmentation: meta.backtestSegmentation || null,
        leagueCalibrationProfiles: meta.leagueCalibrationProfiles || {},
        leagueCalibrationProfilesByWindow: meta.leagueCalibrationProfilesByWindow || {},
        leagueCalibrationRollbackProfiles: meta.leagueCalibrationRollbackProfiles || {},
        anomalyReport: meta.anomalyReport || null,
        competitionArchiveIndex: meta.competitionArchiveIndex || null,
        teamSquadSummary: meta.teamSquadSummary || null,
        biweeklyDigest,
        dataContext,
        databaseIntegration,
        rufloReport,
      };
    }

    if (days && typeof days === "string") {
      const numDays = parseInt(days, 10);
      if (!isNaN(numDays) && numDays > 0 && numDays <= 7) {
        const multiDayMatches: any[] = [];
        let sourceBranch = "split-data";

        try {
          for (let i = -Math.floor(numDays / 2); i <= Math.floor(numDays / 2); i++) {
            const dateStr = addDaysToDateKey(targetDate, i);
            const dbDay = databaseConfigured() ? await readDatabaseDay(dateStr).catch(() => null) : null;
            if (dbDay?.matches?.length) {
              sourceBranch = "postgres";
              multiDayMatches.push(...dbDay.matches.map((match: any) => attachReviewAndNormalize(match, {})));
            } else {
              const day = await readSplitDay(dateStr);
              sourceBranch = day.branch || sourceBranch;
              multiDayMatches.push(...day.matches.map((match: any) => attachReviewAndNormalize(match, day.reviews)));
            }
          }
        } catch {
          const { store, branch } = await fetchServerStore();
          sourceBranch = branch;
          for (let i = -Math.floor(numDays / 2); i <= Math.floor(numDays / 2); i++) {
            const dateStr = addDaysToDateKey(targetDate, i);
            const dayMatches = (store.matches?.[dateStr] || []).map((match: any) => attachReviewAndNormalize(match, store));
            multiDayMatches.push(...dayMatches);
          }
        }

        const uniqueMultiDayMatches = filterVisibleMatches(mergeDuplicateServedMatches(multiDayMatches));
        const responseMatches = full ? uniqueMultiDayMatches : uniqueMultiDayMatches.map(compactDashboardMatch);

        return res.status(200).json({
          ok: true,
          view: full ? "full" : "compact",
          matches: responseMatches,
          ...(includeEvents ? { events: responseMatches } : {}),
          total: responseMatches.length,
          rawTotal: uniqueMultiDayMatches.length,
          date: targetDate,
          dateRange: `${numDays} dagen`,
          lastRun: meta.lastRun || null,
          workerVersion: meta.workerVersion || "unknown",
          reviewCount: meta.reviewCount || 0,
          teamLearningCount: meta.teamLearningCount || 0,
          aiAdvice: meta.aiAdvice || [],
          ...diagnosticsPayload,
          sourceBranch,
          source: sourceBranch === "postgres" ? "postgres-database-multiday" : "github-worker-v4-split-multiday",
          durationMs: Date.now() - started,
        });
      }
    }

    let baseMatches: any[] = [];
    let lastRun = meta.lastRun || null;
    let workerVersion = meta.workerVersion || "unknown";
    let sourceBranch = "split-data";

    try {
      const cachedDay = !detailRequest && !isLiveSensitiveRequest ? await readDashboardDayCache(targetDate).catch(() => null) : null;
      if (cachedDay?.matches?.length) {
        baseMatches = cachedDay.matches.map((match: any) => attachReviewAndNormalize(match, {}));
        sourceBranch = "r2-dashboard-cache";
        lastRun = cachedDay.generatedAt || lastRun;
      } else {
      const dbDay = !detailRequest && databaseConfigured() ? await readDatabaseDay(targetDate).catch(() => null) : null;
      if (dbDay?.matches?.length) {
        baseMatches = dbDay.matches.map((match: any) => attachReviewAndNormalize(match, {}));
        sourceBranch = "postgres";
      } else {
        const day = await readSplitDay(targetDate);
        baseMatches = day.matches.map((match: any) => attachReviewAndNormalize(match, day.reviews));
        lastRun = day.lastRun || lastRun;
        workerVersion = day.workerVersion || workerVersion;
        sourceBranch = day.branch || sourceBranch;
      }
      }
    } catch {
      const { store, branch } = await fetchServerStore();
      baseMatches = (store.matches?.[targetDate] || []).map((match: any) => attachReviewAndNormalize(match, store));
      lastRun = store.lastRun || lastRun;
      workerVersion = store.workerVersion || workerVersion;
      sourceBranch = branch;
    }

    const uniqueBaseMatches = filterVisibleMatches(mergeDuplicateServedMatches(baseMatches));

    const matches = live === "true"
      ? uniqueBaseMatches.filter((m: any) => String(m.status || "").toUpperCase() === "LIVE")
      : uniqueBaseMatches;
    const selectedMatches = detailRequest
      ? matches.filter((match: any) => String(match?.id || "") === detailMatchId)
      : matches;
    const responseMatches = full ? selectedMatches : selectedMatches.map(compactDashboardMatch);

    return res.status(200).json({
      ok: true,
      view: full ? "full" : "compact",
      matches: responseMatches,
      ...(includeEvents ? { events: responseMatches } : {}),
      total: responseMatches.length,
      rawTotal: matches.length,
      matchId: detailRequest ? detailMatchId : undefined,
      found: detailRequest ? responseMatches.length > 0 : undefined,
      date: targetDate,
      lastRun,
      workerVersion,
      reviewCount: meta.reviewCount || 0,
      teamLearningCount: meta.teamLearningCount || 0,
      aiAdvice: meta.aiAdvice || [],
      ...diagnosticsPayload,
      sourceBranch,
      source: responseMatches.length && sourceBranch === "postgres"
        ? "postgres-database"
        : responseMatches.length && sourceBranch === "r2-dashboard-cache"
          ? "cloudflare-r2-dashboard-cache"
          : responseMatches.length ? "github-worker-v4-split" : "no-matches-yet",
      message: responseMatches.length ? null : "Nog geen wedstrijden gevonden voor deze dag in de actuele workerdata.",
      durationMs: Date.now() - started,
    });
  } catch (err: any) {
    logger.error("matches_failed", { targetDate, live, days, durationMs: Date.now() - started, error: getErrorDetails(err) });
    return res.status(503).json({
      ok: false,
      matches: [],
      events: [],
      lastRun: null,
      workerNeeded: true,
      error: err?.message || "Unknown error",
      durationMs: Date.now() - started,
    });
  }
}


