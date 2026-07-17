import { fetchServerStore } from "./_dataSource.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";
import { databaseConfigured, getSql } from "../shared/database.js";
import { readR2SnapshotLedger } from "../shared/predictionSnapshotLedger.js";

const logger = createLogger("api.prediction-snapshots");

function compactSnapshot(snapshot: any) {
  if (!snapshot) return null;
  return {
    predictionId: snapshot.predictionId,
    matchId: snapshot.matchId,
    generatedAt: snapshot.generatedAt,
    cutoffAt: snapshot.cutoffAt,
    kickoff: snapshot.kickoff,
    status: snapshot.status,
    schemaVersion: snapshot.schemaVersion,
    featureSchemaVersion: snapshot.featureSchemaVersion,
    modelVersion: snapshot.modelVersion,
    algorithmVersion: snapshot.algorithmVersion,
    workerVersion: snapshot.workerVersion,
    date: snapshot.date,
    league: snapshot.league,
    season: snapshot.season,
    homeTeam: snapshot.homeTeam,
    awayTeam: snapshot.awayTeam,
    homeTeamId: snapshot.homeTeamId || null,
    awayTeamId: snapshot.awayTeamId || null,
    teamIdentity: snapshot.teamIdentity || snapshot.inputSnapshot?.teamIdentity || null,
    inputSnapshotHash: snapshot.inputSnapshotHash,
    inputSnapshot: snapshot.inputSnapshot || null,
    features: snapshot.features || null,
    probabilities: snapshot.probabilities || null,
    confidence: snapshot.confidence ?? null,
    confidenceRaw: snapshot.confidenceRaw ?? null,
    calibration: snapshot.calibration || null,
    expectedScore: snapshot.expectedScore || null,
    explanation: snapshot.explanation || null,
    oddsAtPrediction: snapshot.oddsAtPrediction || null,
    oddsStatus: snapshot.oddsStatus || null,
    oddsMissingReason: snapshot.oddsMissingReason || null,
    oddsProviderStatus: snapshot.oddsProviderStatus || null,
    oddsProviderDiagnostics: snapshot.oddsProviderDiagnostics || null,
    roiStatus: snapshot.roiStatus || null,
    clvStatus: snapshot.clvStatus || null,
    sourceAsOf: snapshot.inputSnapshot?.sourceAsOf || null,
    lineupStatus: snapshot.inputSnapshot?.lineupStatus || null,
    refereeStatus: snapshot.inputSnapshot?.refereeStatus || null,
    featureSourceMetadata: snapshot.featureSourceMetadata || snapshot.inputSnapshot?.featureSourceMetadata || null,
    leakageGuard: snapshot.leakageGuard || null,
    dataCompleteness: snapshot.dataCompleteness || null,
    missingData: snapshot.missingData || [],
  };
}

function buildSnapshotSummary(snapshots: Record<string, any>, evaluations: Record<string, any> = {}) {
  const items = Object.values(snapshots || {});
  const evaluatedMatchIds = new Set(Object.keys(evaluations || {}));
  const byModel = new Map<string, number>();
  const byLeague = new Map<string, number>();
  let featureBytes = 0;
  let withOdds = 0;
  let withSnapshotHash = 0;
  let evaluated = 0;
  for (const snapshot of items) {
    const model = String(snapshot?.modelVersion || snapshot?.workerVersion || "onbekend");
    const league = String(snapshot?.league || "Onbekend");
    byModel.set(model, (byModel.get(model) || 0) + 1);
    byLeague.set(league, (byLeague.get(league) || 0) + 1);
    if (snapshot?.inputSnapshotHash) withSnapshotHash += 1;
    if (evaluatedMatchIds.has(String(snapshot?.matchId || ""))) evaluated += 1;
    if (snapshot?.oddsAtPrediction || snapshot?.oddsStatus === "available" || snapshot?.oddsStatus === "partial") withOdds += 1;
    featureBytes += Buffer.byteLength(JSON.stringify(snapshot?.features || {}), "utf8");
  }
  return {
    total: items.length,
    evaluated,
    pending: Math.max(0, items.length - evaluated),
    withSnapshotHash,
    withOdds,
    estimatedFeatureBytes: featureBytes,
    latestGeneratedAt: items
      .map((snapshot: any) => snapshot?.generatedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null,
    byModel: [...byModel.entries()].map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    byLeague: [...byLeague.entries()].map(([league, count]) => ({ league, count })).sort((a, b) => b.count - a.count).slice(0, 12),
  };
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  setCorsHeaders(req, res);
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");

  try {
    const predictionId = typeof req.query?.predictionId === "string" ? req.query.predictionId : null;
    const matchId = typeof req.query?.matchId === "string" ? req.query.matchId : null;
    const summaryOnly = req.query?.summary === "1" || req.query?.summary === "true";
    const limit = Math.min(Math.max(Number(req.query?.limit || 25), 1), 100);

    let databaseSummary: any = null;
    try {
      if (databaseConfigured()) {
      const sql = getSql();
      if (sql) {
        if (summaryOnly) {
          const [counts] = await sql.query(`
            select
              (select count(*)::int from prediction_snapshots) as total,
              (select count(*)::int from prediction_evaluations) as evaluated,
              (select count(*)::int from prediction_snapshots ps where ps.input_snapshot_hash is not null) as with_snapshot_hash,
              (select count(*)::int from odds_snapshots where status not in ('missing', 'historical_market_profile_only')) as with_odds,
              (select max(generated_at) from prediction_snapshots) as latest_generated_at
          `);
          databaseSummary = {
            total: Number(counts?.total || 0),
            evaluated: Number(counts?.evaluated || 0),
            pending: Math.max(0, Number(counts?.total || 0) - Number(counts?.evaluated || 0)),
            withSnapshotHash: Number(counts?.with_snapshot_hash || 0),
            withOdds: Number(counts?.with_odds || 0),
            latestGeneratedAt: counts?.latest_generated_at || null,
          };
        } else {
          let rows: any[] = [];
          if (predictionId) {
            rows = await sql.query(
              "select prediction_payload, generated_at from prediction_snapshots where prediction_id = $1 limit 1",
              [predictionId]
            );
          } else if (matchId) {
            rows = await sql.query(
              "select prediction_payload, generated_at from prediction_snapshots where match_id = $1 order by generated_at desc limit $2",
              [matchId, limit]
            );
          } else {
            rows = await sql.query(
              "select prediction_payload, generated_at from prediction_snapshots order by generated_at desc limit $1",
              [limit]
            );
          }
          const items = rows.map((row: any) => compactSnapshot(row.prediction_payload)).filter(Boolean);
          if (items.length) {
            return res.status(200).json({
              ok: true,
              items,
              total: items.length,
              sourceBranch: "postgres",
              workerVersion: items[0]?.modelVersion || "database",
              durationMs: Date.now() - started,
            });
          }
        }
      }
      }
    } catch (databaseError: any) {
      logger.warning("prediction_snapshots_database_fallback", {
        error: getErrorDetails(databaseError),
        fallback: "r2-or-split-store",
      });
    }

    const { store, branch } = await fetchServerStore();
    const r2Ledger = await readR2SnapshotLedger();
    const r2Snapshots = r2Ledger.available ? r2Ledger.ledger.predictionSnapshots || {} : {};
    const snapshots = Object.keys(r2Snapshots).length >= Object.keys(store.predictionSnapshots || {}).length
      ? r2Snapshots
      : store.predictionSnapshots || {};
    const index = snapshots === r2Snapshots ? r2Ledger.ledger.predictionSnapshotIndex || {} : store.predictionSnapshotIndex || {};
    const snapshotBranch = snapshots === r2Snapshots ? "r2-immutable-ledger" : branch;

    if (summaryOnly) {
      const serverSummary = buildSnapshotSummary(snapshots, store.postMatchReviews || {});
      const summary = databaseSummary && Number(databaseSummary.total || 0) >= Number(serverSummary.total || 0)
        ? databaseSummary
        : serverSummary;
      return res.status(200).json({
        ok: true,
        summary,
        sourceBranch: databaseSummary ? `postgres+${snapshotBranch}` : snapshotBranch,
        workerVersion: store.workerVersion || "unknown",
        durationMs: Date.now() - started,
      });
    }

    let items: any[] = [];
    if (predictionId) {
      const snapshot = compactSnapshot(snapshots[predictionId]);
      items = snapshot ? [snapshot] : [];
    } else if (matchId) {
      items = (index[matchId] || [])
        .map((id: string) => compactSnapshot(snapshots[id]))
        .filter(Boolean);
    } else {
      items = Object.values(snapshots)
        .map((snapshot: any) => compactSnapshot(snapshot))
        .filter(Boolean)
        .sort((a: any, b: any) => Date.parse(b.generatedAt || "") - Date.parse(a.generatedAt || ""))
        .slice(0, limit);
    }

    return res.status(200).json({
      ok: true,
      items,
      total: items.length,
      sourceBranch: snapshotBranch,
      workerVersion: store.workerVersion || "unknown",
      durationMs: Date.now() - started,
    });
  } catch (err: any) {
    logger.error("prediction_snapshots_failed", { durationMs: Date.now() - started, error: getErrorDetails(err) });
    return res.status(503).json({
      ok: false,
      items: [],
      total: 0,
      error: err?.message || "Unknown error",
      durationMs: Date.now() - started,
    });
  }
}
