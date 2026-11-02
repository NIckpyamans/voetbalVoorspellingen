#!/usr/bin/env node

import crypto from "crypto";
import { gzipSync } from "zlib";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { buildR2ObjectKey, getR2Config, putR2Object } from "../shared/cloudflare-r2.js";
import {
  buildSnapshotArchivePayload,
  emptySnapshotArchiveCursor,
  nextSnapshotArchiveCursor,
  resolveSnapshotArchiveBatchSize,
} from "../shared/snapshotArchive.js";

const APPLY = process.argv.includes("--apply");
const KEEP_PER_MATCH = Number(process.env.SNAPSHOT_KEEP_PER_MATCH || 2);
const RECENT_DAYS = Number(process.env.SNAPSHOT_COMPACTION_RECENT_DAYS || 3);
const LIMIT = Math.min(Math.max(Number(process.env.SNAPSHOT_ARCHIVE_LIMIT || 15000), 1), 50000);
// Kleine batches: één respons met volledige snapshot-payloads mag Neons
// 64MB-limiet nooit raken. Elke batch wordt apart naar R2 geschreven en pas
// daarna verwijderd, dus een mislukte upload laat de rijen staan.
const BATCH = resolveSnapshotArchiveBatchSize(process.env.SNAPSHOT_ARCHIVE_BATCH);

const SELECT_COLUMNS = `
  prediction_id, match_id, generated_at, cutoff_at, model_version,
  feature_schema_version, algorithm_version, input_snapshot_hash, input_snapshot,
  features, probabilities, confidence, confidence_raw, calibration,
  expected_score, explanation, data_completeness, feature_source_metadata,
  leakage_guard, prediction_payload`;

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function objectKey(now, hash, batch) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `prediction-snapshots/year=${year}/month=${month}/day=${day}/prediction-snapshots-${stamp}-b${batch}-${hash}.json.gz`;
}

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

async function fetchBatch(cursor, size) {
  return sql.query(`
    with ranked as (
      select ps.prediction_id, ps.match_id, ps.generated_at, ps.cutoff_at, ps.model_version,
        ps.feature_schema_version, ps.algorithm_version, ps.input_snapshot_hash, ps.input_snapshot,
        ps.features, ps.probabilities, ps.confidence, ps.confidence_raw, ps.calibration,
        ps.expected_score, ps.explanation, ps.data_completeness, ps.feature_source_metadata,
        ps.leakage_guard, ps.prediction_payload,
        row_number() over (partition by ps.match_id order by ps.generated_at desc, ps.prediction_id desc) as recency_rank,
        exists(select 1 from prediction_evaluations pe where pe.prediction_id = ps.prediction_id) as evaluated,
        exists(select 1 from odds_snapshots os where os.prediction_id = ps.prediction_id) as has_odds,
        (ps.prediction_payload->>'topExactScorePick')::boolean as top_exact,
        (ps.prediction_payload->>'topConfidencePick')::boolean as top_confidence
      from prediction_snapshots ps
    )
    select ${SELECT_COLUMNS}
    from ranked
    where recency_rank > $1
      and generated_at < now() - ($2::text || ' days')::interval
      and coalesce(evaluated, false) = false
      and coalesce(has_odds, false) = false
      and coalesce(top_exact, false) = false
      and coalesce(top_confidence, false) = false
      and (generated_at, prediction_id::text) > ($3::timestamptz, $4::text)
    order by generated_at asc, prediction_id asc
    limit $5
  `, [KEEP_PER_MATCH, RECENT_DAYS, cursor.generatedAt, cursor.predictionId, size]);
}

async function deleteBatch(ids) {
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
  return Number(result?.rows || 0);
}

const r2Config = getR2Config();
const batches = [];
let candidates = 0;
let deleted = 0;
let skippedReason = null;
let cursor = emptySnapshotArchiveCursor();

for (let batchNumber = 1; candidates < LIMIT; batchNumber += 1) {
  const size = Math.min(BATCH, LIMIT - candidates);
  const rows = await fetchBatch(cursor, size);
  if (!Array.isArray(rows) || rows.length === 0) break;
  candidates += rows.length;

  const nextCursor = nextSnapshotArchiveCursor(rows);
  if (APPLY) {
    if (!r2Config.configured) {
      skippedReason = "r2_not_configured";
      break;
    }
    const now = new Date();
    const payload = buildSnapshotArchivePayload(rows, {
      generatedAt: now.toISOString(),
      batch: batchNumber,
      keepPerMatch: KEEP_PER_MATCH,
      recentDaysProtected: RECENT_DAYS,
    });
    const json = JSON.stringify(payload);
    const compressed = gzipSync(Buffer.from(json, "utf8"), { level: 9 });
    const key = buildR2ObjectKey(r2Config, objectKey(now, digest(`${json}:${batchNumber}`), batchNumber));
    const upload = await putR2Object({
      config: r2Config,
      key,
      body: compressed,
      contentType: "application/json",
      metadata: {
        source: "neon-prediction-snapshots",
        batch: String(batchNumber),
        records: String(rows.length),
        uncompressedBytes: String(Buffer.byteLength(json, "utf8")),
      },
    });
    if (!upload?.ok) {
      throw new Error(`R2 snapshot archive failed; Neon rows retained (${upload?.reason || "unknown error"})`);
    }
    const removed = await deleteBatch(rows.map((row) => row.prediction_id));
    deleted += removed;
    batches.push({
      batch: batchNumber,
      records: rows.length,
      objectKey: key,
      uncompressedBytes: Buffer.byteLength(json, "utf8"),
      deleted: removed,
    });
  } else {
    batches.push({ batch: batchNumber, records: rows.length });
  }

  if (!nextCursor) break;
  cursor = nextCursor;
  if (rows.length < size) break;
}

if (APPLY && deleted > 0) {
  await sql.query("vacuum (full, analyze) source_audit");
  await sql.query("vacuum (full, analyze) prediction_snapshots");
}

const db = await sql.query(`select pg_database_size(current_database())::bigint as bytes, pg_size_pretty(pg_database_size(current_database())) as pretty`);
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  mode: APPLY ? "apply" : "audit",
  r2Configured: r2Config.configured,
  skipped: skippedReason || undefined,
  batchSize: BATCH,
  candidates,
  batches,
  deleted,
  database: db[0],
}, null, 2));
