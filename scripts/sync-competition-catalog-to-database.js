#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";

const root = process.cwd();
loadLocalEnv(root);
const sql = getSql();
if (!sql) {
  console.error("DATABASE_URL of POSTGRES_URL ontbreekt.");
  process.exit(2);
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, "config", "competition-catalog.json"), "utf8"));
const slugify = (value) => String(value || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const digest = (value) => crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 20);
const normalizeName = (value) => String(value || "").trim().toLowerCase();

const competitions = [];
const countries = new Map();
const seasonRows = [];
const teamNames = new Set();
const membershipDrafts = [];
const standingsRows = [];

for (const competition of catalog.competitions || []) {
  const [countryLabel, competitionName] = competition.league.includes(" - ")
    ? competition.league.split(/\s+-\s+/, 2)
    : ["World", competition.league];
  const countryId = countryLabel === "Europe" || countryLabel === "World" ? null : `country-${slugify(countryLabel)}`;
  if (countryId) countries.set(countryId, countryLabel);

  const competitionId = `catalog-${competition.slug}`;
  const seasonId = `${competitionId}-${slugify(catalog.season)}`;
  const providerIds = {
    catalogSlug: competition.slug,
    membershipStatus: competition.membershipStatus,
    membershipSource: competition.membershipSource || null,
    membershipCheckedAt: competition.membershipCheckedAt || null,
  };
  competitions.push({
    competition_id: competitionId,
    name: competitionName,
    country_id: countryId,
    country_name: countryLabel,
    competition_type: competition.type,
    provider_ids: providerIds,
  });
  seasonRows.push({ season_id: seasonId, competition_id: competitionId, year_label: catalog.season });

  const standings = [];
  for (const [index, team] of (competition.teams || []).entries()) {
    teamNames.add(team);
    membershipDrafts.push({
      season_id: seasonId,
      competition_id: competitionId,
      team,
      status: competition.membershipStatus,
      competition: competition.league,
    });
    standings.push({ pos: index + 1, team, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
  }
  standingsRows.push({
    standings_snapshot_id: `catalog-zero-${digest(seasonId)}`,
    competition_id: competitionId,
    season_id: seasonId,
    standings,
    competition: competition.league,
    status: competition.membershipStatus,
  });
}

if (countries.size) {
  await sql.query(
    `with incoming as (
       select * from jsonb_to_recordset($1::jsonb) as x(country_id text, name text)
     )
     insert into countries (country_id, name)
     select country_id, name from incoming
     on conflict (country_id) do update set name=excluded.name, updated_at=now()`,
    [JSON.stringify([...countries].map(([country_id, name]) => ({ country_id, name })))]
  );
}

await sql.query(
  `with incoming as (
     select * from jsonb_to_recordset($1::jsonb) as x(
       competition_id text, name text, country_id text, country_name text, competition_type text, provider_ids jsonb
     )
   )
   insert into competitions (competition_id, name, country_id, country_name, competition_type, provider_ids)
   select competition_id, name, country_id, country_name, competition_type, provider_ids from incoming
   on conflict (competition_id) do update set
     name=excluded.name,
     country_id=excluded.country_id,
     country_name=excluded.country_name,
     competition_type=excluded.competition_type,
     provider_ids=competitions.provider_ids || excluded.provider_ids,
     updated_at=now()`,
  [JSON.stringify(competitions)]
);

for (const table of ["seasons", "competition_seasons"]) {
  await sql.query(
    `with incoming as (
       select * from jsonb_to_recordset($1::jsonb) as x(season_id text, competition_id text, year_label text)
     )
     insert into ${table} (season_id, competition_id, year_label, status)
     select season_id, competition_id, year_label, 'planned' from incoming
     on conflict (season_id) do update set
       competition_id=excluded.competition_id,
       year_label=excluded.year_label,
       status='planned',
       updated_at=now()`,
    [JSON.stringify(seasonRows)]
  );
}

const allTeamNames = [...teamNames].sort((left, right) => left.localeCompare(right, "en"));
const existingClubRows = allTeamNames.length
  ? await sql.query(
      `select distinct on (lower(name)) lower(name) as name_key, club_id
       from clubs
       where lower(name) = any($1::text[])
       order by lower(name), updated_at desc`,
      [allTeamNames.map(normalizeName)]
    )
  : [];
const clubByName = new Map(existingClubRows.map((row) => [row.name_key, row.club_id]));
const missingClubs = allTeamNames
  .filter((team) => !clubByName.has(normalizeName(team)))
  .map((team) => ({
    club_id: `club-${slugify(team)}-${digest(team).slice(0, 6)}`,
    name: team,
    provider_ids: { competitionCatalog: true },
  }));

if (missingClubs.length) {
  await sql.query(
    `with incoming as (
       select * from jsonb_to_recordset($1::jsonb) as x(club_id text, name text, provider_ids jsonb)
     )
     insert into clubs (club_id, name, provider_ids)
     select club_id, name, provider_ids from incoming
     on conflict (club_id) do update set
       name=excluded.name,
       provider_ids=clubs.provider_ids || excluded.provider_ids,
       updated_at=now()`,
    [JSON.stringify(missingClubs)]
  );
  for (const club of missingClubs) clubByName.set(normalizeName(club.name), club.club_id);
}

const memberships = membershipDrafts.map((row) => ({
  season_id: row.season_id,
  competition_id: row.competition_id,
  club_id: clubByName.get(normalizeName(row.team)),
  club_name: row.team,
  status: "active",
  entry_reason: "catalog_membership",
  source: "competition-catalog",
  competition: row.competition,
  membership_status: row.status,
}));

await sql.query(
  `with incoming as (
     select * from jsonb_to_recordset($1::jsonb) as x(
       season_id text, competition_id text, club_id text, club_name text, status text, entry_reason text, source text
     )
   )
   insert into competition_season_clubs (season_id, competition_id, club_id, club_name, status, entry_reason, source)
   select season_id, competition_id, club_id, club_name, status, entry_reason, source from incoming
   on conflict (season_id, club_id) do update set
     competition_id=excluded.competition_id,
     club_name=excluded.club_name,
     status=excluded.status,
     entry_reason=excluded.entry_reason,
     source=excluded.source,
     updated_at=now()`,
  [JSON.stringify(memberships)]
);

const activeBySeason = new Map();
for (const row of memberships) {
  if (!activeBySeason.has(row.season_id)) activeBySeason.set(row.season_id, []);
  activeBySeason.get(row.season_id).push(row.club_id);
}
for (const [seasonId, activeClubIds] of activeBySeason) {
  await sql.query(
    `delete from competition_season_clubs
     where season_id=$1 and source='competition-catalog' and not (club_id = any($2::text[]))`,
    [seasonId, activeClubIds]
  );
}

const standingsWithClubIds = standingsRows.map((row) => ({
  ...row,
  standings: row.standings.map((standing) => ({
    ...standing,
    teamId: clubByName.get(normalizeName(standing.team)),
  })),
}));

await sql.query(
  `with incoming as (
     select * from jsonb_to_recordset($1::jsonb) as x(
       standings_snapshot_id text, competition_id text, season_id text, standings jsonb
     )
   )
   insert into standings_snapshots (standings_snapshot_id, competition_id, season_id, captured_at, source, standings)
   select standings_snapshot_id, competition_id, season_id, now(), 'competition-catalog-zero', standings from incoming
   on conflict (standings_snapshot_id) do update set
     captured_at=excluded.captured_at,
     standings=excluded.standings`,
  [JSON.stringify(standingsWithClubIds)]
);

const summary = standingsWithClubIds.map((row) => ({
  competition: row.competition,
  teams: row.standings.length,
  status: row.status,
}));

console.log(JSON.stringify({
  ok: true,
  season: catalog.season,
  competitions: summary.length,
  memberships: memberships.length,
  insertedClubs: missingClubs.length,
  summary,
}, null, 2));
