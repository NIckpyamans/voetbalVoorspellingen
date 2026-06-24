#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";

const LIMIT_BYTES = 5 * 1024 * 1024 * 1024;
const WARNING_RATIO = 0.8;
const APPLY = process.argv.includes("--apply");

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

async function measure() {
  const [database] = await sql.query(`
    select pg_database_size(current_database())::bigint as bytes,
      pg_size_pretty(pg_database_size(current_database())) as pretty
  `);
  const tables = await sql.query(`
    select relname as table_name,
      n_live_tup::bigint as rows,
      n_dead_tup::bigint as dead_rows,
      pg_total_relation_size(relid)::bigint as bytes,
      pg_size_pretty(pg_total_relation_size(relid)) as total_size
    from pg_stat_user_tables
    order by pg_total_relation_size(relid) desc
    limit 20
  `);
  const segments = await sql.query(`
    select segment_group, count(*)::int as rows,
      coalesce(sum(payload_bytes), 0)::bigint as payload_bytes,
      pg_size_pretty(coalesce(sum(payload_bytes), 0)) as payload_size,
      min(updated_at) as oldest, max(updated_at) as newest
    from app_state_segments
    group by segment_group
    order by coalesce(sum(payload_bytes), 0) desc
  `);
  const bytes = Number(database?.bytes || 0);
  return {
    database: {
      bytes,
      pretty: database?.pretty || "0 bytes",
      limitBytes: LIMIT_BYTES,
      limitPretty: "5 GB",
      usedPercent: Number(((bytes / LIMIT_BYTES) * 100).toFixed(2)),
      status: bytes >= LIMIT_BYTES ? "critical" : bytes >= LIMIT_BYTES * WARNING_RATIO ? "warning" : "healthy",
    },
    tables,
    appStateSegments: segments,
  };
}

const before = await measure();
const cleanup = [];
if (APPLY) {
  // These rows are derived caches or monitoring history. Canonical football and model data is retained.
  cleanup.push({
    target: "stale prediction snapshot cache chunks",
    rows: Number((await sql.query(`
      with deleted as (
        delete from app_state_segments
        where segment_group = 'predictionSnapshots'
          and updated_at < now() - interval '3 days'
        returning 1
      ) select count(*)::int as rows from deleted
    `))[0]?.rows || 0),
  });
  cleanup.push({
    target: "old match/prediction cache segments",
    rows: Number((await sql.query(`
      with deleted as (
        delete from app_state_segments
        where segment_group in ('matches', 'predictions')
          and segment_key ~ '^\\d{4}-\\d{2}-\\d{2}$'
          and segment_key::date < current_date - 400
        returning 1
      ) select count(*)::int as rows from deleted
    `))[0]?.rows || 0),
  });
  cleanup.push({
    target: "old integrity metrics",
    rows: Number((await sql.query(`
      with deleted as (
        delete from integrity_metric_snapshots
        where captured_at < now() - interval '400 days'
        returning 1
      ) select count(*)::int as rows from deleted
    `))[0]?.rows || 0),
  });
  cleanup.push({
    target: "old provider trust history",
    rows: Number((await sql.query(`
      with deleted as (
        delete from provider_trust_history
        where captured_at < now() - interval '400 days'
        returning 1
      ) select count(*)::int as rows from deleted
    `))[0]?.rows || 0),
  });
  cleanup.push({
    target: "encrypted recovery backups beyond latest 14 per type",
    rows: Number((await sql.query(`
      with ranked as (
        select backup_id,
          row_number() over (partition by backup_type order by created_at desc, backup_id desc) as retention_rank
        from encrypted_database_backups
      ), deleted as (
        delete from encrypted_database_backups b
        using ranked r
        where b.backup_id = r.backup_id and r.retention_rank > 14
        returning 1
      ) select count(*)::int as rows from deleted
    `))[0]?.rows || 0),
  });
}

  const after = APPLY ? await measure() : before;
const report = {
  generatedAt: new Date().toISOString(),
  mode: APPLY ? "apply" : "audit",
  policy: {
    storageLimit: "5 GB",
    warningAt: "80%",
    canonicalDataRetained: ["matches", "prediction_snapshots", "prediction_evaluations", "odds", "H2H", "source lineage"],
  },
  before,
  cleanup,
  after,
};

console.log(JSON.stringify(report, null, 2));
if (after.database.status === "critical") process.exit(1);
