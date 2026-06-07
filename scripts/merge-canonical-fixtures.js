#!/usr/bin/env node

import crypto from "crypto";
import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);

const slug = (value) => String(value || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-");
const keyFor = (row) => `${row.date_key}|${row.home_club_id || `name-${slug(row.home_team_name)}`}|${row.away_club_id || `name-${slug(row.away_team_name)}`}`;
const idFor = (row) => `fixture_${crypto.createHash("sha1").update(keyFor(row)).digest("hex").slice(0, 24)}`;
const quality = (row) => Number(Boolean(row.home_club_id)) * 8 + Number(Boolean(row.away_club_id)) * 8
  + Number(Boolean(row.competition_id)) * 6 + Number(Boolean(row.season_id)) * 4
  + Number(Boolean(row.has_result)) * 10 + Number(Boolean(row.has_stats)) * 6 + Number(row.odds_count || 0);

const rows = await sql.query(`
  select m.*,
    exists(select 1 from match_results mr where mr.match_id=m.match_id) as has_result,
    exists(select 1 from match_stats ms where ms.match_id=m.match_id) as has_stats,
    (select count(*)::int from historical_odds_snapshots hos where hos.match_id=m.match_id) as odds_count
  from matches m where m.date_key is not null
`);
const groups = new Map();
for (const row of rows) {
  const id = idFor(row);
  groups.set(id, [...(groups.get(id) || []), row]);
}

async function registerFixtureAlias(canonicalFixtureId, targetMatchId, row) {
  const sourceId = String(row.source_match_id || row.match_id);
  const provider = String(row.data_source || "unknown");
  await sql.query(`
    insert into fixture_source_aliases (fixture_source_alias_id, canonical_fixture_id, canonical_match_id, source_match_id, provider, source_payload)
    values ($1,$2,$3,$4,$5,$6::jsonb)
    on conflict (provider, source_match_id) do update set canonical_fixture_id=excluded.canonical_fixture_id,
      canonical_match_id=excluded.canonical_match_id, source_payload=excluded.source_payload, updated_at=now()
  `, [`alias_${crypto.createHash("sha1").update(`${provider}|${sourceId}`).digest("hex").slice(0, 24)}`, canonicalFixtureId, targetMatchId, sourceId, provider,
    JSON.stringify({ originalMatchId: row.match_id, dateKey: row.date_key, league: row.league })]);
}

const singleGroups = [...groups.entries()].filter(([canonicalFixtureId, group]) => group.length === 1 && group[0].canonical_fixture_id !== canonicalFixtureId);
for (const [canonicalFixtureId, group] of [...groups.entries()]) {
  if (group.length === 1 && group[0].canonical_fixture_id === canonicalFixtureId) groups.delete(canonicalFixtureId);
}
for (let index = 0; index < singleGroups.length; index += 40) {
  await Promise.all(singleGroups.slice(index, index + 40).map(async ([canonicalFixtureId, [row]]) => {
    await sql.query("update matches set canonical_fixture_id=$1, updated_at=now() where match_id=$2 and canonical_fixture_id is distinct from $1", [canonicalFixtureId, row.match_id]);
    await registerFixtureAlias(canonicalFixtureId, row.match_id, row);
    groups.delete(canonicalFixtureId);
  }));
}

let mergedFixtures = 0;
let removedMatches = 0;
for (const [canonicalFixtureId, group] of groups) {
  group.sort((a, b) => quality(b) - quality(a) || String(a.match_id).localeCompare(String(b.match_id)));
  const target = group[0];
  await sql.query("update matches set canonical_fixture_id=$1, updated_at=now() where match_id=$2", [canonicalFixtureId, target.match_id]);
  for (const row of group) {
    await registerFixtureAlias(canonicalFixtureId, target.match_id, row);
  }
  const duplicates = group.slice(1).map((row) => row.match_id);
  if (!duplicates.length) continue;
  await sql.query(`
    insert into match_stats (match_id, halftime_home_goals, halftime_away_goals, home_xg, away_xg, home_shots, away_shots,
      home_shots_on_target, away_shots_on_target, home_corners, away_corners, home_yellow_cards, away_yellow_cards,
      home_red_cards, away_red_cards, home_possession, away_possession, stats_source, source_record_id)
    select $1, halftime_home_goals, halftime_away_goals, home_xg, away_xg, home_shots, away_shots,
      home_shots_on_target, away_shots_on_target, home_corners, away_corners, home_yellow_cards, away_yellow_cards,
      home_red_cards, away_red_cards, home_possession, away_possession, stats_source, source_record_id
    from match_stats where match_id=any($2::text[]) order by updated_at desc limit 1 on conflict (match_id) do nothing
  `, [target.match_id, duplicates]);
  await sql.query("delete from match_stats where match_id=any($1::text[])", [duplicates]);
  await sql.query("delete from team_match_stats d where d.match_id=any($1::text[]) and exists(select 1 from team_match_stats t where t.match_id=$2 and t.side=d.side)", [duplicates, target.match_id]);
  await sql.query("update team_match_stats set match_id=$1 where match_id=any($2::text[])", [target.match_id, duplicates]);
  await sql.query(`
    insert into match_results (match_id, final_home_goals, final_away_goals, actual_outcome, result_source, settled_at)
    select $1, final_home_goals, final_away_goals, actual_outcome, result_source, settled_at
    from match_results where match_id=any($2::text[]) order by settled_at desc nulls last limit 1 on conflict (match_id) do nothing
  `, [target.match_id, duplicates]);
  await sql.query("delete from match_results where match_id=any($1::text[])", [duplicates]);
  for (const table of ["historical_odds_snapshots", "prediction_snapshots", "prediction_evaluations", "injuries", "suspensions"]) {
    await sql.query(`update ${table} set match_id=$1 where match_id=any($2::text[])`, [target.match_id, duplicates]);
  }
  await sql.query(`
    insert into match_source_records (
      match_source_record_id, match_id, source_record_id, provider, source_match_id, is_primary, trust_score
    )
    select
      'match_source_' || md5($1 || '|' || source_record_id), $1, source_record_id, provider, source_match_id, false, trust_score
    from match_source_records
    where match_id=any($2::text[])
    on conflict (match_id, source_record_id) do update set
      provider=excluded.provider, source_match_id=excluded.source_match_id,
      trust_score=excluded.trust_score, updated_at=now()
  `, [target.match_id, duplicates]);
  await sql.query("delete from match_source_records where match_id=any($1::text[])", [duplicates]);
  await sql.query("delete from match_identity_quarantine where match_id=any($1::text[])", [duplicates]);
  await sql.query("delete from matches where match_id=any($1::text[])", [duplicates]);
  mergedFixtures += 1;
  removedMatches += duplicates.length;
}
console.log(JSON.stringify({ groups: groups.size, mergedFixtures, removedMatches }, null, 2));
