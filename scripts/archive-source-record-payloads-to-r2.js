#!/usr/bin/env node

import crypto from "crypto";
import { gzipSync } from "zlib";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { buildR2ObjectKey, getR2Config, putR2Object } from "../shared/cloudflare-r2.js";

const APPLY = process.argv.includes("--apply");
const RETENTION_DAYS = Number(process.env.SOURCE_PAYLOAD_RETENTION_DAYS || 7);
const LIMIT = Math.min(Math.max(Number(process.env.SOURCE_PAYLOAD_ARCHIVE_LIMIT || 10000), 1), 50000);

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function archiveKey(now, hash) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `source-records/year=${year}/month=${month}/day=${day}/source-records-${stamp}-${hash}.json.gz`;
}

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

const r2Config = getR2Config();
const candidates = await sql.query(
  `
    select source_record_id, provider, source_url, entity_type, entity_key,
      fetched_at, source_timestamp, content_hash, trust_score, payload,
      pg_column_size(payload)::int as payload_bytes
    from source_records
    where fetched_at < now() - ($1::text || ' days')::interval
      and payload <> '{}'::jsonb
      and provider not in ('client-browser-favorites')
    order by fetched_at asc, source_record_id asc
    limit $2
  `,
  [RETENTION_DAYS, LIMIT]
);

const totalPayloadBytes = candidates.reduce((sum, row) => sum + Number(row.payload_bytes || 0), 0);
let upload = null;
let compacted = 0;
let objectKey = null;

if (APPLY && candidates.length) {
  if (!r2Config.configured) {
    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          mode: "apply",
          skipped: true,
          reason: "r2_not_configured",
          requiredSecrets: [
            "CLOUDFLARE_R2_ACCOUNT_ID",
            "CLOUDFLARE_R2_ACCESS_KEY_ID",
            "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
            "CLOUDFLARE_R2_BUCKET",
          ],
          candidates: candidates.length,
          totalPayloadBytes,
        },
        null,
        2
      )
    );
    process.exit(0);
  }
  const generatedAt = new Date();
  const archive = {
    generatedAt: generatedAt.toISOString(),
    retentionDays: RETENTION_DAYS,
    source: "neon.source_records",
    recordCount: candidates.length,
    totalPayloadBytes,
    records: candidates.map((row) => ({
      sourceRecordId: row.source_record_id,
      provider: row.provider,
      sourceUrl: row.source_url,
      entityType: row.entity_type,
      entityKey: row.entity_key,
      fetchedAt: row.fetched_at,
      sourceTimestamp: row.source_timestamp,
      contentHash: row.content_hash,
      trustScore: row.trust_score,
      payload: row.payload,
    })),
  };
  const json = JSON.stringify(archive);
  const compressed = gzipSync(Buffer.from(json, "utf8"), { level: 9 });
  objectKey = buildR2ObjectKey(r2Config, archiveKey(generatedAt, digest(json)));
  upload = await putR2Object({
    config: r2Config,
    key: objectKey,
    body: compressed,
    contentType: "application/json",
    metadata: {
      source: "neon-source-records",
      records: String(candidates.length),
      uncompressedBytes: String(Buffer.byteLength(json, "utf8")),
      retentionDays: String(RETENTION_DAYS),
    },
  });
  const ids = candidates.map((row) => row.source_record_id);
  const [result] = await sql.query(
    `
      with updated as (
        update source_records
        set payload = '{}'::jsonb
        where source_record_id = any($1::text[])
          and payload <> '{}'::jsonb
        returning 1
      )
      select count(*)::int as rows from updated
    `,
    [ids]
  );
  compacted = Number(result?.rows || 0);
  await sql.query("vacuum (full, analyze) source_records");
}

const db = await sql.query(`
  select pg_database_size(current_database())::bigint as bytes,
    pg_size_pretty(pg_database_size(current_database())) as pretty
`);

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      mode: APPLY ? "apply" : "audit",
      r2Configured: r2Config.configured,
      policy: {
        retentionDays: RETENTION_DAYS,
        limit: LIMIT,
        archiveFormat: "json.gz",
        compactAfterSuccessfulUpload: true,
      },
      candidates: candidates.length,
      totalPayloadBytes,
      objectKey,
      upload,
      compacted,
      database: db[0],
    },
    null,
    2
  )
);
