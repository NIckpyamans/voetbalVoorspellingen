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

function normalizedSeasonLabel(value) {
  const match = String(value || "").match(/(20\d{2})\D+(?:20)?(\d{2,4})/);
  if (!match) return String(value || "");
  return `${match[1]}/${match[2].length === 2 ? `20${match[2]}` : match[2]}`;
}

const competitions = await sql.query(
  `select competition_id, name, country_id, country_name, level, provider_ids from competitions order by country_name, level, competition_id`
);
const groups = new Map();
for (const competition of competitions) {
  if (!competition.country_name || !competition.level) continue;
  const providerIds = competition.provider_ids || {};
  if (!providerIds["football-data"] && !providerIds.openfootball) continue;
  const key = `${slug(competition.country_name)}|${competition.level}`;
  const group = groups.get(key) || [];
  group.push(competition);
  groups.set(key, group);
}

let mergedCompetitions = 0;
let mergedSeasons = 0;
for (const group of groups.values()) {
  if (group.length < 2) continue;
  const sample = group.find((item) => String(item.competition_id).startsWith("competition-")) || group[0];
  const canonicalCompetitionId = `competition-${slug(sample.country_name)}-l${sample.level}`;
  const providerIds = Object.assign({}, ...group.map((item) => item.provider_ids || {}));
  await sql.query(
    `
      insert into competitions (competition_id, name, country_id, country_name, level, provider_ids)
      values ($1,$2,$3,$4,$5,$6::jsonb)
      on conflict (competition_id) do update set
        name = excluded.name, country_id = excluded.country_id, country_name = excluded.country_name,
        level = excluded.level, provider_ids = competitions.provider_ids || excluded.provider_ids, updated_at = now()
    `,
    [canonicalCompetitionId, sample.name, sample.country_id, sample.country_name, sample.level, JSON.stringify(providerIds)]
  );
  const oldCompetitionIds = group.map((item) => item.competition_id).filter((id) => id !== canonicalCompetitionId);
  const seasons = await sql.query(
    `select season_id, year_label, status from seasons where competition_id = any($1::text[]) order by year_label`,
    [[canonicalCompetitionId, ...oldCompetitionIds]]
  );
  for (const season of seasons) {
    const yearLabel = normalizedSeasonLabel(season.year_label);
    const canonicalSeasonId = `${canonicalCompetitionId}-${slug(yearLabel)}`;
    await sql.query(
      `
        insert into seasons (season_id, competition_id, year_label, status)
        values ($1,$2,$3,$4)
        on conflict (season_id) do update set competition_id = excluded.competition_id, year_label = excluded.year_label, status = excluded.status, updated_at = now()
      `,
      [canonicalSeasonId, canonicalCompetitionId, yearLabel, season.status]
    );
    await sql.query(
      `
        insert into competition_seasons (season_id, competition_id, year_label, status)
        values ($1,$2,$3,$4)
        on conflict (season_id) do update set competition_id = excluded.competition_id, year_label = excluded.year_label, status = excluded.status, updated_at = now()
      `,
      [canonicalSeasonId, canonicalCompetitionId, yearLabel, season.status]
    );
    if (season.season_id !== canonicalSeasonId) {
      await sql.query(
        `
          insert into competition_season_clubs (
            season_id, competition_id, club_id, club_name, status, entry_reason, previous_season_id,
            previous_level, previous_standing_position, previous_standing_points, previous_standing_source,
            current_level, source, source_record_id
          )
          select $1,$2,club_id,club_name,status,entry_reason,null,previous_level,previous_standing_position,
            previous_standing_points,previous_standing_source,current_level,source,source_record_id
          from competition_season_clubs where season_id = $3
          on conflict (season_id, club_id) do update set club_name = excluded.club_name, updated_at = now()
        `,
        [canonicalSeasonId, canonicalCompetitionId, season.season_id]
      );
      await sql.query("delete from competition_season_clubs where season_id = $1", [season.season_id]);
      await sql.query("update matches set competition_id = $1, season_id = $2 where season_id = $3", [canonicalCompetitionId, canonicalSeasonId, season.season_id]);
      await sql.query("update standings_snapshots set competition_id = $1, season_id = $2 where season_id = $3", [canonicalCompetitionId, canonicalSeasonId, season.season_id]);
      await sql.query("update team_season_stats set season_id = $1 where season_id = $2", [canonicalSeasonId, season.season_id]);
      await sql.query("update season_archives set season_id = $1 where season_id = $2", [canonicalSeasonId, season.season_id]);
      await sql.query("update competition_season_clubs set previous_season_id = $1 where previous_season_id = $2", [canonicalSeasonId, season.season_id]);
      await sql.query("delete from competition_seasons where season_id = $1", [season.season_id]);
      await sql.query("delete from seasons where season_id = $1", [season.season_id]);
      mergedSeasons += 1;
    }
  }
  await sql.query("update matches set competition_id = $1 where competition_id = any($2::text[])", [canonicalCompetitionId, oldCompetitionIds]);
  await sql.query("update standings_snapshots set competition_id = $1 where competition_id = any($2::text[])", [canonicalCompetitionId, oldCompetitionIds]);
  await sql.query("update competition_season_clubs set competition_id = $1 where competition_id = any($2::text[])", [canonicalCompetitionId, oldCompetitionIds]);
  await sql.query("update competition_seasons set competition_id = $1 where competition_id = any($2::text[])", [canonicalCompetitionId, oldCompetitionIds]);
  await sql.query("update seasons set competition_id = $1 where competition_id = any($2::text[])", [canonicalCompetitionId, oldCompetitionIds]);
  await sql.query("update calibration_profiles set competition_id = $1 where competition_id = any($2::text[])", [canonicalCompetitionId, oldCompetitionIds]);
  await sql.query("delete from h2h_edges where competition_id = any($1::text[])", [oldCompetitionIds]);
  await sql.query("delete from competitions where competition_id = any($1::text[])", [oldCompetitionIds]);
  mergedCompetitions += oldCompetitionIds.length;
}

console.log(JSON.stringify({ mergedCompetitions, mergedSeasons }, null, 2));
