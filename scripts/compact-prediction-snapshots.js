#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";

const APPLY = process.argv.includes("--apply");
const KEEP_PER_MATCH = Number(process.env.SNAPSHOT_KEEP_PER_MATCH || 2);
const RECENT_DAYS = Number(process.env.SNAPSHOT_COMPACTION_RECENT_DAYS || 3);

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

const before = await sql.query(`
  select count(*)::int as snapshots,
    count(distinct match_id)::int as matches,
    pg_size_pretty(pg_total_relation_size('prediction_snapshots')) as table_size,
    pg_size_pretty(sum(pg_column_size(prediction_payload))) as prediction_payload_size,
    pg_size_pretty(sum(pg_column_size(input_snapshot))) as input_snapshot_size
  from prediction_snapshots
`);

const candidates = await sql.query(`
  with ranked as (
    select ps.prediction_id, ps.match_id, ps.generated_at, m.kickoff_at,
      row_number() over (partition by ps.match_id order by ps.generated_at desc, ps.prediction_id desc) as recency_rank,
      exists(select 1 from prediction_evaluations pe where pe.prediction_id = ps.prediction_id) as evaluated,
      exists(select 1 from odds_snapshots os where os.prediction_id = ps.prediction_id) as has_odds,
      (ps.prediction_payload->>'topExactScorePick')::boolean as top_exact,
      (ps.prediction_payload->>'topConfidencePick')::boolean as top_confidence
    from prediction_snapshots ps
    left join matches m on m.match_id = ps.match_id
  )
  select count(*)::int as deletable
  from ranked
  where recency_rank > $1
    and generated_at < now() - ($2::text || ' days')::interval
    and coalesce(evaluated, false) = false
    and coalesce(has_odds, false) = false
    and coalesce(top_exact, false) = false
    and coalesce(top_confidence, false) = false
`, [KEEP_PER_MATCH, RECENT_DAYS]);

let deleted = 0;
let vacuum = [];
if (APPLY) {
  const [result] = await sql.query(`
    with ranked as (
      select ps.prediction_id, ps.match_id, ps.generated_at, m.kickoff_at,
        row_number() over (partition by ps.match_id order by ps.generated_at desc, ps.prediction_id desc) as recency_rank,
        exists(select 1 from prediction_evaluations pe where pe.prediction_id = ps.prediction_id) as evaluated,
        exists(select 1 from odds_snapshots os where os.prediction_id = ps.prediction_id) as has_odds,
        (ps.prediction_payload->>'topExactScorePick')::boolean as top_exact,
        (ps.prediction_payload->>'topConfidencePick')::boolean as top_confidence
      from prediction_snapshots ps
      left join matches m on m.match_id = ps.match_id
    ), deleted_source_audit as (
      delete from source_audit sa
      using ranked r
      where sa.prediction_id = r.prediction_id
        and r.recency_rank > $1
        and r.generated_at < now() - ($2::text || ' days')::interval
        and coalesce(r.evaluated, false) = false
        and coalesce(r.has_odds, false) = false
        and coalesce(r.top_exact, false) = false
        and coalesce(r.top_confidence, false) = false
      returning sa.prediction_id
    ), deleted_snapshots as (
      delete from prediction_snapshots ps
      using ranked r
      where ps.prediction_id = r.prediction_id
        and r.recency_rank > $1
        and r.generated_at < now() - ($2::text || ' days')::interval
        and coalesce(r.evaluated, false) = false
        and coalesce(r.has_odds, false) = false
        and coalesce(r.top_exact, false) = false
        and coalesce(r.top_confidence, false) = false
      returning ps.prediction_id
    )
    select count(*)::int as deleted from deleted_snapshots
  `, [KEEP_PER_MATCH, RECENT_DAYS]);
  deleted = Number(result?.deleted || 0);
  for (const table of ["source_audit", "prediction_snapshots"]) {
    try {
      await sql.query(`vacuum (analyze) ${table}`);
      vacuum.push({ table, status: "ok" });
    } catch (error) {
      vacuum.push({ table, status: "failed", error: error.message });
    }
  }
}

const after = await sql.query(`
  select count(*)::int as snapshots,
    count(distinct match_id)::int as matches,
    pg_size_pretty(pg_total_relation_size('prediction_snapshots')) as table_size,
    pg_size_pretty(sum(pg_column_size(prediction_payload))) as prediction_payload_size,
    pg_size_pretty(sum(pg_column_size(input_snapshot))) as input_snapshot_size
  from prediction_snapshots
`);

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  mode: APPLY ? "apply" : "audit",
  policy: {
    keepPerMatch: KEEP_PER_MATCH,
    recentDaysProtected: RECENT_DAYS,
    retained: ["latest snapshots per match", "evaluated snapshots", "snapshots with odds", "top exact/confidence picks"],
  },
  before: before[0],
  candidates: candidates[0],
  deleted,
  vacuum,
  after: after[0],
}, null, 2));
