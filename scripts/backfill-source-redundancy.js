#!/usr/bin/env node

import crypto from "crypto";
import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

const digest = (value) => crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 24);
const startedAt = Date.now();

const [result] = await sql.query(`
  with alias_evidence as (
    select
      f.canonical_match_id as match_id,
      coalesce(nullif(trim(f.provider), ''), 'fixture-source-alias') as provider,
      f.source_match_id,
      f.source_payload,
      f.created_at,
      m.date_key,
      m.home_team_name,
      m.away_team_name
    from fixture_source_aliases f
    join matches m on m.match_id = f.canonical_match_id
    where m.date_key::date between current_date - 90 and current_date + 180
  ), inserted_sources as (
    insert into source_records (
      source_record_id, provider, source_url, entity_type, entity_key, fetched_at,
      source_timestamp, content_hash, trust_score, payload
    )
    select
      'fixture_alias_' || substr(md5(provider || '|' || source_match_id), 1, 24),
      provider,
      null,
      'fixture_alias',
      match_id,
      greatest(created_at, now() - interval '365 days'),
      null,
      substr(md5(provider || '|' || source_match_id || '|' || match_id), 1, 40),
      case
        when provider ilike '%openfootball%' then 0.82
        when provider ilike '%football-data%' then 0.80
        when provider ilike '%espn%' then 0.72
        when provider ilike '%thesportsdb%' then 0.68
        else 0.62
      end,
      jsonb_build_object(
        'sourceMatchId', source_match_id,
        'matchId', match_id,
        'homeTeam', home_team_name,
        'awayTeam', away_team_name,
        'dateKey', date_key,
        'sourcePayload', source_payload
      )
    from alias_evidence
    on conflict (source_record_id) do update set
      fetched_at = greatest(source_records.fetched_at, excluded.fetched_at),
      trust_score = greatest(coalesce(source_records.trust_score, 0), coalesce(excluded.trust_score, 0)),
      payload = source_records.payload || excluded.payload
    returning source_record_id
  ), inserted_match_sources as (
    insert into match_source_records (
      match_source_record_id, match_id, source_record_id, provider, source_match_id, is_primary, trust_score
    )
    select
      'msr_' || substr(md5(a.match_id || '|' || a.provider || '|' || a.source_match_id), 1, 24),
      a.match_id,
      'fixture_alias_' || substr(md5(a.provider || '|' || a.source_match_id), 1, 24),
      a.provider,
      a.source_match_id,
      false,
      case
        when a.provider ilike '%openfootball%' then 0.82
        when a.provider ilike '%football-data%' then 0.80
        when a.provider ilike '%espn%' then 0.72
        when a.provider ilike '%thesportsdb%' then 0.68
        else 0.62
      end
    from alias_evidence a
    on conflict (match_id, source_record_id) do update set
      provider = excluded.provider,
      source_match_id = excluded.source_match_id,
      trust_score = greatest(coalesce(match_source_records.trust_score, 0), coalesce(excluded.trust_score, 0)),
      updated_at = now()
    returning 1
  )
  select
    (select count(1)::int from alias_evidence) as alias_evidence,
    (select count(1)::int from inserted_sources) as source_records_upserted,
    (select count(1)::int from inserted_match_sources) as match_source_records_upserted
`);

console.log(JSON.stringify({ ...result, durationMs: Date.now() - startedAt }, null, 2));
