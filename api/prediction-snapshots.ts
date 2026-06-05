import { fetchServerStore } from "./_dataSource.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";
import { databaseConfigured, getSql } from "../shared/database.js";

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

export default async function handler(req: any, res: any) {
  const started = Date.now();
  setCorsHeaders(req, res);
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");

  try {
    const predictionId = typeof req.query?.predictionId === "string" ? req.query.predictionId : null;
    const matchId = typeof req.query?.matchId === "string" ? req.query.matchId : null;
    const limit = Math.min(Math.max(Number(req.query?.limit || 25), 1), 100);

    if (databaseConfigured()) {
      const sql = getSql();
      if (sql) {
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

    const { store, branch } = await fetchServerStore();
    const snapshots = store.predictionSnapshots || {};
    const index = store.predictionSnapshotIndex || {};

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
      sourceBranch: branch,
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
