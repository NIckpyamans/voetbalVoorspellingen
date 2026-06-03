import { fetchDayData, fetchMetaData, fetchRepoJson, fetchServerStore } from "./_dataSource.js";
import fs from "fs";
import path from "path";
import { addDaysToDateKey, todayAmsterdamKey } from "../shared/date.js";
import { buildWorldCup2026DayData, buildWorldCup2026FriendlyDayData, getWorldCup2026ReadinessSnapshot } from "../shared/worldCup2026.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";

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

function attachReview(match: any, reviewsOrStore: any) {
  const reviews = reviewsOrStore?.postMatchReviews || reviewsOrStore?.reviews || reviewsOrStore || {};
  return {
    ...match,
    review: reviews?.[match.id] || null,
    learningSummary: match.learningSummary || null,
    marketCalibration: match.marketCalibration || null,
  };
}

const TEAM_DEDUPE_ALIASES: Record<string, string> = {
  "freiburg": "freiburg",
  "sc freiburg": "freiburg",
  "sport club freiburg": "freiburg",
  "aston villa": "aston villa",
  "aston villa fc": "aston villa",
  "man city": "manchester city",
  "manchester city": "manchester city",
  "manchester city fc": "manchester city",
  "psg": "paris saint germain",
  "paris sg": "paris saint germain",
  "paris saint germain": "paris saint germain",
  "paris saint-germain": "paris saint germain",
  "fc barcelona": "barcelona",
  "barcelona": "barcelona",
};

const VERIFIED_RESULT_BACKFILL = [
  {
    date: "2026-05-20",
    home: "Freiburg",
    away: "Aston Villa",
    score: "0-3",
    status: "FT",
    sourceNote: "verified Europa League final result backfill",
  },
];

function normalizeDedupeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(afc|fc|cf|sc|cd|ac|as|rc|sv|vfl|vfb|bk|fk|ik|if|club de|club)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalDedupeTeam(value: unknown) {
  const normalized = normalizeDedupeText(value);
  return TEAM_DEDUPE_ALIASES[normalized] || normalized;
}

function pairKey(home: unknown, away: unknown) {
  const teams = [canonicalDedupeTeam(home), canonicalDedupeTeam(away)].sort();
  return teams.join("__");
}

function lookupVerifiedResultBackfill(match: any) {
  const dateKey = String(match?.date || match?.kickoff || "").slice(0, 10);
  const matchPair = pairKey(match?.homeTeamName || match?.homeTeam, match?.awayTeamName || match?.awayTeam);
  return VERIFIED_RESULT_BACKFILL.find((item) => item.date === dateKey && pairKey(item.home, item.away) === matchPair) || null;
}

function applyVerifiedResultBackfill(match: any) {
  const backfill = lookupVerifiedResultBackfill(match);
  if (!backfill) return match;
  const hasFinalScore = typeof match?.score === "string" && /^\d+\s*-\s*\d+$/.test(match.score) && String(match?.status || "").toUpperCase() === "FT";
  if (hasFinalScore) return match;
  const [homeScore, awayScore] = backfill.score.split("-").map(Number);
  return {
    ...match,
    score: backfill.score,
    homeScore,
    awayScore,
    status: backfill.status,
    resultPending: false,
    resultPendingReason: null,
    resultBackfill: true,
    resultBackfillSource: backfill.sourceNote,
  };
}

function buildServedMatchDedupeKey(match: any) {
  const dateKey = String(match?.date || match?.kickoff || "").slice(0, 10);
  const league = normalizeDedupeText(match?.league).replace(/\b(uefa|europe)\b/g, " ").replace(/\s+/g, " ").trim();
  const home = canonicalDedupeTeam(match?.homeTeamName || match?.homeTeam);
  const away = canonicalDedupeTeam(match?.awayTeamName || match?.awayTeam);
  if (!dateKey || !home || !away) return "";
  return `${dateKey}|${league}|${home}|${away}`;
}

function servedMatchQuality(match: any) {
  const status = String(match?.status || "").toUpperCase();
  const statusScore = ["FT", "AET", "PEN"].includes(status) ? 80 : ["LIVE", "HT"].includes(status) ? 70 : status === "RESULT_PENDING" ? 20 : 0;
  const scoreScore = match?.score || match?.homeScore != null || match?.awayScore != null ? 30 : 0;
  const logoScore = (match?.homeLogo ? 4 : 0) + (match?.awayLogo ? 4 : 0);
  const detailScore = Number(match?.h2h?.played || 0) * 2 + (match?.homeRecent ? 3 : 0) + (match?.awayRecent ? 3 : 0);
  return statusScore + scoreScore + logoScore + detailScore;
}

function dedupeServedMatches(matches: any[]) {
  const seen = new Map<string, any>();
  for (const match of matches || []) {
    const key = buildServedMatchDedupeKey(match);
    if (!key) {
      seen.set(match?.id || `${seen.size}`, match);
      continue;
    }
    const current = seen.get(key);
    if (!current) {
      seen.set(key, match);
      continue;
    }
    const preferred = servedMatchQuality(match) > servedMatchQuality(current) ? match : current;
    const fallback = preferred === match ? current : match;
    seen.set(key, {
      ...fallback,
      ...preferred,
      homeLogo: preferred.homeLogo || fallback.homeLogo,
      awayLogo: preferred.awayLogo || fallback.awayLogo,
      score: preferred.score || fallback.score,
      homeScore: preferred.homeScore ?? fallback.homeScore,
      awayScore: preferred.awayScore ?? fallback.awayScore,
      h2h: preferred.h2h || fallback.h2h,
      homeRecent: preferred.homeRecent || fallback.homeRecent,
      awayRecent: preferred.awayRecent || fallback.awayRecent,
    });
  }
  return [...seen.values()];
}

function mergeWorldCupSeed(dateKey: string, matches: any[]) {
  const worldCup = buildWorldCup2026DayData(dateKey);
  const friendly = buildWorldCup2026FriendlyDayData(dateKey);
  if (!worldCup.matches.length && !friendly.matches.length) return matches;
  return dedupeServedMatches([...matches, ...worldCup.matches, ...friendly.matches]);
}

function normalizeServedMatchStatus(match: any) {
  const status = String(match?.status || "NS").toUpperCase();
  const hasScore = typeof match?.score === "string" && match.score.includes("-");
  const settledStatuses = new Set(["FT", "AET", "PEN", "LIVE", "HT", "RESULT_PENDING"]);
  if (hasScore || settledStatuses.has(status)) return match;

  const kickoffMs = Date.parse(match?.kickoff || match?.date || "");
  const isKickoffKnown = Number.isFinite(kickoffMs);
  const isPastResultWindow = isKickoffKnown && Date.now() - kickoffMs > 150 * 60 * 1000;

  if (!isPastResultWindow) return match;

  return {
    ...match,
    status: "RESULT_PENDING",
    resultPending: true,
    resultPendingReason: "Wedstrijd is voorbij, maar de gratis bron heeft nog geen eindstand geleverd.",
  };
}

function attachReviewAndNormalize(match: any, store: any) {
  return normalizeServedMatchStatus(applyVerifiedResultBackfill(attachReview(match, store)));
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
  const today = todayAmsterdamKey();
  const targetDate = typeof date === "string" && date ? date : today;
  const isLiveSensitiveRequest = targetDate === today || live === "true";

  setCorsHeaders(req, res);
  res.setHeader(
    "Cache-Control",
    isLiveSensitiveRequest ? "no-store" : "s-maxage=120, stale-while-revalidate=60"
  );

  try {
    const biweeklyDigest = await readBiweeklyDigest();
    const rufloReport = await readRufloReport();
    const meta = await readSplitMeta();

    if (days && typeof days === "string") {
      const numDays = parseInt(days, 10);
      if (!isNaN(numDays) && numDays > 0 && numDays <= 7) {
        const multiDayMatches: any[] = [];
        let sourceBranch = "split-data";

        try {
          for (let i = -Math.floor(numDays / 2); i <= Math.floor(numDays / 2); i++) {
            const dateStr = addDaysToDateKey(targetDate, i);
            const day = await readSplitDay(dateStr);
            sourceBranch = day.branch || sourceBranch;
            multiDayMatches.push(...day.matches.map((match: any) => attachReviewAndNormalize(match, day.reviews)));
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

        const uniqueMultiDayMatches = dedupeServedMatches(multiDayMatches);

      return res.status(200).json({
          ok: true,
          matches: uniqueMultiDayMatches,
          events: uniqueMultiDayMatches,
          total: uniqueMultiDayMatches.length,
          date: targetDate,
          dateRange: `${numDays} dagen`,
          lastRun: meta.lastRun || null,
          workerVersion: meta.workerVersion || "unknown",
          reviewCount: meta.reviewCount || 0,
          teamLearningCount: meta.teamLearningCount || 0,
          aiAdvice: meta.aiAdvice || [],
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
          worldCup2026Readiness: meta.worldCup2026Readiness || getWorldCup2026ReadinessSnapshot(),
          worldCup2026Projection: meta.worldCup2026Projection || null,
          worldCup2026Ratings: meta.worldCup2026Ratings || null,
          biweeklyDigest,
          rufloReport,
          sourceBranch,
          source: "github-worker-v4-split-multiday",
          durationMs: Date.now() - started,
        });
      }
    }

    let baseMatches: any[] = [];
    let lastRun = meta.lastRun || null;
    let workerVersion = meta.workerVersion || "unknown";
    let sourceBranch = "split-data";

    try {
      const day = await readSplitDay(targetDate);
      baseMatches = day.matches.map((match: any) => attachReviewAndNormalize(match, day.reviews));
      lastRun = day.lastRun || lastRun;
      workerVersion = day.workerVersion || workerVersion;
      sourceBranch = day.branch || sourceBranch;
    } catch {
      const { store, branch } = await fetchServerStore();
      baseMatches = (store.matches?.[targetDate] || []).map((match: any) => attachReviewAndNormalize(match, store));
      lastRun = store.lastRun || lastRun;
      workerVersion = store.workerVersion || workerVersion;
      sourceBranch = branch;
    }

    const uniqueBaseMatches = mergeWorldCupSeed(targetDate, baseMatches);

    const matches = live === "true"
      ? uniqueBaseMatches.filter((m: any) => String(m.status || "").toUpperCase() === "LIVE")
      : uniqueBaseMatches;

    return res.status(200).json({
      ok: true,
      matches,
      events: matches,
      total: matches.length,
      date: targetDate,
      lastRun,
      workerVersion,
      reviewCount: meta.reviewCount || 0,
      teamLearningCount: meta.teamLearningCount || 0,
      aiAdvice: meta.aiAdvice || [],
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
      worldCup2026Readiness: meta.worldCup2026Readiness || getWorldCup2026ReadinessSnapshot(),
      worldCup2026Projection: meta.worldCup2026Projection || null,
      worldCup2026Ratings: meta.worldCup2026Ratings || null,
      biweeklyDigest,
      rufloReport,
      sourceBranch,
      source: matches.length ? "github-worker-v4-split" : "no-matches-yet",
      message: matches.length ? null : "Nog geen wedstrijden gevonden voor deze dag in de actuele workerdata.",
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


