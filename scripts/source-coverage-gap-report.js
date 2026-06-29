#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const [summary] = await sql.query(`
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
    left join match_source_records msr on msr.match_id = s.match_id
    left join lateral unnest(string_to_array(msr.provider, '+')) provider_part on true
  ), counts as (
    select
      fixture_id,
      min(league) as league,
      count(distinct provider) filter (where provider is not null and provider <> '')::int as providers
    from expanded
    group by fixture_id
  )
  select
    count(*)::int as canonical_fixtures,
    count(*) filter (where providers >= 2)::int as with_backup_source,
    count(*) filter (where providers < 2)::int as missing_backup_source,
    round((count(*) filter (where providers >= 2))::numeric / greatest(count(*), 1), 3) as backup_coverage
  from counts
`);

const byLeague = await sql.query(`
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
    left join match_source_records msr on msr.match_id = s.match_id
    left join lateral unnest(string_to_array(msr.provider, '+')) provider_part on true
  ), counts as (
    select
      fixture_id,
      min(league) as league,
      count(distinct provider) filter (where provider is not null and provider <> '')::int as providers
    from expanded
    group by fixture_id
  )
  select
    league,
    count(*)::int as fixtures,
    count(*) filter (where providers >= 2)::int as with_backup,
    count(*) filter (where providers < 2)::int as missing_backup,
    round((count(*) filter (where providers >= 2))::numeric / greatest(count(*), 1), 3) as coverage
  from counts
  group by league
  order by missing_backup desc, fixtures desc, league
  limit 30
`);

const rows = await sql.query(`
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
      m.date_key,
      coalesce(nullif(m.league, ''), 'Unknown') as league,
      m.home_team_name,
      m.away_team_name,
      m.data_source
    from matches m
    left join alias_map a on a.match_id = m.match_id
    where m.date_key::date between current_date - 90 and current_date + 180
  ), expanded as (
    select s.fixture_id, trim(provider_part) as provider
    from scoped s
    left join match_source_records msr on msr.match_id = s.match_id
    left join lateral unnest(string_to_array(msr.provider, '+')) provider_part on true
  ), counts as (
    select
      fixture_id,
      count(distinct provider) filter (where provider is not null and provider <> '')::int as providers
    from expanded
    group by fixture_id
  ), representatives as (
    select distinct on (s.fixture_id)
      s.fixture_id,
      s.match_id,
      s.date_key,
      s.league,
      s.home_team_name,
      s.away_team_name,
      s.data_source,
      c.providers
    from scoped s
    join counts c on c.fixture_id = s.fixture_id
    where c.providers < 2
    order by s.fixture_id, s.match_id
  )
  select * from representatives
  order by date_key, league, home_team_name, away_team_name
`);

const leagueHints = new Map();
for (const row of rows) {
  const key = slug(row.league).replace(/\b(men|women|regular season|season|league|division)\b/g, "").trim();
  const bucket = leagueHints.get(key) || [];
  bucket.push(row);
  leagueHints.set(key, bucket);
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  summary,
  byLeague,
  missingSamples: rows.slice(0, 40),
  leagueBucketsWithManyGaps: [...leagueHints.entries()]
    .filter(([, items]) => items.length >= 5)
    .map(([bucket, items]) => ({
      bucket,
      missing: items.length,
      leagues: [...new Set(items.map((item) => item.league))].slice(0, 8),
    }))
    .sort((a, b) => b.missing - a.missing)
    .slice(0, 20),
}, null, 2));
