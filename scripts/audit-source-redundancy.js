#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

const [coverage] = await sql.query(`
  with alias_map as (
    select distinct
      nullif(source_payload->>'originalMatchId', '') as match_id,
      canonical_fixture_id as fixture_id
    from fixture_source_aliases
    where nullif(source_payload->>'originalMatchId', '') is not null
  ), scoped as (
    select m.match_id, coalesce(a.fixture_id, m.canonical_fixture_id, m.match_id) as fixture_id
    from matches m
    left join alias_map a on a.match_id = m.match_id
    where m.date_key::date between current_date - 90 and current_date + 180
  ), expanded as (
    select s.fixture_id, trim(provider_part) as provider
    from scoped s
    join match_source_records msr on msr.match_id = s.match_id
    cross join lateral unnest(string_to_array(msr.provider, '+')) provider_part
  ), counts as (
    select s.fixture_id, count(distinct e.provider)::int as providers
    from (select distinct fixture_id from scoped) s
    left join expanded e on e.fixture_id = s.fixture_id
    group by s.fixture_id
  )
  select count(*)::int as canonical_fixtures,
    count(*) filter (where providers >= 1)::int as with_primary_source,
    count(*) filter (where providers >= 2)::int as with_backup_source,
    round(avg(providers), 2) as average_providers,
    max(providers)::int as maximum_providers
  from counts
`);

const segments = await sql.query(`
  with alias_map as (
    select distinct
      nullif(source_payload->>'originalMatchId', '') as match_id,
      canonical_fixture_id as fixture_id
    from fixture_source_aliases
    where nullif(source_payload->>'originalMatchId', '') is not null
  ), scoped as (
    select
      m.match_id,
      coalesce(a.fixture_id, m.canonical_fixture_id, m.match_id) as fixture_id,
      coalesce(nullif(m.league, ''), 'Unknown') as league
    from matches m
    left join alias_map a on a.match_id = m.match_id
    where m.date_key::date between current_date - 90 and current_date + 180
  ), expanded as (
    select s.fixture_id, s.league, trim(provider_part) as provider
    from scoped s
    join match_source_records msr on msr.match_id = s.match_id
    cross join lateral unnest(string_to_array(msr.provider, '+')) provider_part
  ), counts as (
    select
      s.fixture_id,
      min(s.league) as league,
      count(distinct e.provider)::int as providers
    from (select distinct fixture_id, league from scoped) s
    left join expanded e on e.fixture_id = s.fixture_id
    group by s.fixture_id
  ), labeled as (
    select
      case
        when league ilike '%World Cup%' then 'world_cup_placeholders'
        when league ilike '%Friendly%' then 'friendlies'
        when league ilike 'Europe - %' then 'uefa_competitions'
        else 'domestic_leagues'
      end as segment,
      providers
    from counts
  )
  select
    segment,
    count(*)::int as canonical_fixtures,
    count(*) filter (where providers >= 2)::int as with_backup_source,
    count(*) filter (where providers < 2)::int as missing_backup_source,
    round((count(*) filter (where providers >= 2))::numeric / greatest(count(*), 1), 3) as backup_source_coverage
  from labeled
  group by segment
  order by segment
`);

const providers = await sql.query(`
  with alias_map as (
    select distinct
      nullif(source_payload->>'originalMatchId', '') as match_id,
      canonical_fixture_id as fixture_id
    from fixture_source_aliases
    where nullif(source_payload->>'originalMatchId', '') is not null
  )
  select trim(provider_part) as provider, count(distinct coalesce(a.fixture_id, m.canonical_fixture_id, m.match_id))::int as matches,
    count(*) filter (where is_primary)::int as primary_links,
    round(avg(coalesce(trust_score, 0.5)), 3) as average_trust
  from match_source_records
  join matches m on m.match_id = match_source_records.match_id
  left join alias_map a on a.match_id = m.match_id
  cross join lateral unnest(string_to_array(provider, '+')) provider_part
  group by trim(provider_part)
  order by matches desc, provider
`);

const fields = await sql.query(`
  select field_name,
    count(distinct prediction_id)::int as predictions,
    count(distinct source)::int as independent_sources,
    round(count(*) filter (where available)::numeric / greatest(count(*), 1), 3) as availability,
    round(count(*) filter (where source_timestamp_known)::numeric / greatest(count(*), 1), 3) as timestamp_coverage
  from source_audit
  group by field_name
  order by field_name
`);

const sourceFamilies = {
  fixtures: ["Sofascore", "ESPN", "TheSportsDB", "OpenLigaDB", "football-data.org"],
  h2h: ["API-Football", "openfootball", "canonical match history"],
  statistics: ["StatsBomb", "Understat", "FBref", "football-data.co.uk"],
  odds: ["The Odds API", "football-data.co.uk"],
  squadsAndAvailability: ["Sofascore", "football-data.org", "Forza Football"],
};
const matches = Number(coverage?.canonical_fixtures || coverage?.matches || 0);
const backupCoverage = matches ? Number(coverage?.with_backup_source || 0) / matches : null;
const report = {
  generatedAt: new Date().toISOString(),
  scope: "matches from 90 days ago through 180 days ahead",
  status: backupCoverage == null ? "no_matches" : backupCoverage >= 0.8 ? "healthy" : backupCoverage >= 0.5 ? "warning" : "needs_attention",
  coverage: {
    ...coverage,
    matches,
    primarySourceCoverage: matches ? Number((Number(coverage.with_primary_source || 0) / matches).toFixed(3)) : null,
    backupSourceCoverage: backupCoverage == null ? null : Number(backupCoverage.toFixed(3)),
  },
  segments,
  providers,
  predictionFields: fields,
  configuredSourceFamilies: sourceFamilies,
  interpretation: "Meerdere bronnen worden als aanvulling en controle gebruikt; conflicten worden via providertrust opgelost. Geen willekeurige bron overschrijft automatisch de primaire waarheid.",
};

console.log(JSON.stringify(report, null, 2));
