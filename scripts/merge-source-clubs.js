#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  console.error("DATABASE_URL of POSTGRES_URL ontbreekt.");
  process.exit(2);
}

function slug(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-");
}

const NAME_EQUIVALENTS = new Map(Object.entries({
  "afc-bournemouth": "bournemouth",
  "brighton-hove-albion": "brighton",
  "man-city": "manchester-city",
  "man-united": "manchester-united",
  "newcastle": "newcastle-united",
  "nottm-forest": "nottingham-forest",
  "spurs": "tottenham-hotspur",
  "tottenham": "tottenham-hotspur",
  "west-ham": "west-ham-united",
  "wolves": "wolverhampton-wanderers",
  "ajax": "afc-ajax",
  "az": "az-alkmaar",
  "feyenoord": "feyenoord-rotterdam",
  "groningen": "fc-groningen",
  "twente": "fc-twente",
  "utrecht": "fc-utrecht",
  "alaves": "deportivo-alaves",
  "leeds": "leeds-united",
  "paris-sg": "paris-saint-germain",
}));

function canonicalNameKey(name) {
  const compact = slug(name)
    .replace(/(^|-)(football-club|futbol-club|club-de-futbol|fc|afc|cf|sc|ssc|ac|as|calcio)(-|$)/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return NAME_EQUIVALENTS.get(slug(name)) || NAME_EQUIVALENTS.get(compact) || compact;
}

const clubs = await sql.query(
  `select club_id, name, country_id, country_name, stadium, venue_id, provider_ids, history from clubs order by country_id, name`
);
const groups = new Map();
for (const club of clubs) {
  const countryKey = club.country_id || slug(club.country_name || "international");
  const nameKey = canonicalNameKey(club.name);
  const key = `${countryKey}|${nameKey}`;
  const group = groups.get(key) || [];
  group.push(club);
  groups.set(key, group);
}

let mergedGroups = 0;
let removedClubs = 0;
let retainedReferencedClubs = 0;
for (const [key, group] of groups.entries()) {
  const [countryKey, nameKey] = key.split("|");
  const canonicalClubId = `club-${countryKey}-${nameKey}`;
  if (group.length === 1 && group[0].club_id === canonicalClubId) continue;
  const preferred = group.find((club) => club.club_id === `club-${countryKey}-${nameKey}`)
    || group.find((club) => String(club.club_id).startsWith("club-"))
    || group[0];
  const providerIds = Object.assign({}, ...group.map((club) => club.provider_ids || {}));
  const history = Object.assign({}, ...group.map((club) => club.history || {}));
  const oldIds = group.map((club) => club.club_id).filter((clubId) => clubId !== canonicalClubId);
  const referenceSnapshot = {
    homeMatches: (await sql.query("select match_id,home_club_id club_id from matches where home_club_id=any($1::text[])", [oldIds])),
    awayMatches: (await sql.query("select match_id,away_club_id club_id from matches where away_club_id=any($1::text[])", [oldIds])),
    teamMatchStats: (await sql.query("select team_match_stats_id,club_id from team_match_stats where club_id=any($1::text[])", [oldIds])),
    teamSeasonStats: (await sql.query("select team_season_stats_id,club_id from team_season_stats where club_id=any($1::text[])", [oldIds])),
    competitionSeasonClubs: (await sql.query("select * from competition_season_clubs where club_id=any($1::text[])", [oldIds])),
    aliases: (await sql.query("select alias,normalized_alias,source,club_id from club_aliases where club_id=any($1::text[])", [oldIds])),
    players: (await sql.query("select player_id,club_id from players where club_id=any($1::text[])", [oldIds])),
    squads: (await sql.query("select squad_id,club_id from squads where club_id=any($1::text[])", [oldIds])),
    injuries: (await sql.query("select injury_id,club_id from injuries where club_id=any($1::text[])", [oldIds])),
    suspensions: (await sql.query("select suspension_id,club_id from suspensions where club_id=any($1::text[])", [oldIds])),
  };
  const canonicalSnapshot = group.find((club) => club.club_id === canonicalClubId) || {};
  await sql.query(`insert into club_merge_audit(canonical_club_id,merged_club_ids,canonical_snapshot,merged_club_snapshots,reference_counts,reference_snapshot,merge_reason)
    values($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,'canonical_name_equivalence_v1')`, [
    canonicalClubId, JSON.stringify(oldIds), JSON.stringify(canonicalSnapshot), JSON.stringify(group.filter((club) => oldIds.includes(club.club_id))),
    JSON.stringify(Object.fromEntries(Object.entries(referenceSnapshot).map(([key, rows]) => [key, rows.length]))), JSON.stringify(referenceSnapshot),
  ]);

  await sql.query(
    `
      insert into clubs (club_id, name, country_id, country_name, stadium, venue_id, provider_ids, history)
      values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
      on conflict (club_id) do update set
        name = excluded.name,
        country_id = coalesce(clubs.country_id, excluded.country_id),
        country_name = coalesce(clubs.country_name, excluded.country_name),
        stadium = coalesce(clubs.stadium, excluded.stadium),
        venue_id = coalesce(clubs.venue_id, excluded.venue_id),
        provider_ids = clubs.provider_ids || excluded.provider_ids,
        history = clubs.history || excluded.history,
        updated_at = now()
    `,
    [canonicalClubId, preferred.name, preferred.country_id, preferred.country_name, preferred.stadium, preferred.venue_id, JSON.stringify(providerIds), JSON.stringify(history)]
  );
  for (const club of group) {
    await sql.query(
      `insert into club_aliases (club_id, alias, normalized_alias, source) values ($1,$2,$3,'canonical-club-merge') on conflict (club_id, normalized_alias) do nothing`,
      [canonicalClubId, club.name, slug(club.name)]
    );
    await sql.query(
      `
        insert into club_aliases (club_id, alias, normalized_alias, source)
        select $1, alias, normalized_alias, source from club_aliases where club_id = $2
        on conflict (club_id, normalized_alias) do nothing
      `,
      [canonicalClubId, club.club_id]
    );
  }
  if (!oldIds.length) continue;

  await sql.query(
    `
      insert into competition_season_clubs (
        season_id, competition_id, club_id, club_name, status, entry_reason, previous_season_id,
        previous_level, previous_standing_position, previous_standing_points, previous_standing_source,
        current_level, source, source_record_id
      )
      select season_id, competition_id, $1, $2, status, entry_reason, previous_season_id,
        previous_level, previous_standing_position, previous_standing_points, previous_standing_source,
        current_level, source, source_record_id
      from competition_season_clubs where club_id = any($3::text[])
      on conflict (season_id, club_id) do update set club_name = excluded.club_name, updated_at = now()
    `,
    [canonicalClubId, preferred.name, oldIds]
  );
  await sql.query("delete from competition_season_clubs where club_id = any($1::text[])", [oldIds]);
  await sql.query("delete from h2h_edges where home_club_id = any($1::text[]) or away_club_id = any($1::text[]) or home_club_id = $2 or away_club_id = $2", [oldIds, canonicalClubId]);
  await sql.query("update matches set home_club_id = $1 where home_club_id = any($2::text[])", [canonicalClubId, oldIds]);
  await sql.query("update matches set away_club_id = $1 where away_club_id = any($2::text[])", [canonicalClubId, oldIds]);
  await sql.query("update team_match_stats set club_id = $1 where club_id = any($2::text[])", [canonicalClubId, oldIds]);
  await sql.query("update team_season_stats set club_id = $1 where club_id = any($2::text[])", [canonicalClubId, oldIds]);
  await sql.query("update players set club_id = $1 where club_id = any($2::text[])", [canonicalClubId, oldIds]);
  await sql.query("delete from squads where club_id = any($1::text[]) and exists (select 1 from squads target where target.season_id = squads.season_id and target.club_id = $2 and target.player_id = squads.player_id)", [oldIds, canonicalClubId]);
  await sql.query("update squads set club_id = $1 where club_id = any($2::text[])", [canonicalClubId, oldIds]);
  await sql.query("update injuries set club_id = $1 where club_id = any($2::text[])", [canonicalClubId, oldIds]);
  await sql.query("update suspensions set club_id = $1 where club_id = any($2::text[])", [canonicalClubId, oldIds]);
  await sql.query("delete from club_aliases where club_id = any($1::text[])", [oldIds]);
  const deletedClubs = await sql.query(
    `
      delete from clubs c
      where c.club_id = any($1::text[])
        and not exists (
          select 1 from matches m
          where m.home_club_id = c.club_id or m.away_club_id = c.club_id
        )
      returning c.club_id
    `,
    [oldIds]
  );
  mergedGroups += 1;
  removedClubs += deletedClubs.length;
  retainedReferencedClubs += oldIds.length - deletedClubs.length;
}

console.log(JSON.stringify({ ok: true, groups: groups.size, mergedGroups, removedClubs, retainedReferencedClubs }, null, 2));
