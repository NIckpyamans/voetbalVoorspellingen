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
`);
for (const metric of metrics) {
  await sql.query(
    "insert into integrity_metric_snapshots(metric_key,metric_value,metadata) values($1,$2,$3::jsonb)",
    [metric.metric_key, metric.metric_value, JSON.stringify({ source: "scheduled-integrity-snapshot-v1" })]
  );
}
await sql.query(`
  insert into provider_trust_history(provider,effective_trust_score,result_accuracy,settled_records,conflict_rate,timestamp_coverage,metrics)
  select provider,effective_trust_score,(metrics->>'resultAccuracy')::numeric,coalesce((metrics->>'settledRecords')::int,0),
    conflict_rate,timestamp_coverage,metrics from provider_trust_profiles
`);
console.log(JSON.stringify({ capturedMetrics: metrics.length }, null, 2));
