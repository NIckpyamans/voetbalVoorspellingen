import { fetchServerStore } from "./_dataSource.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";
import { databaseConfigured, getSql } from "../shared/database.js";

const logger = createLogger("api.odds-health");

export default async function handler(req: any, res: any) {
  const started = Date.now();
  setCorsHeaders(req, res);
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=120");

  try {
    if (databaseConfigured()) {
      const sql = getSql();
      if (sql) {
        const [summary] = await sql.query(`
          select
            (select count(*)::int from prediction_snapshots) as prediction_snapshots,
            (select count(*)::int from odds_snapshots where status not in ('missing','historical_market_profile_only')) as prediction_odds,
            (select count(*)::int from historical_odds_snapshots where available_before_kickoff = true) as prematch_odds,
            (select count(*)::int from historical_odds_snapshots where closing_captured_at is not null) as closing_odds
        `);
        const gaps = await sql.query(`
          select ps.match_id, ps.generated_at, ps.prediction_payload->>'league' as league,
            ps.prediction_payload->>'homeTeam' as home_team,
            ps.prediction_payload->>'awayTeam' as away_team
          from prediction_snapshots ps
          where not exists (
            select 1 from odds_snapshots os
            where os.prediction_id = ps.prediction_id
              and os.status not in ('missing','historical_market_profile_only')
          )
          order by ps.generated_at desc
          limit 25
        `);
        const total = Number(summary?.prediction_snapshots || 0);
        const withOdds = Number(summary?.prediction_odds || 0);
        return res.status(200).json({
          ok: true,
          summary: {
            predictionSnapshots: total,
            predictionOdds: withOdds,
            missingPredictionOdds: Math.max(0, total - withOdds),
            predictionOddsCoveragePct: total ? Number(((withOdds / total) * 100).toFixed(1)) : 0,
            prematchOdds: Number(summary?.prematch_odds || 0),
            closingOdds: Number(summary?.closing_odds || 0),
          },
          priorityGaps: gaps,
          nextAction: "Run `npm run db:odds:prematch:collect` met provider keys en prioriteer priorityGaps.",
          sourceBranch: "postgres",
          durationMs: Date.now() - started,
        });
      }
    }

    const { store, branch } = await fetchServerStore();
    const snapshots = Object.values(store.predictionSnapshots || {}) as any[];
    const withOdds = snapshots.filter((snapshot) => snapshot?.oddsAtPrediction || snapshot?.oddsStatus === "available" || snapshot?.oddsStatus === "partial").length;
    return res.status(200).json({
      ok: true,
      summary: {
        predictionSnapshots: snapshots.length,
        predictionOdds: withOdds,
        missingPredictionOdds: Math.max(0, snapshots.length - withOdds),
        predictionOddsCoveragePct: snapshots.length ? Number(((withOdds / snapshots.length) * 100).toFixed(1)) : 0,
        prematchOdds: null,
        closingOdds: null,
      },
      priorityGaps: snapshots
        .filter((snapshot) => !(snapshot?.oddsAtPrediction || snapshot?.oddsStatus === "available" || snapshot?.oddsStatus === "partial"))
        .slice(0, 25)
        .map((snapshot) => ({
          matchId: snapshot.matchId,
          generatedAt: snapshot.generatedAt,
          league: snapshot.league,
          homeTeam: snapshot.homeTeam,
          awayTeam: snapshot.awayTeam,
        })),
      nextAction: "Run `npm run db:odds:prematch:collect`; JSON fallback heeft geen database odds table.",
      sourceBranch: branch,
      durationMs: Date.now() - started,
    });
  } catch (err: any) {
    logger.error("odds_health_failed", { durationMs: Date.now() - started, error: getErrorDetails(err) });
    return res.status(503).json({ ok: false, error: err?.message || "Unknown error", durationMs: Date.now() - started });
  }
}
