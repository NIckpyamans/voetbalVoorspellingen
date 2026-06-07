#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);

const metrics = await sql.query(`
  select 'quarantined_matches' metric_key,count(1) filter(where identity_status='quarantined')::numeric metric_value from matches
  union all select 'resolved_matches',count(1) filter(where identity_status='resolved')::numeric from matches
  union all select 'source_conflicts',count(1)::numeric from source_conflicts
  union all select 'audit_coverage',count(distinct prediction_id)::numeric/greatest((select count(1) from prediction_snapshots),1) from source_audit
  union all select 'prematch_odds',count(1)::numeric from historical_odds_snapshots where available_before_kickoff=true
  union all select 'closing_pairs',count(1)::numeric from historical_odds_snapshots where closing_captured_at is not null
  union all select 'evaluated_predictions',count(1)::numeric from prediction_evaluations
  union all select 'outcome_hit_rate',coalesce(avg(outcome_hit::int),0)::numeric from prediction_evaluations
  union all select 'average_brier',coalesce(avg(brier_score),0)::numeric from prediction_evaluations
  union all select 'canonical_club_alias_coverage',coalesce(avg((m.home_club_id is not null and m.away_club_id is not null)::int),0)::numeric from matches m
  union all select 'automatic_conflict_repairs',count(1) filter(where repair_status='applied')::numeric from source_conflict_repairs
`);
for (const metric of metrics) {
  await sql.query(
    "insert into integrity_metric_snapshots(metric_key,metric_value,metadata) values($1,$2,$3::jsonb)",
    [metric.metric_key, metric.metric_value, JSON.stringify({ source: "scheduled-integrity-snapshot-v1" })]
  );
}
const qualityDimensions = await sql.query(`
  select coalesce(m.competition_id,'competition:unknown') competition_id,coalesce(ps.model_version,'model:unknown') model_version,
    count(1)::numeric evaluation_count,coalesce(avg(pe.outcome_hit::int),0)::numeric outcome_hit_rate,
    coalesce(avg(pe.brier_score),0)::numeric average_brier,coalesce(avg(pe.log_loss),0)::numeric average_log_loss
  from prediction_evaluations pe join prediction_snapshots ps on ps.prediction_id=pe.prediction_id join matches m on m.match_id=pe.match_id
  group by m.competition_id,ps.model_version
`);
for (const row of qualityDimensions) {
  const dimension = `competition:${row.competition_id}|model:${row.model_version}`;
  for (const key of ["evaluation_count", "outcome_hit_rate", "average_brier", "average_log_loss"]) {
    await sql.query("insert into integrity_metric_snapshots(metric_key,metric_value,dimension_key,metadata) values($1,$2,$3,$4::jsonb)",
      [`model_${key}`, row[key], dimension, JSON.stringify({ competitionId: row.competition_id, modelVersion: row.model_version, source: "model-quality-dimension-v1" })]);
  }
}
await sql.query(`
  insert into provider_trust_history(provider,effective_trust_score,result_accuracy,settled_records,conflict_rate,timestamp_coverage,metrics)
  select provider,effective_trust_score,(metrics->>'resultAccuracy')::numeric,coalesce((metrics->>'settledRecords')::int,0),
    conflict_rate,timestamp_coverage,metrics from provider_trust_profiles
`);
console.log(JSON.stringify({ capturedMetrics: metrics.length, modelQualityDimensions: qualityDimensions.length }, null, 2));
