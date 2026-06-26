#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";

const DEFAULT_LIMIT_BYTES = 512 * 1024 * 1024;
const LIMIT_BYTES = Number(process.env.NEON_STORAGE_LIMIT_BYTES || process.env.DATABASE_STORAGE_LIMIT_BYTES || DEFAULT_LIMIT_BYTES);
const WARNING_RATIO = Number(process.env.NEON_STORAGE_WARNING_RATIO || 0.8);
const CRITICAL_RATIO = Number(process.env.NEON_STORAGE_CRITICAL_RATIO || 0.95);
const APPLY = process.argv.includes("--apply");

function formatLimit(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${Number((bytes / 1024 / 1024 / 1024).toFixed(2))} GB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

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
      limitPretty: formatLimit(LIMIT_BYTES),
      usedPercent: Number(((bytes / LIMIT_BYTES) * 100).toFixed(2)),
      status: bytes >= LIMIT_BYTES * CRITICAL_RATIO ? "critical" : bytes >= LIMIT_BYTES * WARNING_RATIO ? "warning" : "healthy",
    },
    tables,
    appStateSegments: segments,
  };
}

const before = await measure();
const cleanup = [];
if (APPLY) {
  // These rows are derived caches or monitoring history. Canonical football and model data is retained.
  const pressureBeforeCleanup = before.database.bytes >= LIMIT_BYTES * WARNING_RATIO;
  const backupRetention = pressureBeforeCleanup ? 1 : 3;
  const appStateRetentionDays = pressureBeforeCleanup ? 2 : 3;
  cleanup.push({
    target: "stale prediction snapshot cache chunks",
    rows: Number((await sql.query(`
      with deleted as (
        delete from app_state_segments
        where segment_group = 'predictionSnapshots'
          and updated_at < now() - ($1::text || ' days')::interval
        returning 1
      ) select count(*)::int as rows from deleted
    `, [appStateRetentionDays]))[0]?.rows || 0),
  });
  if (pressureBeforeCleanup) {
    cleanup.push({
      target: "non-canonical app state cache older than pressure window",
      rows: Number((await sql.query(`
        with deleted as (
          delete from app_state_segments
          where segment_group in ('root', 'matches', 'predictions')
            and updated_at < now() - interval '2 days'
          returning 1
        ) select count(*)::int as rows from deleted
      `))[0]?.rows || 0),
    });
  }
  cleanup.push({
    target: "old prediction source audit rows beyond retention",
    rows: Number((await sql.query(`
      with deleted as (
        delete from source_audit
        where as_of < now() - interval '400 days'
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
    target: `encrypted recovery backups beyond latest ${backupRetention} per type`,
    rows: Number((await sql.query(`
      with ranked as (
        select backup_id,
          row_number() over (partition by backup_type order by created_at desc, backup_id desc) as retention_rank
        from encrypted_database_backups
      ), deleted as (
        delete from encrypted_database_backups b
        using ranked r
        where b.backup_id = r.backup_id and r.retention_rank > $1
        returning 1
      ) select count(*)::int as rows from deleted
    `, [backupRetention]))[0]?.rows || 0),
  });
  for (const table of ["app_state_segments", "encrypted_database_backups", "source_audit", "integrity_metric_snapshots", "provider_trust_history"]) {
    try {
      await sql.query(`vacuum (analyze) ${table}`);
      cleanup.push({ target: `vacuum analyze ${table}`, rows: 0 });
    } catch (error) {
      cleanup.push({ target: `vacuum analyze ${table}`, error: error.message });
    }
  }
  if (pressureBeforeCleanup) {
    for (const table of ["encrypted_database_backups", "app_state_segments"]) {
      try {
        await sql.query(`vacuum (full, analyze) ${table}`);
        cleanup.push({ target: `vacuum full analyze ${table}`, rows: 0 });
      } catch (error) {
        cleanup.push({ target: `vacuum full analyze ${table}`, error: error.message });
      }
    }
  }
}

const after = APPLY ? await measure() : before;
const report = {
  generatedAt: new Date().toISOString(),
  mode: APPLY ? "apply" : "audit",
  policy: {
    storageLimit: formatLimit(LIMIT_BYTES),
    warningAt: `${Math.round(WARNING_RATIO * 100)}%`,
    criticalAt: `${Math.round(CRITICAL_RATIO * 100)}%`,
    canonicalDataRetained: ["matches", "prediction_snapshots", "prediction_evaluations", "odds", "H2H", "source lineage"],
  },
  before,
  cleanup,
  after,
};

console.log(JSON.stringify(report, null, 2));
if (after.database.status === "critical") process.exit(1);
