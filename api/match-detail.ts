import { fetchDayData, fetchServerStore } from "./_dataSource.js";
import { todayAmsterdamKey } from "../shared/date.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";
import { databaseConfigured, readDatabaseDay } from "../shared/database.js";
import { filterVisibleMatches, filterVisiblePredictions } from "../shared/competitionVisibility.js";

const logger = createLogger("api.match-detail");

function matchIdEquals(value: unknown, target: string) {
  return String(value || "") === target;
}

function selectDetail(day: any, matchId: string) {
  const matches = filterVisibleMatches(Array.isArray(day?.matches) ? day.matches : []);
  const match = matches.find((item: any) => matchIdEquals(item?.id, matchId)) || null;
  const predictions = filterVisiblePredictions(Array.isArray(day?.predictions) ? day.predictions : [], matches);
  const prediction =
    predictions.find((item: any) => matchIdEquals(item?.matchId, matchId)) ||
    (match ? match.prediction || null : null);
  const reviews = day?.reviews || day?.postMatchReviews || {};
  const review = reviews?.[matchId] || match?.review || prediction?.review || null;
  return {
    match: match ? { ...match, review } : null,
    prediction: prediction ? { ...prediction, review } : null,
  };
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  setCorsHeaders(req, res);
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");

  const date = String(req.query?.date || todayAmsterdamKey()).slice(0, 10);
  const matchId = String(req.query?.matchId || req.query?.id || "");

  if (!matchId) {
    return res.status(400).json({ ok: false, error: "matchId ontbreekt", durationMs: Date.now() - started });
  }

  try {
    let source = "split-data";
    let detail = { match: null as any, prediction: null as any };
    const useDatabaseFallback =
      req.query?.db === "true" ||
      req.query?.source === "db" ||
      process.env.MATCH_DETAIL_DB_FALLBACK === "true";

    const dayResponse = await fetchDayData(date);
    detail = selectDetail(dayResponse.data || {}, matchId);
    source = dayResponse.branch || source;

    if (!detail.match && !detail.prediction) {
      const full = await fetchServerStore();
      const store = full.store || {};
      detail = selectDetail(
        {
          matches: store.matches?.[date] || [],
          predictions: store.predictions?.[date] || [],
          reviews: store.postMatchReviews || {},
        },
        matchId
      );
      source = full.branch || source;
    }

    if (!detail.match && !detail.prediction && useDatabaseFallback && databaseConfigured()) {
      const dbDay = await readDatabaseDay(date).catch(() => null);
      detail = selectDetail(dbDay, matchId);
      if (detail.match || detail.prediction) source = "postgres-database";
    }

    return res.status(200).json({
      ok: true,
      date,
      matchId,
      ...detail,
      found: Boolean(detail.match || detail.prediction),
      source,
      durationMs: Date.now() - started,
    });
  } catch (err: any) {
    logger.error("match_detail_failed", { date, matchId, durationMs: Date.now() - started, error: getErrorDetails(err) });
    return res.status(500).json({ ok: false, error: err?.message || "unknown", durationMs: Date.now() - started });
  }
}
