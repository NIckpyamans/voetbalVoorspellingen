#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);

const normalizedAlias = (nameSql) =>
  `trim(both '-' from lower(regexp_replace(coalesce(${nameSql},''),'[^a-zA-Z0-9]+','-','g')))`;
const canonicalClub = (nameSql) =>
  `(select ca.club_id from club_aliases ca where ca.normalized_alias=${normalizedAlias(nameSql)} order by ca.alias_id limit 1)`;

const fields = [
  ["kickoff", "coalesce(sr.payload->>'kickoff',sr.payload->>'kickoff_at')"],
  ["score", `case
    when jsonb_typeof(sr.payload#>'{score,ft}')='array' then (sr.payload#>>'{score,ft,0}')||'-'||(sr.payload#>>'{score,ft,1}')
    when jsonb_typeof(sr.payload->'score')='array' then (sr.payload#>>'{score,0}')||'-'||(sr.payload#>>'{score,1}')
    else coalesce(sr.payload->>'score',sr.payload->>'finalScore') end`],
  ["status", "coalesce(sr.payload->>'status',sr.payload->>'status_normalized')"],
  ["home_club_id", canonicalClub("coalesce(sr.payload->>'homeTeamName',sr.payload->>'home_team_name',sr.payload->>'team1',sr.payload#>>'{homeTeam,name}')")],
  ["away_club_id", canonicalClub("coalesce(sr.payload->>'awayTeamName',sr.payload->>'away_team_name',sr.payload->>'team2',sr.payload#>>'{awayTeam,name}')")],
];

let detected = 0;
for (const [field, valueSql] of fields) {
  const rows = await sql.query(`
    with candidates as (
      select msr.match_id,sr.source_record_id,msr.provider,coalesce(pft.effective_trust_score,msr.trust_score) trust_score,${valueSql} value
      from match_source_records msr join source_records sr on sr.source_record_id=msr.source_record_id
      left join provider_field_trust_profiles pft on pft.provider=msr.provider and pft.field_name='${field}'
    ), conflicting as (
      select match_id,jsonb_agg(jsonb_build_object('sourceRecordId',source_record_id,'provider',provider,'value',value,'trustScore',trust_score)
        order by trust_score desc nulls last) candidate_values,
        (array_agg(source_record_id order by trust_score desc nulls last))[1] selected_source_record_id,
        (array_agg(value order by trust_score desc nulls last))[1] selected_value
      from candidates where nullif(value,'') is not null group by match_id having count(distinct value)>1
    )
    insert into source_conflicts(source_conflict_id,entity_type,entity_key,field_name,candidate_values,selected_source_record_id,selected_value,
      resolution_method,status,resolved_at)
    select 'conflict_'||md5('match|'||c.match_id||'|${field}'),'match',c.match_id,'${field}',c.candidate_values,c.selected_source_record_id,
      to_jsonb(c.selected_value),'highest_bayesian_provider_trust','pending',null
    from conflicting c
    on conflict(entity_type,entity_key,field_name) do update set candidate_values=excluded.candidate_values,
      selected_source_record_id=excluded.selected_source_record_id,selected_value=excluded.selected_value,
      resolution_method=excluded.resolution_method,
      status=case when source_conflicts.candidate_values is distinct from excluded.candidate_values
        or source_conflicts.selected_value is distinct from excluded.selected_value then 'pending' else source_conflicts.status end,
      resolved_at=case when source_conflicts.candidate_values is distinct from excluded.candidate_values
        or source_conflicts.selected_value is distinct from excluded.selected_value then null else source_conflicts.resolved_at end,
      updated_at=now()
    returning 1
  `);
  detected += rows.length;
}
await sql.query("update source_conflicts set status='review_required',updated_at=now() where status='pending' and field_name in ('home_club_id','away_club_id')");
await sql.query(`
  update source_conflicts sc set status='resolved',resolution_method='canonical_club_merge',resolved_at=now(),updated_at=now()
  where sc.field_name in ('home_club_id','away_club_id') and sc.status='review_required'
    and not exists (
      select 1 from jsonb_array_elements(sc.candidate_values) candidate
      where candidate->>'value' <> sc.selected_value#>>'{}'
        and exists(select 1 from clubs c where c.club_id=candidate->>'value')
    )
`);
const summary = await sql.query("select field_name,count(1)::int conflicts,count(1) filter(where status='pending')::int pending from source_conflicts group by field_name order by conflicts desc");
console.log(JSON.stringify({ detected, fields: summary }, null, 2));
