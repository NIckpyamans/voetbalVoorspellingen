#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

const columnHotspots = await sql.query(`
  select 'prediction_snapshots' as table_name, count(*)::int as rows,
    pg_size_pretty(sum(pg_column_size(prediction_payload))) as prediction_payload,
    pg_size_pretty(sum(pg_column_size(input_snapshot))) as input_snapshot,
    pg_size_pretty(sum(pg_column_size(features))) as features,
    pg_size_pretty(sum(pg_column_size(explanation))) as explanation,
    pg_size_pretty(sum(pg_column_size(feature_source_metadata))) as feature_source_metadata
  from prediction_snapshots
  union all
  select 'matches', count(*)::int,
    pg_size_pretty(sum(pg_column_size(raw_payload))),
    pg_size_pretty(sum(pg_column_size(team_identity))),
    null,
    null,
    null
  from matches
  union all
  select 'source_records', count(*)::int,
    pg_size_pretty(sum(pg_column_size(payload))),
    null,
    null,
    null,
    null
  from source_records
`);

const sourceRecordProviders = await sql.query(`
  select provider,
    count(*)::int as rows,
    pg_size_pretty(sum(pg_column_size(payload))) as payload_size,
    min(fetched_at) as oldest,
    max(fetched_at) as newest
  from source_records
  group by provider
  order by sum(pg_column_size(payload)) desc
  limit 20
`);

const snapshotAges = await sql.query(`
  select
    count(*)::int as rows,
    count(*) filter (where generated_at < now() - interval '30 days')::int as older_than_30d,
    count(*) filter (where generated_at < now() - interval '90 days')::int as older_than_90d,
    count(*) filter (where prediction_payload ? 'inputSnapshot')::int as payload_embeds_input_snapshot,
    pg_size_pretty(sum(pg_column_size(prediction_payload)) filter (where prediction_payload ? 'inputSnapshot')) as embedded_input_payload_size
  from prediction_snapshots
`);

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  columnHotspots,
  sourceRecordProviders,
  snapshotAges,
}, null, 2));
