import { fetchDayData, fetchMetaData, fetchServerStore } from "./_dataSource.js";
import { todayAmsterdamKey } from "../shared/date.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";
import { databaseConfigured, readDatabaseDay } from "../shared/database.js";
import { filterVisibleMatches, filterVisiblePredictions } from "../shared/competitionVisibility.js";
import { readDashboardDayCache } from "../shared/dashboardR2Cache.js";

const logger = createLogger("api.predict");

function impliedOdds(prob: number | undefined) {
  const p = Number(prob || 0);
  if (!p || p <= 0.01) return null;
  return Number((1 / p).toFixed(2));
}

function buildDerivedOdds(prediction: any) {
  return {
    home: impliedOdds(prediction.homeProb),
    draw: impliedOdds(prediction.drawProb),
    away: impliedOdds(prediction.awayProb),
  };
}

function buildValueFlags(prediction: any) {
  const odds = prediction.odds || {};
  const compare = (modelProb: number, marketOdd?: number | string | null) => {
    const odd = Number(marketOdd);
    if (!Number.isFinite(odd) || odd <= 1.01) return null;
    const marketProb = 1 / odd;
    const edge = modelProb - marketProb;
    return {
      edge: Number(edge.toFixed(4)),
      edgePct: Number((edge * 100).toFixed(1)),
      value: edge >= 0.04,
    };
  };

  return {
    derived: buildDerivedOdds(prediction),
    home: compare(Number(prediction.homeProb || 0), odds.home),
    draw: compare(Number(prediction.drawProb || 0), odds.draw),
    away: compare(Number(prediction.awayProb || 0), odds.away),
  };
}

function compactScoreMatrix(scoreMatrix: any) {
  if (!scoreMatrix || typeof scoreMatrix !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(scoreMatrix)
      .sort((a: any, b: any) => Number(b[1] || 0) - Number(a[1] || 0))
      .slice(0, 6)
  );
}

function compactModelEdges(modelEdges: any) {
  if (!modelEdges || typeof modelEdges !== "object") return undefined;
  return {
    clubEloDiff: modelEdges.clubEloDiff,
    rest: modelEdges.rest,
    riskProfile: modelEdges.riskProfile,
    modelAgreement: modelEdges.modelAgreement,
    modelAgreementPenalty: modelEdges.modelAgreementPenalty,
    lineupImpact: modelEdges.lineupImpact,
    lineupAdjustment: modelEdges.lineupAdjustment,
    lineupUncertaintyPenalty: modelEdges.lineupUncertaintyPenalty,
    tacticalMismatch: modelEdges.tacticalMismatch,
    formShift: modelEdges.formShift,
    travelEdge: modelEdges.travelEdge,
    keeperEdge: modelEdges.keeperEdge,
    learningEdge: modelEdges.learningEdge,
    marketCalibration: modelEdges.marketCalibration,
    leagueReliability: modelEdges.leagueReliability,
    phaseReliability: modelEdges.phaseReliability,
    refereeProfile: modelEdges.refereeProfile,
    sourceReliability: modelEdges.sourceReliability,
    dataCompleteness: modelEdges.dataCompleteness,
    qualityGate: modelEdges.qualityGate,
    featureImportance: Array.isArray(modelEdges.featureImportance)
      ? modelEdges.featureImportance.slice(0, 8)
      : modelEdges.featureImportance,
    leagueCalibration: modelEdges.leagueCalibration,
    confidenceCalibration: modelEdges.confidenceCalibration,
    modelWarnings: Array.isArray(modelEdges.modelWarnings)
      ? modelEdges.modelWarnings.slice(0, 4)
      : modelEdges.modelWarnings,
    teamAiSummary: modelEdges.teamAiSummary,
  };
}

function compactPrediction(prediction: any) {
  return {
    matchId: prediction.matchId,
    model: prediction.model,
    predHomeGoals: prediction.predHomeGoals,
    predAwayGoals: prediction.predAwayGoals,
    homeProb: prediction.homeProb,
    drawProb: prediction.drawProb,
    awayProb: prediction.awayProb,
    confidence: prediction.confidence,
    exactProb: prediction.exactProb,
    exactScoreConfidence: prediction.exactScoreConfidence,
    exactScoreReasons: Array.isArray(prediction.exactScoreReasons)
      ? prediction.exactScoreReasons.slice(0, 4)
      : prediction.exactScoreReasons,
    bestBetRank: prediction.bestBetRank,
    topConfidencePick: prediction.topConfidencePick,
    topExactScorePick: prediction.topExactScorePick,
    topExactReasons: Array.isArray(prediction.topExactReasons)
      ? prediction.topExactReasons.slice(0, 4)
      : prediction.topExactReasons,
    homeXG: prediction.homeXG,
    awayXG: prediction.awayXG,
    over15: prediction.over15,
    over25: prediction.over25,
    over35: prediction.over35,
    btts: prediction.btts,
    homeForm: prediction.homeForm,
    awayForm: prediction.awayForm,
    homeRecent: prediction.homeRecent,
    awayRecent: prediction.awayRecent,
    weather: prediction.weather,
    h2h: prediction.h2h,
    h2hStatus: prediction.h2hStatus,
    aggregate: prediction.aggregate,
    context: prediction.context ? { summary: prediction.context.summary } : null,
    homeRestDays: prediction.homeRestDays,
    awayRestDays: prediction.awayRestDays,
    homeClubElo: prediction.homeClubElo,
    awayClubElo: prediction.awayClubElo,
    odds: prediction.odds,
    oddsAtPrediction: prediction.oddsAtPrediction,
    derivedOdds: prediction.derivedOdds,
    valueFlags: prediction.valueFlags,
    lineupSummary: prediction.lineupSummary,
    homeTeamProfile: prediction.homeTeamProfile,
    awayTeamProfile: prediction.awayTeamProfile,
    modelEdges: compactModelEdges(prediction.modelEdges),
    ensembleMeta: prediction.ensembleMeta,
    learningSummary: prediction.learningSummary,
    marketCalibration: prediction.marketCalibration,
    dataCompleteness: prediction.dataCompleteness,
    qualityGate: prediction.qualityGate,
    freeSourceCoverage: prediction.freeSourceCoverage,
    featureImportance: Array.isArray(prediction.featureImportance)
      ? prediction.featureImportance.slice(0, 8)
      : prediction.featureImportance,
    scoreMatrix: compactScoreMatrix(prediction.scoreMatrix),
    monteCarlo: prediction.monteCarlo,
    review: prediction.review,
  };
}

function compactPredictionListItem(prediction: any) {
  return {
    matchId: prediction.matchId,
    model: prediction.model,
    predHomeGoals: prediction.predHomeGoals,
    predAwayGoals: prediction.predAwayGoals,
    homeProb: prediction.homeProb,
    drawProb: prediction.drawProb,
    awayProb: prediction.awayProb,
    confidence: prediction.confidence,
    exactProb: prediction.exactProb,
    exactScoreConfidence: prediction.exactScoreConfidence,
    bestBetRank: prediction.bestBetRank,
    topConfidencePick: prediction.topConfidencePick,
    topExactScorePick: prediction.topExactScorePick,
    exactScoreReasons: Array.isArray(prediction.exactScoreReasons)
      ? prediction.exactScoreReasons.slice(0, 2)
      : prediction.exactScoreReasons,
    topExactReasons: Array.isArray(prediction.topExactReasons)
      ? prediction.topExactReasons.slice(0, 2)
      : prediction.topExactReasons,
    odds: prediction.odds
      ? {
          home: prediction.odds.home,
          draw: prediction.odds.draw,
          away: prediction.odds.away,
          provider: prediction.odds.provider || null,
          bookmaker: prediction.odds.bookmaker || null,
        }
      : null,
    h2hStatus: prediction.h2hStatus,
    lineupSummary: prediction.lineupSummary
      ? {
          confirmed: Boolean(prediction.lineupSummary.confirmed),
          projected: Boolean(prediction.lineupSummary.projected),
          source: prediction.lineupSummary.source || null,
        }
      : null,
    dataCompletenessScore:
      prediction.dataCompletenessScore ??
      prediction.dataCompleteness?.score ??
      null,
    dataCompleteness: prediction.dataCompleteness
      ? {
          score: prediction.dataCompleteness.score,
          percent: prediction.dataCompleteness.percent,
          status: prediction.dataCompleteness.status,
        }
      : null,
    qualityGate: prediction.qualityGate
      ? {
          summary: prediction.qualityGate.summary,
          blockedHighConfidence: prediction.qualityGate.blockedHighConfidence,
          confidenceCap: prediction.qualityGate.confidenceCap,
        }
      : null,
  };
}

function enrichPrediction(prediction: any, matchMap: Record<string, any>, store: any, full = false) {
  const match = matchMap[prediction.matchId] || null;
  const dbFeatureContext = prediction.dbFeatureContext || match?.dbFeatureContext || null;
  const enriched = {
    ...prediction,
    derivedOdds: buildDerivedOdds(prediction),
    valueFlags: buildValueFlags(prediction),
    odds: prediction.odds || null,
    weather: prediction.weather || match?.weather || null,
    lineupSummary: prediction.lineupSummary || match?.lineupSummary || null,
    h2h: prediction.h2h || match?.h2h || null,
    h2hStatus: prediction.h2hStatus || match?.h2hStatus || "empty",
    aggregate: prediction.aggregate || match?.aggregate || null,
    context: prediction.context || match?.context || null,
    homeRestDays:
      prediction.homeRestDays != null ? prediction.homeRestDays : match?.homeRestDays ?? null,
    awayRestDays:
      prediction.awayRestDays != null ? prediction.awayRestDays : match?.awayRestDays ?? null,
    homeClubElo:
      prediction.homeClubElo != null ? prediction.homeClubElo : match?.homeClubElo ?? null,
    awayClubElo:
      prediction.awayClubElo != null ? prediction.awayClubElo : match?.awayClubElo ?? null,
    modelEdges: {
      ...(match?.modelEdges || {}),
      ...(prediction.modelEdges || {}),
      databaseFeatures: dbFeatureContext
        ? {
            sources: dbFeatureContext.featureSources || [],
            hasMatchStats: Boolean(dbFeatureContext.matchStats?.statsSource),
            hasTeamMatchStats: Boolean(dbFeatureContext.teamMatchStats?.length),
            historicalOddsSamples: Number(dbFeatureContext.historicalOdds?.samples || 0),
          }
        : null,
    },
    homeTeamProfile: prediction.homeTeamProfile || match?.homeTeamProfile || null,
    awayTeamProfile: prediction.awayTeamProfile || match?.awayTeamProfile || null,
    featureVector: prediction.featureVector || match?.featureVector || null,
    ensembleMeta: prediction.ensembleMeta || match?.ensembleMeta || null,
    learningSummary: prediction.learningSummary || match?.learningSummary || null,
    marketCalibration: prediction.marketCalibration || match?.marketCalibration || null,
    dbFeatureContext,
    review: prediction.review || match?.review || store.postMatchReviews?.[prediction.matchId] || null,
    match,
  };
  return full ? enriched : compactPredictionListItem(enriched);
}

function latestPredictionPerMatch(predictions: any[]) {
  const byMatch = new Map<string, any>();
  for (const prediction of predictions || []) {
    if (!prediction?.matchId) continue;
    byMatch.set(prediction.matchId, prediction);
  }
  return [...byMatch.values()];
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  setCorsHeaders(req, res);
  res.setHeader("Cache-Control", "no-store");

  try {
    const date = (req.query?.date as string) || todayAmsterdamKey();
    const view = String(req.query?.view || req.query?.mode || "compact").toLowerCase();
    const matchId = req.query?.matchId || req.query?.id || null;
    const full = view === "full" || view === "debug" || Boolean(matchId);
    let predictions: any[] = [];
    let matches: any[] = [];
    let reviews: Record<string, any> = {};
    let branch = "split-data";
    let lastRun: number | null = null;
    let reviewCount = 0;

    try {
      const cachedDay = full ? null : await readDashboardDayCache(date).catch(() => null);
      if (cachedDay?.predictions?.length || cachedDay?.matches?.length) {
        predictions = cachedDay.predictions || [];
        matches = cachedDay.matches || [];
        branch = "r2-dashboard-cache";
        lastRun = cachedDay.generatedAt || null;
      } else {
      const dbDay = databaseConfigured() ? await readDatabaseDay(date).catch(() => null) : null;
      if (dbDay?.matches?.length || dbDay?.predictions?.length) {
        predictions = dbDay.predictions || [];
        matches = dbDay.matches || [];
        branch = "postgres";
      } else {
      const [dayResponse, metaResponse] = await Promise.all([
        fetchDayData(date),
        fetchMetaData().catch(() => ({ data: {}, branch: "split-data" })),
      ]);
      const day = dayResponse.data || {};
      const meta = metaResponse.data || {};
      predictions = Array.isArray(day.predictions) ? day.predictions : [];
      matches = Array.isArray(day.matches) ? day.matches : [];
      reviews = day.reviews || {};
      branch = dayResponse.branch || branch;
      lastRun = day.lastRun || meta.lastRun || null;
      reviewCount = Number(meta.reviewCount || Object.keys(reviews).length || 0);
      }
      }
    } catch {
      const full = await fetchServerStore();
      const store = full.store || {};
      branch = full.branch;
      predictions = store.predictions?.[date] || [];
      matches = store.matches?.[date] || [];
      reviews = store.postMatchReviews || {};
      lastRun = store.lastRun || null;
      reviewCount = Object.keys(reviews || {}).length;
    }

    matches = filterVisibleMatches(matches);
    predictions = filterVisiblePredictions(predictions, matches);
    if (matchId) {
      const wanted = String(matchId);
      matches = matches.filter((match: any) => String(match.id) === wanted);
      predictions = predictions.filter((prediction: any) => String(prediction.matchId) === wanted);
    }
    const rawTotal = predictions.length;
    const responsePredictions = full ? predictions : latestPredictionPerMatch(predictions);

    const matchMap = Object.fromEntries(matches.map((match: any) => [match.id, { ...match, review: reviews?.[match.id] || null }]));
    const splitStore = { postMatchReviews: reviews };

    return res.status(200).json({
      ok: true,
      date,
      predictions: responsePredictions.map((prediction) => enrichPrediction(prediction, matchMap, splitStore, full)),
      total: responsePredictions.length,
      rawTotal,
      matchId: matchId ? String(matchId) : null,
      found: matchId ? responsePredictions.length > 0 : undefined,
      view: full ? "full" : "compact",
      source: responsePredictions.length && branch === "postgres"
        ? "postgres-prediction-snapshots"
        : responsePredictions.length && branch === "r2-dashboard-cache"
          ? "cloudflare-r2-dashboard-cache"
          : responsePredictions.length ? "server-data-v6-split-review-market" : "none",
      sourceBranch: branch,
      lastRun,
      reviewCount,
      durationMs: Date.now() - started,
    });
  } catch (err: any) {
    logger.error("predict_failed", { durationMs: Date.now() - started, error: getErrorDetails(err) });
    return res.status(500).json({ ok: false, error: err?.message || "unknown", durationMs: Date.now() - started });
  }
}

