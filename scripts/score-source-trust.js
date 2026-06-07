#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const defaults = { "StatsBomb Open Data": 0.95, "Football-Data.co.uk": 0.88, "football-data.co.uk": 0.88, OpenFootball: 0.86, ESPN: 0.82, BBC: 0.84, TheSportsDB: 0.7, OpenLigaDB: 0.76, unknown: 0.4 };
const componentAliases = {
  "espn-scoreboard-fallback": "ESPN",
  "bbc-fixture-fallback": "BBC",
  "thesportsdb-fixture-fallback": "TheSportsDB",
  "football-data-fixture-fallback": "Football-Data.co.uk",
  "openligadb-fixture-fallback": "OpenLigaDB",
  "openfootball": "OpenFootball",
};
for (const [provider, score] of Object.entries(defaults)) {
  await sql.query("insert into provider_trust_profiles(provider,base_trust_score,effective_trust_score) values($1,$2,$2) on conflict(provider) do update set base_trust_score=$2", [provider, score]);
}
await sql.query(`
  insert into provider_trust_profiles(provider,base_trust_score,effective_trust_score,records_count,timestamp_coverage,metrics,updated_at)
  select provider,0.5,
    least(0.99,greatest(0.1,avg(coalesce(trust_score,0.5))*0.7+(count(source_timestamp)::numeric/greatest(count(1),1))*0.3)),
    count(1)::int,count(source_timestamp)::numeric/greatest(count(1),1),
    jsonb_build_object('averageRecordTrust',avg(coalesce(trust_score,0.5)),'timestampedRecords',count(source_timestamp)),now()
  from source_records group by provider
  on conflict(provider) do update set effective_trust_score=excluded.effective_trust_score,records_count=excluded.records_count,
    timestamp_coverage=excluded.timestamp_coverage,metrics=excluded.metrics,updated_at=now()
`);
const profiles = await sql.query("select provider,effective_trust_score from provider_trust_profiles");
const scoreByProvider = new Map(profiles.map((row) => [String(row.provider), Number(row.effective_trust_score || 0.5)]));
for (const row of profiles.filter((item) => String(item.provider).includes("+"))) {
  const rawComponents = [...new Set(String(row.provider).split("+").filter(Boolean))];
  const components = rawComponents.map((component) => componentAliases[component] || component);
  const scores = components.map((component) => scoreByProvider.get(component) ?? defaults[component] ?? 0.5);
  const weighted = scores.reduce((sum, value, index) => sum + value * (index === 0 ? 1.15 : 1), 0) /
    scores.reduce((sum, _value, index) => sum + (index === 0 ? 1.15 : 1), 0);
  await sql.query(
    `update provider_trust_profiles set effective_trust_score=$2,
      metrics=metrics||$3::jsonb,updated_at=now() where provider=$1`,
    [row.provider, Number(weighted.toFixed(4)), JSON.stringify({ normalizedComponents: components, componentScores: scores, scoringMethod: "component_weighted_v1" })]
  );
}
await sql.query(`
  update match_source_records msr set trust_score=p.effective_trust_score,updated_at=now()
  from provider_trust_profiles p where p.provider=msr.provider
`);
await sql.query(`
  insert into source_conflicts(source_conflict_id,entity_type,entity_key,field_name,candidate_values,selected_source_record_id,selected_value,resolution_method,status,resolved_at)
  select 'conflict_'||md5('match|'||msr.match_id||'|provider_identity'),'match',msr.match_id,'provider_identity',
    jsonb_agg(jsonb_build_object('provider',msr.provider,'sourceMatchId',msr.source_match_id,'trustScore',msr.trust_score) order by msr.trust_score desc nulls last),
    (array_agg(msr.source_record_id order by msr.trust_score desc nulls last))[1],
    to_jsonb((array_agg(msr.provider order by msr.trust_score desc nulls last))[1]),
    'highest_provider_trust','resolved',now()
  from match_source_records msr
  group by msr.match_id having count(distinct msr.provider)>1
  on conflict(entity_type,entity_key,field_name) do update set
    candidate_values=excluded.candidate_values,selected_source_record_id=excluded.selected_source_record_id,
    selected_value=excluded.selected_value,resolution_method=excluded.resolution_method,status='resolved',resolved_at=now(),updated_at=now()
`);
await sql.query(`
  update provider_trust_profiles p set
    conflict_rate=coalesce(x.conflicts::numeric/nullif(p.records_count,0),0),
    metrics=p.metrics||jsonb_build_object('conflicts',coalesce(x.conflicts,0)),
    updated_at=now()
  from (
    select msr.provider,count(distinct sc.source_conflict_id)::int conflicts
    from match_source_records msr join source_conflicts sc on sc.entity_key=msr.match_id
    group by msr.provider
  ) x where x.provider=p.provider
`);
await sql.query(`
  with ranked as (
    select match_id,source_record_id,row_number() over(partition by match_id order by coalesce(trust_score,0) desc,updated_at desc) rank
    from match_source_records
  )
  update match_source_records msr set is_primary=(r.rank=1),updated_at=now() from ranked r
  where r.match_id=msr.match_id and r.source_record_id=msr.source_record_id
`);
await sql.query(`
  update matches m set primary_source_record_id=msr.source_record_id,updated_at=now()
  from match_source_records msr where msr.match_id=m.match_id and msr.is_primary
`);
const [summary] = await sql.query("select count(1)::int providers,(select count(1)::int from matches where primary_source_record_id is not null) primary_matches,(select count(1)::int from source_conflicts) conflicts from provider_trust_profiles");
console.log(JSON.stringify(summary, null, 2));
