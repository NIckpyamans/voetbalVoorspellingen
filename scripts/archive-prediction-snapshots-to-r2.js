#!/usr/bin/env node

import crypto from "crypto";
import { gzipSync } from "zlib";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { buildR2ObjectKey, getR2Config, putR2Object } from "../shared/cloudflare-r2.js";

const APPLY = process.argv.includes("--apply");
const KEEP_PER_MATCH = Number(process.env.SNAPSHOT_KEEP_PER_MATCH || 3);
const RECENT_DAYS = Number(process.env.SNAPSHOT_COMPACTION_RECENT_DAYS || 7);
const LIMIT = Math.min(Math.max(Number(process.env.SNAPSHOT_ARCHIVE_LIMIT || 5000), 1), 25000);

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function objectKey(now, hash) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `prediction-snapshots/year=${year}/month=${month}/day=${day}/prediction-snapshots-${stamp}-${hash}.json.gz`;
}

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

const rows = await sql.query(`
  with ranked as (
    select ps.*,
      row_number() over (partition by ps.match_id order by ps.generated_at desc, ps.prediction_id desc) as recency_rank,
      exists(select 1 from prediction_evaluations pe where pe.prediction_id = ps.prediction_id) as evaluated,
      exists(select 1 from odds_snapshots os where os.prediction_id = ps.prediction_id) as has_odds,
      (ps.prediction_payload->>'topExactScorePick')::boolean as top_exact,
      (ps.prediction_payload->>'topConfidencePick')::boolean as top_confidence
    from prediction_snapshots ps
  )
  select *
  from ranked
  where recency_rank > $1
    and generated_at < now() - ($2::text || ' days')::interval
    and coalesce(evaluated, false) = false
    and coalesce(has_odds, false) = false
    and coalesce(top_exact, false) = false
    and coalesce(top_confidence, false) = false
  order by generated_at asc, prediction_id asc
  limit $3
`, [KEEP_PER_MATCH, RECENT_DAYS, LIMIT]);

const r2Config = getR2Config();
let upload = null;
let deleted = 0;
let object = null;

if (APPLY && rows.length) {
  if (!r2Config.configured) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      mode: "apply",
      skipped: true,
      reason: "r2_not_configured",
      candidates: rows.length,
    }, null, 2));
    process.exit(0);
  }
  const now = new Date();
  const archive = {
    generatedAt: now.toISOString(),
    source: "neon.prediction_snapshots",
    keepPerMatch: KEEP_PER_MATCH,
    recentDaysProtected: RECENT_DAYS,
    recordCount: rows.length,
    records: rows.map((row) => ({
      predictionId: row.prediction_id,
      matchId: row.match_id,
      generatedAt: row.generated_at,
      cutoffAt: row.cutoff_at,
      modelVersion: row.model_version,
      featureSchemaVersion: row.feature_schema_version,
      algorithmVersion: row.algorithm_version,
      inputSnapshotHash: row.input_snapshot_hash,
      inputSnapshot: row.input_snapshot,
      features: row.features,
      probabilities: row.probabilities,
      confidence: row.confidence,
      confidenceRaw: row.confidence_raw,
      calibration: row.calibration,
      expectedScore: row.expected_score,
      explanation: row.explanation,
      dataCompleteness: row.data_completeness,
      featureSourceMetadata: row.feature_source_metadata,
      leakageGuard: row.leakage_guard,
      predictionPayload: row.prediction_payload,
    })),
  };
  const json = JSON.stringify(archive);
  const compressed = gzipSync(Buffer.from(json, "utf8"), { level: 9 });
  object = buildR2ObjectKey(r2Config, objectKey(now, digest(json)));
  upload = await putR2Object({
    config: r2Config,
    key: object,
    body: compressed,
    contentType: "application/json",
    metadata: {
      source: "neon-prediction-snapshots",
      records: String(rows.length),
      uncompressedBytes: String(Buffer.byteLength(json, "utf8")),
    },
  });
  const ids = rows.map((row) => row.prediction_id);
  const [result] = await sql.query(`
    with deleted_source_audit as (
      delete from source_audit
      where prediction_id = any($1::text[])
      returning 1
    ), deleted_snapshots as (
      delete from prediction_snapshots
      where prediction_id = any($1::text[])
      returning 1
    )
    select count(*)::int as rows from deleted_snapshots
  `, [ids]);
  deleted = Number(result?.rows || 0);
  await sql.query("vacuum (full, analyze) source_audit");
  await sql.query("vacuum (full, analyze) prediction_snapshots");
}

const db = await sql.query(`select pg_database_size(current_database())::bigint as bytes, pg_size_pretty(pg_database_size(current_database())) as pretty`);
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  mode: APPLY ? "apply" : "audit",
  r2Configured: r2Config.configured,
  candidates: rows.length,
  objectKey: object,
  upload,
  deleted,
  database: db[0],
}, null, 2));
