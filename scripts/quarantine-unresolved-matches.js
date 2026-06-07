#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  console.error("DATABASE_URL of POSTGRES_URL ontbreekt.");
  process.exit(2);
}

await sql.query(`
  with identity_audit as (
    select match_id, jsonb_strip_nulls(jsonb_build_object(
      'home_club_id', case when home_club_id is null then true end,
      'away_club_id', case when away_club_id is null then true end,
      'competition_id', case when competition_id is null then true end,
      'season_id', case when season_id is null then true end
    )) as missing
    from matches
  )
  update matches m
  set identity_status = case when a.missing = '{}'::jsonb then 'resolved' else 'quarantined' end,
      identity_missing_fields = coalesce((select jsonb_agg(key order by key) from jsonb_each(a.missing)), '[]'::jsonb),
      quarantined_at = case when a.missing = '{}'::jsonb then null else coalesce(m.quarantined_at, now()) end,
      updated_at = now()
  from identity_audit a
  where a.match_id = m.match_id
`);

await sql.query(`
  insert into match_identity_quarantine (
    quarantine_id, match_id, missing_fields, status, quarantined_at, updated_at
  )
  select 'identity_' || md5(match_id), match_id, identity_missing_fields, 'pending', coalesce(quarantined_at, now()), now()
  from matches
  where identity_status = 'quarantined'
  on conflict (match_id) do update set
    missing_fields = excluded.missing_fields,
    status = case when match_identity_quarantine.status = 'ignored' then 'ignored' else 'pending' end,
    resolved_at = null,
    updated_at = now()
`);

await sql.query(`
  update match_identity_quarantine q
  set status = 'resolved', resolved_at = coalesce(q.resolved_at, now()), updated_at = now()
  from matches m
  where m.match_id = q.match_id and m.identity_status = 'resolved' and q.status <> 'resolved'
`);

const [summary] = await sql.query(`
  select
    count(*)::int as total_matches,
    count(*) filter (where identity_status = 'resolved')::int as resolved_matches,
    count(*) filter (where identity_status = 'quarantined')::int as quarantined_matches,
    (select count(*)::int from match_identity_quarantine where status = 'pending') as pending_quarantine
  from matches
`);
console.log(JSON.stringify(summary, null, 2));
