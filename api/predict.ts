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

function enrichPrediction(prediction: any, matchMap: Record<string, any>, store: any) {
  const match = matchMap[prediction.matchId] || null;
  const dbFeatureContext = prediction.dbFeatureContext || match?.dbFeatureContext || null;
  return {
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
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  setCorsHeaders(req, res);
  res.setHeader("Cache-Control", "no-store");

  try {
    const date = (req.query?.date as string) || todayAmsterdamKey();
    let predictions: any[] = [];
    let matches: any[] = [];
    let reviews: Record<string, any> = {};
    let branch = "split-data";
    let lastRun: number | null = null;
    let reviewCount = 0;

    try {
      const cachedDay = await readDashboardDayCache(date).catch(() => null);
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

    const matchMap = Object.fromEntries(matches.map((match: any) => [match.id, { ...match, review: reviews?.[match.id] || null }]));
    const splitStore = { postMatchReviews: reviews };

    return res.status(200).json({
      ok: true,
      date,
      predictions: predictions.map((prediction) => enrichPrediction(prediction, matchMap, splitStore)),
      total: predictions.length,
      source: predictions.length && branch === "postgres"
        ? "postgres-prediction-snapshots"
        : predictions.length && branch === "r2-dashboard-cache"
          ? "cloudflare-r2-dashboard-cache"
          : predictions.length ? "server-data-v6-split-review-market" : "none",
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

