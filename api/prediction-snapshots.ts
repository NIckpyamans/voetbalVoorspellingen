import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";
import { databaseConfigured, getSql } from "../shared/database.js";
import { readLocalSnapshotLedger, readR2SnapshotApiLedger } from "../shared/predictionSnapshotLedger.js";

const logger = createLogger("api.prediction-snapshots");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const MAX_DETAIL_LIMIT = 10;

export function compactSnapshot(snapshot: any, includeDetails = false) {
  if (!snapshot) return null;
  const compact: any = {
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
    features: snapshot.features || null,
    probabilities: snapshot.probabilities || null,
    confidence: snapshot.confidence ?? null,
    confidenceRaw: snapshot.confidenceRaw ?? null,
    expectedScore: snapshot.expectedScore || null,
    oddsAtPrediction: snapshot.oddsAtPrediction || null,
    oddsStatus: snapshot.oddsStatus || null,
    oddsMissingReason: snapshot.oddsMissingReason || null,
    oddsProviderStatus: snapshot.oddsProviderStatus || null,
    oddsProviderDiagnostics: snapshot.oddsProviderDiagnostics || null,
    roiStatus: snapshot.roiStatus || null,
    clvStatus: snapshot.clvStatus || null,
    sourceAsOf: snapshot.sourceAsOf || snapshot.inputSnapshot?.sourceAsOf || null,
    lineupStatus: snapshot.lineupStatus || snapshot.inputSnapshot?.lineupStatus || null,
    refereeStatus: snapshot.refereeStatus || snapshot.inputSnapshot?.refereeStatus || null,
    featureSourceMetadata: snapshot.featureSourceMetadata || snapshot.inputSnapshot?.featureSourceMetadata || null,
    leakageGuard: snapshot.leakageGuard || null,
    dataCompleteness: snapshot.dataCompleteness || null,
    missingData: snapshot.missingData || [],
  };
  if (includeDetails) {
    compact.inputSnapshot = snapshot.inputSnapshot || null;
    compact.calibration = snapshot.calibration || null;
    compact.explanation = snapshot.explanation || null;
  }
  return compact;
}

function snapshotTime(snapshot: any) {
  const value = Date.parse(String(snapshot?.generatedAt || snapshot?.cutoffAt || ""));
  return Number.isFinite(value) ? value : 0;
}

export function selectBoundedSnapshots(
  snapshots: Record<string, any>,
  options: { predictionId?: string | null; matchId?: string | null; before?: string | null; offset?: number; limit?: number } = {}
) {
  const limit = Math.min(Math.max(Number(options.limit || DEFAULT_LIMIT), 1), MAX_LIMIT);
  const offset = Math.min(Math.max(Number(options.offset || 0), 0), 5000);
  const beforeMs = options.before ? Date.parse(options.before) : Number.NaN;
  let candidates: any[];
  if (options.predictionId) {
    const snapshot = snapshots?.[options.predictionId];
    candidates = snapshot ? [snapshot] : [];
  } else {
    candidates = Object.values(snapshots || {}).filter((snapshot: any) =>
      (!options.matchId || String(snapshot?.matchId || "") === options.matchId)
      && (!Number.isFinite(beforeMs) || snapshotTime(snapshot) < beforeMs)
    );
  }
  candidates.sort((left, right) => snapshotTime(right) - snapshotTime(left));
  return candidates.slice(offset, offset + limit);
}

function memoryUsageMb() {
  const usage = process.memoryUsage();
  return {
    rss: Number((usage.rss / 1024 / 1024).toFixed(1)),
    heapUsed: Number((usage.heapUsed / 1024 / 1024).toFixed(1)),
  };
}

function mapDatabaseSnapshot(row: any) {
  return {
    predictionId: row.prediction_id,
    matchId: row.match_id,
    generatedAt: row.generated_at,
    cutoffAt: row.cutoff_at,
    kickoff: row.kickoff_at,
    status: "pre_match",
    modelVersion: row.model_version,
    featureSchemaVersion: row.feature_schema_version,
    algorithmVersion: row.algorithm_version,
    date: row.date_key || String(row.kickoff_at || "").slice(0, 10),
    league: row.league,
    homeTeam: row.home_team_name || row.payload_home_team || row.input_home_team,
    awayTeam: row.away_team_name || row.payload_away_team || row.input_away_team,
    inputSnapshotHash: row.input_snapshot_hash,
    teamIdentity: row.team_identity,
    features: row.features,
    probabilities: row.probabilities,
    confidence: row.confidence,
    confidenceRaw: row.confidence_raw,
    expectedScore: row.expected_score,
    dataCompleteness: row.data_completeness,
    featureSourceMetadata: row.feature_source_metadata,
    leakageGuard: row.leakage_guard,
    sourceAsOf: row.source_as_of,
    lineupStatus: row.lineup_status,
    refereeStatus: row.referee_status,
    oddsAtPrediction: row.odds_at_prediction,
    oddsStatus: row.odds_status,
    oddsMissingReason: row.odds_missing_reason,
    roiStatus: row.roi_status,
    clvStatus: row.clv_status,
    inputSnapshot: row.input_snapshot,
    calibration: row.calibration,
    explanation: row.explanation,
  };
}

function buildSnapshotSummary(
  snapshots: Record<string, any>,
  evaluations: Record<string, any> = {},
  reviews: Record<string, any> = {}
) {
  const items = Object.values(snapshots || {});
  const evaluatedPredictionIds = new Set(Object.keys(evaluations || {}));
  const evaluatedMatchIds = new Set([
    ...Object.keys(reviews || {}),
    ...Object.values(evaluations || {}).map((evaluation: any) => String(evaluation?.matchId || "")).filter(Boolean),
  ]);
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
    if (
      evaluatedPredictionIds.has(String(snapshot?.predictionId || "")) ||
      evaluatedMatchIds.has(String(snapshot?.matchId || ""))
    ) evaluated += 1;
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
    const includeDetails = req.query?.details === "1" || req.query?.details === "true";
    const maximum = includeDetails ? MAX_DETAIL_LIMIT : MAX_LIMIT;
    const limit = Math.min(Math.max(Number(req.query?.limit || DEFAULT_LIMIT), 1), maximum);
    const offset = Math.min(Math.max(Number(req.query?.offset || 0), 0), 5000);
    const before = typeof req.query?.before === "string" && Number.isFinite(Date.parse(req.query.before))
      ? new Date(req.query.before).toISOString()
      : null;
    // The full immutable ledger is reserved for offline training/evaluation. A
    // request only reads the compact API index to avoid deserializing years of
    // feature payloads inside a Vercel function.
    const r2Ledger = await readR2SnapshotApiLedger();
    const recoveryLedger = r2Ledger.available ? null : readLocalSnapshotLedger();
    const durableLedger = r2Ledger.available ? r2Ledger : recoveryLedger;
    const preferDatabase = req.query?.source === "postgres" || !durableLedger?.available;

    let databaseSummary: any = null;
    try {
      if (preferDatabase && databaseConfigured()) {
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
          const detailColumns = includeDetails
            ? ", ps.input_snapshot, ps.calibration, ps.explanation"
            : "";
          const where: string[] = [];
          const params: any[] = [];
          if (predictionId) {
            params.push(predictionId);
            where.push(`ps.prediction_id = $${params.length}`);
          }
          if (matchId) {
            params.push(matchId);
            where.push(`ps.match_id = $${params.length}`);
          }
          if (before) {
            params.push(before);
            where.push(`ps.generated_at < $${params.length}`);
          }
          params.push(limit);
          const limitParameter = `$${params.length}`;
          params.push(offset);
          const offsetParameter = `$${params.length}`;
          const rows = await sql.query(`
            select ps.prediction_id, ps.match_id, ps.generated_at, ps.cutoff_at,
              ps.model_version, ps.feature_schema_version, ps.algorithm_version,
              ps.input_snapshot_hash, ps.features, ps.probabilities, ps.confidence,
              ps.confidence_raw, ps.expected_score, ps.data_completeness,
              ps.feature_source_metadata, ps.leakage_guard,
              ps.input_snapshot->'teamIdentity' as team_identity,
              ps.input_snapshot->'sourceAsOf' as source_as_of,
              ps.input_snapshot->>'lineupStatus' as lineup_status,
              ps.input_snapshot->>'refereeStatus' as referee_status,
              ps.prediction_payload->>'homeTeam' as payload_home_team,
              ps.prediction_payload->>'awayTeam' as payload_away_team,
              ps.prediction_payload#>>'{inputSnapshot,homeTeam}' as input_home_team,
              ps.prediction_payload#>>'{inputSnapshot,awayTeam}' as input_away_team,
              ps.prediction_payload->'oddsAtPrediction' as odds_at_prediction,
              ps.prediction_payload->>'oddsStatus' as odds_status,
              ps.prediction_payload->>'oddsMissingReason' as odds_missing_reason,
              ps.prediction_payload->>'roiStatus' as roi_status,
              ps.prediction_payload->>'clvStatus' as clv_status,
              m.kickoff_at, m.date_key, m.league, m.home_team_name, m.away_team_name
              ${detailColumns}
            from prediction_snapshots ps
            left join matches m on m.match_id = ps.match_id
            ${where.length ? `where ${where.join(" and ")}` : ""}
            order by ps.generated_at desc, ps.prediction_id desc
            limit ${limitParameter} offset ${offsetParameter}
          `, params);
          const items = rows.map((row: any) => compactSnapshot(mapDatabaseSnapshot(row), includeDetails)).filter(Boolean);
          if (items.length) {
            const memoryMb = memoryUsageMb();
            logger.info("prediction_snapshots_served", { source: "postgres", count: items.length, limit, memoryMb });
            return res.status(200).json({
              ok: true,
              items,
              total: items.length,
              limit,
              offset,
              nextBefore: items.length === limit ? items.at(-1)?.generatedAt || null : null,
              sourceBranch: "postgres",
              workerVersion: items[0]?.modelVersion || "database",
              memoryMb,
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

    if (!durableLedger?.available) throw new Error("Geen begrensde snapshotbron beschikbaar");
    const snapshots = durableLedger.ledger.predictionSnapshots || {};
    const snapshotBranch = r2Ledger.available ? "r2-bounded-api-ledger" : "bundled-recovery-ledger";

    if (summaryOnly) {
      const summary = databaseSummary || buildSnapshotSummary(
        snapshots,
        durableLedger.ledger.evaluations || {},
        durableLedger.ledger.postMatchReviews || {}
      );
      const memoryMb = memoryUsageMb();
      return res.status(200).json({
        ok: true,
        summary,
        sourceBranch: databaseSummary ? "postgres" : snapshotBranch,
        workerVersion: "snapshot-ledger",
        memoryMb,
        durationMs: Date.now() - started,
      });
    }

    const selected = selectBoundedSnapshots(snapshots, { predictionId, matchId, before, offset, limit });
    const items = selected.map((snapshot: any) => compactSnapshot(snapshot, includeDetails)).filter(Boolean);
    const memoryMb = memoryUsageMb();
    logger.info("prediction_snapshots_served", { source: snapshotBranch, count: items.length, limit, memoryMb });

    return res.status(200).json({
      ok: true,
      items,
      total: items.length,
      limit,
      offset,
      nextBefore: items.length === limit ? items.at(-1)?.generatedAt || null : null,
      sourceBranch: snapshotBranch,
      workerVersion: items[0]?.modelVersion || "snapshot-ledger",
      memoryMb,
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
