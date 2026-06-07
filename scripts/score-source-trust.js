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
  with accuracy as (
    select msr.provider,count(1)::int settled_records,sum((
        case
          when jsonb_typeof(sr.payload->'score') = 'object'
            and jsonb_typeof(sr.payload#>'{score,ft}') = 'array'
          then (sr.payload#>>'{score,ft,0}') || '-' || (sr.payload#>>'{score,ft,1}')
          else regexp_replace(coalesce(sr.payload->>'score',sr.payload->>'finalScore',''),'\\s','','g')
        end
        = mr.final_home_goals::text||'-'||mr.final_away_goals::text
      )::int)::numeric correct_records,
      avg((
        case
          when jsonb_typeof(sr.payload->'score') = 'object'
            and jsonb_typeof(sr.payload#>'{score,ft}') = 'array'
          then (sr.payload#>>'{score,ft,0}') || '-' || (sr.payload#>>'{score,ft,1}')
          else regexp_replace(coalesce(sr.payload->>'score',sr.payload->>'finalScore',''),'\\s','','g')
        end
        = mr.final_home_goals::text||'-'||mr.final_away_goals::text
      )::int)::numeric result_accuracy
    from match_source_records msr join source_records sr on sr.source_record_id=msr.source_record_id
    join match_results mr on mr.match_id=msr.match_id
    where nullif(
      case
        when jsonb_typeof(sr.payload->'score') = 'object'
          and jsonb_typeof(sr.payload#>'{score,ft}') = 'array'
        then (sr.payload#>>'{score,ft,0}') || '-' || (sr.payload#>>'{score,ft,1}')
        else regexp_replace(coalesce(sr.payload->>'score',sr.payload->>'finalScore',''),'\\s','','g')
      end,
      ''
    ) is not null
    group by msr.provider
  ), corrected as (
    select a.*,p.base_trust_score,
      (a.correct_records + p.base_trust_score * 50) / (a.settled_records + 50) bayesian_accuracy,
      greatest(0,(
        a.result_accuracy + 1.9208/a.settled_records -
        1.96*sqrt((a.result_accuracy*(1-a.result_accuracy)+0.9604/a.settled_records)/a.settled_records)
      )/(1+3.8416/a.settled_records)) wilson_lower_bound
    from accuracy a join provider_trust_profiles p on p.provider=a.provider
  )
  update provider_trust_profiles p set
    resolution_win_rate=c.bayesian_accuracy,
    effective_trust_score=least(0.99,greatest(0.1,p.effective_trust_score*0.65+(c.bayesian_accuracy*0.7+c.wilson_lower_bound*0.3)*0.35)),
    metrics=p.metrics||jsonb_build_object(
      'rawResultAccuracy',c.result_accuracy,'resultAccuracy',c.bayesian_accuracy,'wilsonLowerBound',c.wilson_lower_bound,
      'settledRecords',c.settled_records,'priorStrength',50,'scoringMethod','bayesian_wilson_outcome_v3'
    ),
    updated_at=now()
  from corrected c where c.provider=p.provider
`);
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
const fieldContracts = [
  ["score", `case when jsonb_typeof(sr.payload#>'{score,ft}')='array' then (sr.payload#>>'{score,ft,0}')||'-'||(sr.payload#>>'{score,ft,1}')
    when jsonb_typeof(sr.payload->'score')='array' then (sr.payload#>>'{score,0}')||'-'||(sr.payload#>>'{score,1}')
    else coalesce(sr.payload->>'score',sr.payload->>'finalScore') end`, "mr.final_home_goals::text||'-'||mr.final_away_goals::text"],
  ["kickoff", "coalesce(sr.payload->>'kickoff',sr.payload->>'kickoff_at')", "m.kickoff_at::text"],
  ["status", "upper(coalesce(sr.payload->>'status',sr.payload->>'status_normalized'))", "upper(coalesce(m.status_normalized,m.status))"],
  ["home_club_id", `(select ca.club_id from club_aliases ca where ca.normalized_alias=trim(both '-' from lower(regexp_replace(coalesce(sr.payload->>'homeTeamName',sr.payload->>'HomeTeam',sr.payload->>'team1',sr.payload#>>'{homeTeam,name}'),'[^a-zA-Z0-9]+','-','g'))) limit 1)`, "m.home_club_id"],
  ["away_club_id", `(select ca.club_id from club_aliases ca where ca.normalized_alias=trim(both '-' from lower(regexp_replace(coalesce(sr.payload->>'awayTeamName',sr.payload->>'AwayTeam',sr.payload->>'team2',sr.payload#>>'{awayTeam,name}'),'[^a-zA-Z0-9]+','-','g'))) limit 1)`, "m.away_club_id"],
];
for (const [field, sourceValue, canonicalValue] of fieldContracts) {
  await sql.query(`
    with scored as (
      select msr.provider,count(1)::int samples,sum((${sourceValue}=${canonicalValue})::int)::numeric correct,
        avg((${sourceValue}=${canonicalValue})::int)::numeric raw_accuracy
      from match_source_records msr join source_records sr on sr.source_record_id=msr.source_record_id
      join matches m on m.match_id=msr.match_id left join match_results mr on mr.match_id=m.match_id
      where nullif(${sourceValue},'') is not null and nullif(${canonicalValue},'') is not null group by msr.provider
    ), corrected as (
      select s.*,p.effective_trust_score prior,
        (s.correct+p.effective_trust_score*30)/(s.samples+30) bayesian_accuracy,
        greatest(0,(s.raw_accuracy+1.9208/s.samples-1.96*sqrt((s.raw_accuracy*(1-s.raw_accuracy)+0.9604/s.samples)/s.samples))/(1+3.8416/s.samples)) wilson
      from scored s join provider_trust_profiles p on p.provider=s.provider
    )
    insert into provider_field_trust_profiles(provider,field_name,effective_trust_score,raw_accuracy,bayesian_accuracy,wilson_lower_bound,samples,metrics,updated_at)
    select provider,$1,least(0.99,greatest(0.1,bayesian_accuracy*0.7+wilson*0.3)),raw_accuracy,bayesian_accuracy,wilson,samples,
      jsonb_build_object('priorStrength',30,'method','bayesian_wilson_field_v1'),now() from corrected
    on conflict(provider,field_name) do update set effective_trust_score=excluded.effective_trust_score,raw_accuracy=excluded.raw_accuracy,
      bayesian_accuracy=excluded.bayesian_accuracy,wilson_lower_bound=excluded.wilson_lower_bound,samples=excluded.samples,metrics=excluded.metrics,updated_at=now()
  `, [field]);
}
const directFieldTrust = [
  ["odds", `select hos.provider,count(1)::int samples,
    avg((hos.home>1 and hos.draw>1 and hos.away>1 and hos.captured_at is not null and hos.captured_at<m.kickoff_at)::int)::numeric raw_accuracy
    from historical_odds_snapshots hos join matches m on m.match_id=hos.match_id group by hos.provider`],
  ["xg", `select ms.stats_source provider,count(1)::int samples,
    avg((ms.home_xg>=0 and ms.away_xg>=0 and ms.home_xg<15 and ms.away_xg<15)::int)::numeric raw_accuracy
    from match_stats ms where ms.home_xg is not null and ms.away_xg is not null group by ms.stats_source`],
  ["match_stats", `select ms.stats_source provider,count(1)::int samples,
    avg((coalesce(ms.home_shots,0)>=coalesce(ms.home_shots_on_target,0) and coalesce(ms.away_shots,0)>=coalesce(ms.away_shots_on_target,0)
      and coalesce(ms.home_red_cards,0)<=coalesce(ms.home_yellow_cards,0)+3 and coalesce(ms.away_red_cards,0)<=coalesce(ms.away_yellow_cards,0)+3)::int)::numeric raw_accuracy
    from match_stats ms where ms.stats_source is not null group by ms.stats_source`],
];
for (const [field, query] of directFieldTrust) {
  await sql.query(`
    with scored as (${query}), corrected as (
      select s.*,coalesce(p.effective_trust_score,0.5) prior,(s.raw_accuracy*s.samples+coalesce(p.effective_trust_score,0.5)*30)/(s.samples+30) bayesian_accuracy,
        greatest(0,(s.raw_accuracy+1.9208/s.samples-1.96*sqrt((s.raw_accuracy*(1-s.raw_accuracy)+0.9604/s.samples)/s.samples))/(1+3.8416/s.samples)) wilson
      from scored s left join provider_trust_profiles p on p.provider=s.provider
    )
    insert into provider_field_trust_profiles(provider,field_name,effective_trust_score,raw_accuracy,bayesian_accuracy,wilson_lower_bound,samples,metrics,updated_at)
    select provider,$1,least(0.99,greatest(0.1,bayesian_accuracy*0.7+wilson*0.3)),raw_accuracy,bayesian_accuracy,wilson,samples,
      jsonb_build_object('priorStrength',30,'method','quality_contract_bayesian_wilson_v1'),now() from corrected
    on conflict(provider,field_name) do update set effective_trust_score=excluded.effective_trust_score,raw_accuracy=excluded.raw_accuracy,
      bayesian_accuracy=excluded.bayesian_accuracy,wilson_lower_bound=excluded.wilson_lower_bound,samples=excluded.samples,metrics=excluded.metrics,updated_at=now()
  `, [field]);
}
const [summary] = await sql.query("select count(1)::int providers,(select count(1)::int from matches where primary_source_record_id is not null) primary_matches,(select count(1)::int from source_conflicts) conflicts from provider_trust_profiles");
console.log(JSON.stringify(summary, null, 2));
