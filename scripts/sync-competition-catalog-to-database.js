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
const summary = [];

async function resolveClubId(team) {
  const rows = await sql.query(
    `select club_id from clubs where lower(name)=lower($1) order by updated_at desc limit 1`,
    [team]
  );
  if (rows[0]?.club_id) return rows[0].club_id;
  const clubId = `club-${slugify(team)}-${digest(team).slice(0, 6)}`;
  await sql.query(
    `insert into clubs (club_id,name,provider_ids) values ($1,$2,$3::jsonb)
     on conflict (club_id) do update set name=excluded.name, provider_ids=clubs.provider_ids||excluded.provider_ids, updated_at=now()`,
    [clubId, team, JSON.stringify({ competitionCatalog: true })]
  );
  return clubId;
}

for (const competition of catalog.competitions || []) {
  const [countryLabel, competitionName] = competition.league.includes(" - ")
    ? competition.league.split(/\s+-\s+/, 2)
    : ["World", competition.league];
  const countryId = countryLabel === "Europe" || countryLabel === "World" ? null : `country-${slugify(countryLabel)}`;
  if (countryId) {
    await sql.query(
      `insert into countries (country_id,name) values ($1,$2)
       on conflict (country_id) do update set name=excluded.name, updated_at=now()`,
      [countryId, countryLabel]
    );
  }

  const competitionId = `catalog-${competition.slug}`;
  const seasonId = `${competitionId}-${slugify(catalog.season)}`;
  const providerIds = {
    catalogSlug: competition.slug,
    membershipStatus: competition.membershipStatus,
    membershipSource: competition.membershipSource || null,
    membershipCheckedAt: competition.membershipCheckedAt || null,
  };
  await sql.query(
    `insert into competitions (competition_id,name,country_id,country_name,competition_type,provider_ids)
     values ($1,$2,$3,$4,$5,$6::jsonb)
     on conflict (competition_id) do update set name=excluded.name,country_id=excluded.country_id,country_name=excluded.country_name,
       competition_type=excluded.competition_type,provider_ids=competitions.provider_ids||excluded.provider_ids,updated_at=now()`,
    [competitionId, competitionName, countryId, countryLabel, competition.type, JSON.stringify(providerIds)]
  );
  for (const table of ["seasons", "competition_seasons"]) {
    await sql.query(
      `insert into ${table} (season_id,competition_id,year_label,status) values ($1,$2,$3,'planned')
       on conflict (season_id) do update set competition_id=excluded.competition_id,year_label=excluded.year_label,status='planned',updated_at=now()`,
      [seasonId, competitionId, catalog.season]
    );
  }

  const activeClubIds = [];
  const standings = [];
  for (const [index, team] of (competition.teams || []).entries()) {
    const clubId = await resolveClubId(team);
    activeClubIds.push(clubId);
    await sql.query(
      `insert into competition_season_clubs (season_id,competition_id,club_id,club_name,status,entry_reason,source)
       values ($1,$2,$3,$4,'active','catalog_membership','competition-catalog')
       on conflict (season_id,club_id) do update set competition_id=excluded.competition_id,club_name=excluded.club_name,
         status='active',entry_reason=excluded.entry_reason,source=excluded.source,updated_at=now()`,
      [seasonId, competitionId, clubId, team]
    );
    standings.push({ pos: index + 1, team, teamId: clubId, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
  }
  await sql.query(
    `delete from competition_season_clubs where season_id=$1 and source='competition-catalog' and not (club_id=any($2::text[]))`,
    [seasonId, activeClubIds]
  );
  const snapshotId = `catalog-zero-${digest(seasonId)}`;
  await sql.query(
    `insert into standings_snapshots (standings_snapshot_id,competition_id,season_id,captured_at,source,standings)
     values ($1,$2,$3,now(),'competition-catalog-zero',$4::jsonb)
     on conflict (standings_snapshot_id) do update set captured_at=excluded.captured_at,standings=excluded.standings`,
    [snapshotId, competitionId, seasonId, JSON.stringify(standings)]
  );
  summary.push({ competition: competition.league, teams: activeClubIds.length, status: competition.membershipStatus });
}

console.log(JSON.stringify({ ok: true, season: catalog.season, competitions: summary.length, memberships: summary.reduce((n, row) => n + row.teams, 0), summary }, null, 2));
