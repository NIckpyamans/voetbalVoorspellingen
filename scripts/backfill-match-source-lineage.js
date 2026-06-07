#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  console.error("DATABASE_URL of POSTGRES_URL ontbreekt.");
  process.exit(2);
}

await sql.query(`
  insert into source_records (
    source_record_id, provider, entity_type, entity_key, source_timestamp, content_hash, trust_score, payload
  )
  select
    'src_match_' || md5(m.match_id || '|' || coalesce(m.data_source, 'unknown')),
    coalesce(nullif(m.data_source, ''), 'unknown'),
    'match',
    m.match_id,
    m.kickoff_at,
    md5(coalesce(m.raw_payload::text, '{}')),
    case when m.identity_status = 'resolved' then 0.75 else 0.35 end,
    coalesce(m.raw_payload, '{}'::jsonb) ||
      jsonb_build_object('matchId', m.match_id, 'sourceMatchId', m.source_match_id, 'lineageBackfill', true)
  from matches m
  on conflict (source_record_id) do update set
    fetched_at = now(),
    source_timestamp = excluded.source_timestamp,
    content_hash = excluded.content_hash,
    trust_score = excluded.trust_score,
    payload = excluded.payload
`);

await sql.query(`
  insert into match_source_records (
    match_source_record_id, match_id, source_record_id, provider, source_match_id, is_primary, trust_score
  )
  select
    'match_source_' || md5(m.match_id || '|' || sr.source_record_id),
    m.match_id,
    sr.source_record_id,
    sr.provider,
    m.source_match_id,
    true,
    sr.trust_score
  from matches m
  join source_records sr
    on sr.source_record_id = 'src_match_' || md5(m.match_id || '|' || coalesce(m.data_source, 'unknown'))
  on conflict (match_id, source_record_id) do update set
    provider = excluded.provider,
    source_match_id = excluded.source_match_id,
    is_primary = true,
    trust_score = excluded.trust_score,
    updated_at = now()
`);

await sql.query(`
  update matches m
  set primary_source_record_id = msr.source_record_id, updated_at = now()
  from match_source_records msr
  where msr.match_id = m.match_id and msr.is_primary = true
    and m.primary_source_record_id is distinct from msr.source_record_id
`);

const [summary] = await sql.query(`
  select
    count(*)::int as total_matches,
    count(primary_source_record_id)::int as matches_with_primary_source,
    count(*) filter (where primary_source_record_id is null)::int as matches_without_primary_source,
    (select count(*)::int from match_source_records) as direct_match_source_links
  from matches
`);
console.log(JSON.stringify(summary, null, 2));
