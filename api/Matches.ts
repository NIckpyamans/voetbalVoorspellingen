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
import { buildResponseLineage, inferResponseSource } from "../shared/responseLineage.js";

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

function baseDetailMatch(match: any) {
  return {
    id: match.id,
    date: match.date,
    kickoff: match.kickoff,
    status: match.status,
    score: match.score,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    minute: match.minute,
    league: match.league,
    roundLabel: match.roundLabel,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    homeTeamName: match.homeTeamName,
    awayTeamName: match.awayTeamName,
    homeLogo: match.homeLogo,
    awayLogo: match.awayLogo,
    homeForm: match.homeForm,
    awayForm: match.awayForm,
    homeClubElo: match.homeClubElo,
    awayClubElo: match.awayClubElo,
    homePos: match.homePos,
    awayPos: match.awayPos,
    aggregate: match.aggregate,
    review: match.review,
  };
}

function compactPlayer(player: any) {
  if (!player || typeof player !== "object") return null;
  const rawPlayer = player.player || {};
  const name = String(player.name || rawPlayer.name || "").trim();
  if (!name) return null;
  return {
    name,
    position: player.position || rawPlayer.position || null,
    shirtNumber: player.shirtNumber || player.jerseyNumber || rawPlayer.jerseyNumber || null,
    nationality: player.nationality || rawPlayer.nationality || "",
    availability: player.availability || player.status || "beschikbaar",
    status: player.status || player.availability || null,
    loan: Boolean(player.loan),
    source: player.source || null,
  };
}

function compactPlayers(players: any, limit = 28) {
  return (Array.isArray(players) ? players : [])
    .map(compactPlayer)
    .filter(Boolean)
    .slice(0, limit);
}

function compactLineupSide(side: any) {
  if (!side || typeof side !== "object") return null;
  return {
    confirmed: Boolean(side.confirmed),
    projected: Boolean(side.projected),
    formation: side.formation || null,
    starters: side.starters || side.players?.length || side.startingXI?.length || null,
    bench: side.bench ?? null,
    avgRating: side.avgRating ?? null,
    keeperName: side.keeperName || null,
    players: compactPlayers(side.players || side.startersList || side.startingXI, 16),
    startersList: compactPlayers(side.startersList, 16),
    startingXI: compactPlayers(side.startingXI, 16),
  };
}

function compactLineupSummary(lineup: any) {
  if (!lineup || typeof lineup !== "object") return null;
  return {
    confirmed: Boolean(lineup.confirmed),
    projected: Boolean(lineup.projected),
    source: lineup.source || null,
    summary: lineup.summary || null,
    historicalBackfill: Boolean(lineup.historicalBackfill),
    preMatchUsable: lineup.preMatchUsable !== false,
    captureTiming: lineup.captureTiming || null,
    capturedAt: lineup.capturedAt || null,
    retrievedAt: lineup.retrievedAt || null,
    homeContinuity: lineup.homeContinuity ?? null,
    awayContinuity: lineup.awayContinuity ?? null,
    homeFormation: lineup.homeFormation || null,
    awayFormation: lineup.awayFormation || null,
    homeChanges: lineup.homeChanges ?? null,
    awayChanges: lineup.awayChanges ?? null,
    home: compactLineupSide(lineup.home),
    away: compactLineupSide(lineup.away),
  };
}

function compactLineupProfile(profile: any) {
  if (!profile || typeof profile !== "object") return null;
  const squad = profile.squad || profile;
  return {
    pointsPerGame: profile.pointsPerGame ?? null,
    teamStrengthRating: profile.teamStrengthRating ?? squad.rating ?? null,
    rating: squad.rating ?? profile.rating ?? null,
    source: squad.source || profile.source || null,
    sources: Array.isArray(squad.sources) ? squad.sources.slice(0, 4) : undefined,
    playerCount: squad.playerCount || (Array.isArray(squad.players) ? squad.players.length : undefined),
    squad: {
      source: squad.source || profile.source || null,
      sources: Array.isArray(squad.sources) ? squad.sources.slice(0, 4) : undefined,
      rating: squad.rating ?? profile.teamStrengthRating ?? profile.rating ?? null,
      playerCount: squad.playerCount || (Array.isArray(squad.players) ? squad.players.length : undefined),
      players: compactPlayers(squad.players, 28),
    },
  };
}

function compactInjuries(injuries: any) {
  if (!injuries || typeof injuries !== "object") return null;
  return {
    injuredCount: injuries.injuredCount ?? injuries.count ?? 0,
    count: injuries.count ?? injuries.injuredCount ?? 0,
    suspendedCount: injuries.suspendedCount ?? 0,
    doubtsCount: injuries.doubtsCount ?? 0,
    keyPlayers: Array.isArray(injuries.keyPlayers) ? injuries.keyPlayers.slice(0, 8) : undefined,
    injuredPlayers: compactPlayers(injuries.injuredPlayers, 10),
    keyPlayersMissing: compactPlayers(injuries.keyPlayersMissing, 10),
    suspendedPlayers: compactPlayers(injuries.suspendedPlayers, 10),
  };
}

function compactFormSplit(split: any) {
  if (!split || typeof split !== "object") return null;
  return {
    avgScored: split.avgScored ?? null,
    avgConceded: split.avgConceded ?? null,
    winRate: split.winRate ?? null,
    over25Rate: split.over25Rate ?? null,
  };
}

function compactRecentForm(recent: any) {
  if (!recent || typeof recent !== "object") return null;
  return {
    form: recent.form || null,
    source: recent.source || null,
    gamesPlayed: recent.gamesPlayed ?? null,
    wins: recent.wins ?? null,
    draws: recent.draws ?? null,
    losses: recent.losses ?? null,
    cleanSheetRate: recent.cleanSheetRate ?? null,
    failToScoreRate: recent.failToScoreRate ?? null,
    bttsRate: recent.bttsRate ?? null,
    yellowCardRate: recent.yellowCardRate ?? null,
    redCardRate: recent.redCardRate ?? null,
    strongestSide: recent.strongestSide || null,
    formTrend: recent.formTrend || null,
    momentum: recent.momentum ?? null,
    splits: {
      home: compactFormSplit(recent.splits?.home),
      away: compactFormSplit(recent.splits?.away),
    },
    recentMatches: (Array.isArray(recent.recentMatches) ? recent.recentMatches : [])
      .slice(-10)
      .map((item: any) => ({
        date: item.date || null,
        venue: item.venue || null,
        opponent: item.opponent || null,
        score: item.score || null,
        result: item.result || null,
      })),
  };
}

function compactFormProfile(profile: any) {
  if (!profile || typeof profile !== "object") return null;
  return {
    pointsPerGame: profile.pointsPerGame ?? null,
    consistency: profile.consistency ?? null,
    strongestSide: profile.strongestSide || null,
    attackTrend: profile.attackTrend || null,
    setPieceScore: profile.setPieceScore ?? null,
    cornersTrend: profile.cornersTrend ?? null,
    fatigueIndex: profile.fatigueIndex ?? null,
  };
}

function compactLearningSummary(summary: any) {
  if (!summary || typeof summary !== "object") return null;
  return {
    summary: summary.summary || null,
    homeOutcomeHitRate: summary.homeOutcomeHitRate ?? null,
    awayOutcomeHitRate: summary.awayOutcomeHitRate ?? null,
    homeBias: summary.homeBias ?? null,
    awayBias: summary.awayBias ?? null,
    combinedReliability: summary.combinedReliability ?? null,
  };
}

function compactDetailMatch(match: any, section: string) {
  const base = baseDetailMatch(match);
  if (section === "h2h") {
    return { ...base, h2h: match.h2h, h2hStatus: match.h2hStatus };
  }
  if (section === "opstelling") {
    return {
      ...base,
      lineupSummary: compactLineupSummary(match.lineupSummary),
      homeTeamProfile: compactLineupProfile(match.homeTeamProfile),
      awayTeamProfile: compactLineupProfile(match.awayTeamProfile),
      homeInjuries: compactInjuries(match.homeInjuries),
      awayInjuries: compactInjuries(match.awayInjuries),
    };
  }
  if (section === "vorm") {
    return {
      ...base,
      homeRecent: compactRecentForm(match.homeRecent),
      awayRecent: compactRecentForm(match.awayRecent),
      homeTeamProfile: compactFormProfile(match.homeTeamProfile),
      awayTeamProfile: compactFormProfile(match.awayTeamProfile),
      learningSummary: compactLearningSummary(match.learningSummary),
    };
  }
  if (section === "markten") {
    return {
      ...base,
      odds: match.odds,
      oddsAtPrediction: match.oddsAtPrediction,
      marketCalibration: match.marketCalibration,
      modelEdges: match.modelEdges
        ? {
            marketCalibration: match.modelEdges.marketCalibration,
            leagueReliability: match.modelEdges.leagueReliability,
            phaseReliability: match.modelEdges.phaseReliability,
          }
        : null,
    };
  }
  return {
    ...base,
    context: match.context,
    weather: match.weather,
    h2hStatus: match.h2hStatus,
    homeRestDays: match.homeRestDays,
    awayRestDays: match.awayRestDays,
    modelEdges: match.modelEdges
      ? {
          riskProfile: match.modelEdges.riskProfile,
          modelAgreement: match.modelEdges.modelAgreement,
          clubEloDiff: match.modelEdges.clubEloDiff,
          tacticalMismatch: match.modelEdges.tacticalMismatch,
          formShift: match.modelEdges.formShift,
          keeperEdge: match.modelEdges.keeperEdge,
          travelEdge: match.modelEdges.travelEdge,
          lineupImpact: match.modelEdges.lineupImpact,
          phaseReliability: match.modelEdges.phaseReliability,
        }
      : null,
  };
}

function detailIdentityText(value: any) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameDetailFixture(a: any, b: any) {
  return Boolean(a && b) &&
    detailIdentityText(a.league) === detailIdentityText(b.league) &&
    detailIdentityText(a.homeTeamName) === detailIdentityText(b.homeTeamName) &&
    detailIdentityText(a.awayTeamName) === detailIdentityText(b.awayTeamName);
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
  const section = String(req.query?.section || "").toLowerCase();
  const sectionDetailRequest = detailRequest && ["analyse", "opstelling", "h2h", "vorm", "markten"].includes(section);
  const full = view === "full" || view === "debug" || (detailRequest && !sectionDetailRequest);
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

        const responseSource = sourceBranch === "postgres" ? "postgres-database-multiday" : "github-worker-v4-split-multiday";
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
          source: responseSource,
          dataLineage: buildResponseLineage({ sourceBranch, matchCount: responseMatches.length, meta, source: responseSource }),
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
    let selectedMatches = detailRequest
      ? matches.filter((match: any) => String(match?.id || "") === detailMatchId)
      : matches;
    if (detailRequest && selectedMatches.length === 0 && !isLiveSensitiveRequest) {
      const cachedDay = await readDashboardDayCache(targetDate).catch(() => null);
      const cachedMatches = (cachedDay?.matches || []).map((match: any) => attachReviewAndNormalize(match, {}));
      const cachedMatch = cachedMatches.find((match: any) => String(match?.id || "") === detailMatchId);
      if (cachedMatch) {
        const fullMatch = matches.find((match: any) => sameDetailFixture(match, cachedMatch));
        selectedMatches = [{ ...cachedMatch, ...(fullMatch || {}) }];
        sourceBranch = fullMatch ? `${sourceBranch}-identity-fallback` : "r2-dashboard-cache-detail-fallback";
        lastRun = cachedDay.generatedAt || lastRun;
      }
    }
    const responseMatches = sectionDetailRequest
      ? selectedMatches.map((match: any) => compactDetailMatch(match, section))
      : full ? selectedMatches : selectedMatches.map(compactDashboardMatch);

    const responseSource = inferResponseSource(sourceBranch, responseMatches.length);
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
      source: responseSource,
      dataLineage: buildResponseLineage({ sourceBranch, matchCount: responseMatches.length, meta, source: responseSource }),
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


