#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const fields = [
  ["prediction_payload", "prediction-engine", "ps.prediction_payload <> '{}'::jsonb"],
  ["features", "prediction-engine", "ps.features <> '{}'::jsonb"],
  ["probabilities", "prediction-engine", "ps.probabilities <> '{}'::jsonb"],
  ["data_completeness", "prediction-engine", "ps.data_completeness <> '{}'::jsonb"],
  ["source_metadata", "prediction-engine", "ps.feature_source_metadata <> '{}'::jsonb"],
  ["match_source", "match-lineage", "m.primary_source_record_id is not null"],
  ["match_stats", "database", "exists(select 1 from match_stats where match_id=ps.match_id)"],
  ["team_match_stats", "database", "exists(select 1 from team_match_stats where match_id=ps.match_id)"],
  ["h2h", "database", "exists(select 1 from h2h_edges where home_club_id=least(m.home_club_id,m.away_club_id) and away_club_id=greatest(m.home_club_id,m.away_club_id))"],
  ["prematch_odds", "database", "exists(select 1 from historical_odds_snapshots where match_id=ps.match_id and available_before_kickoff=true)"],
  ["weather", "database", "m.weather_payload <> '{}'::jsonb"],
];
for (const [field, source, availableSql] of fields) {
  await sql.query(`
    insert into source_audit(prediction_id,field_name,available,source,as_of,source_timestamp_known,note)
    select ps.prediction_id,$1,(${availableSql}),$2,ps.generated_at,true,'database-audit-v1'
    from prediction_snapshots ps join matches m on m.match_id=ps.match_id
    where not exists(select 1 from source_audit sa where sa.prediction_id=ps.prediction_id and sa.field_name=$1 and sa.note='database-audit-v1')
  `, [field, source]);
}
const [summary] = await sql.query("select count(1)::int rows,count(distinct prediction_id)::int audited_predictions,count(distinct field_name)::int fields from source_audit");
console.log(JSON.stringify(summary, null, 2));
