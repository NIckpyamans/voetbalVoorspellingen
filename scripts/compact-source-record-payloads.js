#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";
import { getR2Config } from "../shared/cloudflare-r2.js";

const APPLY = process.argv.includes("--apply");
const RETENTION_DAYS = Number(process.env.SOURCE_PAYLOAD_RETENTION_DAYS || 3);
const r2Configured = getR2Config().configured;
const allowUnarchivedCompaction = process.env.SOURCE_PAYLOAD_ALLOW_UNARCHIVED_COMPACTION === "true";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

const before = await sql.query(`
  select provider,
    count(*)::int as rows,
    pg_size_pretty(sum(pg_column_size(payload))) as payload_size,
    min(fetched_at) as oldest,
    max(fetched_at) as newest
  from source_records
  where fetched_at < now() - ($1::text || ' days')::interval
    and payload <> '{}'::jsonb
  group by provider
  order by sum(pg_column_size(payload)) desc
  limit 20
`, [RETENTION_DAYS]);

let compacted = 0;
let skipped = null;
if (APPLY) {
  if (r2Configured && !allowUnarchivedCompaction) {
    skipped = "r2_configured_archive_script_handles_compaction";
  } else {
    const [result] = await sql.query(`
      with updated as (
        update source_records
        set payload = '{}'::jsonb
        where fetched_at < now() - ($1::text || ' days')::interval
          and payload <> '{}'::jsonb
          and provider not in ('client-browser-favorites')
        returning 1
      )
      select count(*)::int as rows from updated
    `, [RETENTION_DAYS]);
    compacted = Number(result?.rows || 0);
    await sql.query("vacuum (full, analyze) source_records");
  }
}

const after = await sql.query(`
  select pg_size_pretty(pg_total_relation_size('source_records')) as table_size,
    pg_size_pretty(sum(pg_column_size(payload))) as payload_size,
    count(*)::int as rows
  from source_records
`);

const db = await sql.query(`
  select pg_database_size(current_database())::bigint as bytes,
    pg_size_pretty(pg_database_size(current_database())) as pretty
`);

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  mode: APPLY ? "apply" : "audit",
  policy: {
    retentionDays: RETENTION_DAYS,
    retainedFields: ["source_record_id", "provider", "source_url", "entity_type", "entity_key", "content_hash", "trust_score", "timestamps"],
    compactedField: "payload",
    r2Configured,
    allowUnarchivedCompaction,
  },
  before,
  skipped,
  compacted,
  after: after[0],
  database: db[0],
}, null, 2));
