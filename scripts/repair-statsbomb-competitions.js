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

const identities = await sql.query(`
  select distinct
    raw_payload->'competition'->>'competition_id' as provider_competition_id,
    raw_payload->'competition'->>'competition_name' as competition_name,
    raw_payload->'competition'->>'country_name' as country_name,
    raw_payload->'season'->>'season_id' as provider_season_id,
    raw_payload->'season'->>'season_name' as season_name
  from matches
  where data_source = 'StatsBomb Open Data'
    and raw_payload->'competition'->>'competition_id' is not null
    and raw_payload->'season'->>'season_id' is not null
`);

for (const identity of identities) {
  const countryId = slug(identity.country_name || "international");
  const competitionId = `competition-statsbomb-${slug(identity.provider_competition_id)}`;
  const seasonId = `${competitionId}-season-${slug(identity.provider_season_id)}`;
  await sql.query(
    `insert into countries (country_id, name) values ($1,$2) on conflict (country_id) do update set name = excluded.name, updated_at = now()`,
    [countryId, identity.country_name || "International"]
  );
  await sql.query(
    `
      insert into competitions (competition_id, name, country_id, country_name, level, provider_ids)
      values ($1,$2,$3,$4,1,$5::jsonb)
      on conflict (competition_id) do update set
        name = excluded.name, country_id = excluded.country_id, country_name = excluded.country_name,
        provider_ids = competitions.provider_ids || excluded.provider_ids, updated_at = now()
    `,
    [competitionId, identity.competition_name, countryId, identity.country_name, JSON.stringify({ statsbomb: identity.provider_competition_id })]
  );
  for (const table of ["seasons", "competition_seasons"]) {
    await sql.query(
      `
        insert into ${table} (season_id, competition_id, year_label, status)
        values ($1,$2,$3,'archived')
        on conflict (season_id) do update set competition_id = excluded.competition_id, year_label = excluded.year_label, updated_at = now()
      `,
      [seasonId, competitionId, identity.season_name]
    );
  }
  await sql.query(
    `
      update matches set competition_id = $1, season_id = $2, updated_at = now()
      where data_source = 'StatsBomb Open Data'
        and raw_payload->'competition'->>'competition_id' = $3
        and raw_payload->'season'->>'season_id' = $4
    `,
    [competitionId, seasonId, identity.provider_competition_id, identity.provider_season_id]
  );
}

await sql.query(`
  update team_season_stats tss
  set season_id = m.season_id, updated_at = now()
  from matches m
  where m.match_id = 'statsbomb-' || (tss.style_profile->>'sampleMatchId')
    and m.data_source = 'StatsBomb Open Data'
`);
await sql.query(`
  update competitions
  set name = case
      when provider_ids->>'football-data' = 'E0' then 'England - Premier League'
      when provider_ids->>'openfootball' = 'en.1' then 'England - Premier League'
      else name
    end,
    provider_ids = provider_ids - 'statsbomb',
    updated_at = now()
  where provider_ids ? 'statsbomb' and (provider_ids ? 'football-data' or provider_ids ? 'openfootball')
`);

console.log(JSON.stringify({ repairedCompetitionSeasons: identities.length }, null, 2));
