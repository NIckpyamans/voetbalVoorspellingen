#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);

const fields = [
  ["kickoff", "coalesce(sr.payload->>'kickoff',sr.payload->>'kickoff_at',sr.payload->>'date')", "to_jsonb(m.kickoff_at::text)"],
  ["score", "coalesce(sr.payload->>'score',sr.payload->>'finalScore')", "to_jsonb(coalesce(mr.final_home_goals::text||'-'||mr.final_away_goals::text,''))"],
  ["status", "coalesce(sr.payload->>'status',sr.payload->>'status_normalized')", "to_jsonb(coalesce(m.status_normalized,m.status,''))"],
  ["home_club_id", "coalesce(sr.payload->>'homeClubId',sr.payload->>'homeTeamId',sr.payload->>'home_team_id')", "to_jsonb(coalesce(m.home_club_id,''))"],
  ["away_club_id", "coalesce(sr.payload->>'awayClubId',sr.payload->>'awayTeamId',sr.payload->>'away_team_id')", "to_jsonb(coalesce(m.away_club_id,''))"],
];
let detected = 0;
for (const [field, valueSql, selectedSql] of fields) {
  const rows = await sql.query(`
    with candidates as (
      select msr.match_id,sr.source_record_id,msr.provider,msr.trust_score,${valueSql} value
      from match_source_records msr join source_records sr on sr.source_record_id=msr.source_record_id
    ), conflicting as (
      select match_id,jsonb_agg(jsonb_build_object('sourceRecordId',source_record_id,'provider',provider,'value',value,'trustScore',trust_score)
        order by trust_score desc nulls last) candidate_values,
        (array_agg(source_record_id order by trust_score desc nulls last))[1] selected_source_record_id
      from candidates where nullif(value,'') is not null group by match_id having count(distinct value)>1
    )
    insert into source_conflicts(source_conflict_id,entity_type,entity_key,field_name,candidate_values,selected_source_record_id,selected_value,
      resolution_method,status,resolved_at)
    select 'conflict_'||md5('match|'||c.match_id||'|${field}'),'match',c.match_id,'${field}',c.candidate_values,c.selected_source_record_id,
      ${selectedSql},'highest_provider_trust_with_canonical_comparison','resolved',now()
    from conflicting c join matches m on m.match_id=c.match_id left join match_results mr on mr.match_id=m.match_id
    on conflict(entity_type,entity_key,field_name) do update set candidate_values=excluded.candidate_values,
      selected_source_record_id=excluded.selected_source_record_id,selected_value=excluded.selected_value,
      resolution_method=excluded.resolution_method,status='resolved',resolved_at=now(),updated_at=now()
    returning 1
  `);
  detected += rows.length;
}
const summary = await sql.query("select field_name,count(1)::int conflicts from source_conflicts group by field_name order by conflicts desc");
console.log(JSON.stringify({ detected, fields: summary }, null, 2));
