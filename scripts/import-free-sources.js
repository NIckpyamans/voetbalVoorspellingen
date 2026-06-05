#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";

const ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));
function argValue(name, fallback = null) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}
const LIMIT = Math.max(1, Number(process.env.FREE_SOURCE_IMPORT_LIMIT || 120));
const FOOTBALL_DATA_FULL_SEASONS =
  ARGS.has("--full") ||
  ["1", "true", "yes"].includes(String(process.env.FOOTBALL_DATA_FULL_SEASONS || "").toLowerCase());
const FOOTBALL_DATA_LIMIT = FOOTBALL_DATA_FULL_SEASONS ? Number.POSITIVE_INFINITY : LIMIT;
const WEATHER_LIMIT = Math.max(1, Number(process.env.FREE_SOURCE_WEATHER_LIMIT || 120));
const STATSBOMB_EVENT_LIMIT = Math.max(1, Number(process.env.STATSBOMB_EVENT_LIMIT || 18));
const VENUE_GEOCODE_LIMIT = Math.max(0, Number(process.env.VENUE_GEOCODE_LIMIT || 25));
const SOURCE_FILTER = String(argValue("--source", process.env.FREE_SOURCE_IMPORT_SOURCE || "all")).toLowerCase();
const LEAGUE_FILTER = String(argValue("--league", process.env.FREE_SOURCE_LEAGUE_CODE || "")).toUpperCase();
const SEASON_FOLDER_FILTER = String(argValue("--season-folder", process.env.FREE_SOURCE_SEASON_FOLDER || ""));
const MANIFEST_PATH = path.join(ROOT, "monitor", "free-source-import.json");

const FOOTBALL_DATA_LEAGUES = [
  { country: "England", league: "England - Premier League", code: "E0", level: 1 },
  { country: "England", league: "England - Championship", code: "E1", level: 2 },
  { country: "Netherlands", league: "Netherlands - Eredivisie", code: "N1", level: 1 },
  { country: "Netherlands", league: "Netherlands - Eerste Divisie", code: "N2", level: 2 },
  { country: "Germany", league: "Germany - Bundesliga", code: "D1", level: 1 },
  { country: "Spain", league: "Spain - LaLiga", code: "SP1", level: 1 },
  { country: "Italy", league: "Italy - Serie A", code: "I1", level: 1 },
  { country: "France", league: "France - Ligue 1", code: "F1", level: 1 },
];

const OPENFOOTBALL_COMPETITIONS = [
  { country: "England", league: "England - Premier League", code: "eng.1", level: 1 },
  { country: "England", league: "England - Championship", code: "eng.2", level: 2 },
  { country: "Netherlands", league: "Netherlands - Eredivisie", code: "nl.1", level: 1 },
  { country: "Germany", league: "Germany - Bundesliga", code: "de.1", level: 1 },
  { country: "Spain", league: "Spain - LaLiga", code: "es.1", level: 1 },
  { country: "Italy", league: "Italy - Serie A", code: "it.1", level: 1 },
];

const OPENFOOTBALL_SEASON_TAGS = ["2025-26", "2025-2026", "2024-25", "2024-2025", "2023-24", "2023-2024", "2022-23", "2022-2023", "2021-22", "2021-2022"];

const KNOWN_VENUES = {
  "arsenal": { name: "Emirates Stadium", city: "London", lat: 51.555, lon: -0.1086 },
  "aston villa": { name: "Villa Park", city: "Birmingham", lat: 52.5092, lon: -1.8848 },
  "athletic club": { name: "San Mames", city: "Bilbao", lat: 43.2642, lon: -2.9494 },
  "athletic bilbao": { name: "San Mames", city: "Bilbao", lat: 43.2642, lon: -2.9494 },
  "az": { name: "AFAS Stadion", city: "Alkmaar", lat: 52.6125, lon: 4.7425 },
  "barcelona": { name: "Camp Nou", city: "Barcelona", lat: 41.3809, lon: 2.1228 },
  "bayern munich": { name: "Allianz Arena", city: "Munich", lat: 48.2188, lon: 11.6247 },
  "borussia dortmund": { name: "Signal Iduna Park", city: "Dortmund", lat: 51.4926, lon: 7.4519 },
  "chelsea": { name: "Stamford Bridge", city: "London", lat: 51.4816, lon: -0.191 },
  "crystal palace": { name: "Selhurst Park", city: "London", lat: 51.3983, lon: -0.0855 },
  "ajax": { name: "Johan Cruijff ArenA", city: "Amsterdam", lat: 52.3142, lon: 4.9418 },
  "feyenoord rotterdam": { name: "De Kuip", city: "Rotterdam", lat: 51.8939, lon: 4.5231 },
  "rotterdam": { name: "De Kuip", city: "Rotterdam", lat: 51.8939, lon: 4.5231 },
  "freiburg": { name: "Europa-Park Stadion", city: "Freiburg", lat: 48.0217, lon: 7.8303 },
  "groningen": { name: "Euroborg", city: "Groningen", lat: 53.2061, lon: 6.5919 },
  "heerenveen": { name: "Abe Lenstra Stadion", city: "Heerenveen", lat: 52.9594, lon: 5.9361 },
  "inter": { name: "San Siro", city: "Milan", lat: 45.4781, lon: 9.124 },
  "juventus": { name: "Allianz Stadium", city: "Turin", lat: 45.1096, lon: 7.6413 },
  "liverpool": { name: "Anfield", city: "Liverpool", lat: 53.4308, lon: -2.9608 },
  "manchester city": { name: "Etihad Stadium", city: "Manchester", lat: 53.4831, lon: -2.2004 },
  "manchester united": { name: "Old Trafford", city: "Manchester", lat: 53.4631, lon: -2.2913 },
  "milan": { name: "San Siro", city: "Milan", lat: 45.4781, lon: 9.124 },
  "paris saint-germain": { name: "Parc des Princes", city: "Paris", lat: 48.8414, lon: 2.253 },
  "pec zwolle": { name: "MAC3PARK Stadion", city: "Zwolle", lat: 52.5178, lon: 6.1206 },
  "psv": { name: "Philips Stadion", city: "Eindhoven", lat: 51.4418, lon: 5.4674 },
  "psg": { name: "Parc des Princes", city: "Paris", lat: 48.8414, lon: 2.253 },
  "sparta rotterdam": { name: "Het Kasteel", city: "Rotterdam", lat: 51.9202, lon: 4.4326 },
  "telstar 1963": { name: "BUKO Stadion", city: "Velsen-Zuid", lat: 52.4594, lon: 4.6414 },
  "twente": { name: "De Grolsch Veste", city: "Enschede", lat: 52.2369, lon: 6.8375 },
  "utrecht": { name: "Stadion Galgenwaard", city: "Utrecht", lat: 52.0783, lon: 5.1456 },
  "real madrid": { name: "Santiago Bernabeu", city: "Madrid", lat: 40.4531, lon: -3.6883 },
  "tottenham": { name: "Tottenham Hotspur Stadium", city: "London", lat: 51.6043, lon: -0.0664 },
  "vitesse": { name: "GelreDome", city: "Arnhem", lat: 51.9633, lon: 5.8939 },
};

function digest(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 20);
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .slice(0, 80);
}

function canonicalTeamName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(fc|cf|afc|sc|club)\b/g, " ")
    .replace(/[^a-z0-9-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function currentSeasonFolders() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const start = month >= 7 ? year : year - 1;
  const folder = `${String(start).slice(2)}${String(start + 1).slice(2)}`;
  const previous = `${String(start - 1).slice(2)}${String(start).slice(2)}`;
  return SEASON_FOLDER_FILTER ? [SEASON_FOLDER_FILTER] : [folder, previous];
}

function seasonLabelFromFolder(folder) {
  return `20${folder.slice(0, 2)}/20${folder.slice(2, 4)}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [headers = [], ...data] = rows;
  return data.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function parseFootballDataDate(value) {
  const clean = String(value || "").trim();
  const parts = clean.split(/[/-]/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [day, month, rawYear] = parts;
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "FootyPredict-FreeSourceImporter/1.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchNominatimJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "FootyPredict-FreeSourceImporter/1.0 contact=local",
      "Accept": "application/json",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function weatherCodeLabel(code) {
  const value = Number(code);
  if ([0, 1].includes(value)) return "helder";
  if ([2, 3].includes(value)) return "bewolkt";
  if ([45, 48].includes(value)) return "mist";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(value)) return "regen";
  if ([71, 73, 75, 77, 85, 86].includes(value)) return "sneeuw";
  if ([95, 96, 99].includes(value)) return "onweer";
  return "onbekend";
}

async function fetchOpenMeteoWeather(lat, lon, dateKey) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${dateKey}&end_date=${dateKey}&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m&timezone=UTC`;
  const data = await fetchJson(url);
  const hours = data?.hourly?.time || [];
  const index = Math.min(Math.max(hours.findIndex((time) => String(time).includes("15:00")), 0), Math.max(hours.length - 1, 0));
  return {
    source: "Open-Meteo",
    latitude: lat,
    longitude: lon,
    temperature: numeric(data?.hourly?.temperature_2m?.[index]),
    precipitation: numeric(data?.hourly?.precipitation?.[index]),
    windSpeed: numeric(data?.hourly?.wind_speed_10m?.[index]),
    weatherCode: numeric(data?.hourly?.weather_code?.[index]),
    conditions: weatherCodeLabel(data?.hourly?.weather_code?.[index]),
    date: dateKey,
    capturedAt: new Date().toISOString(),
  };
}

async function upsertSourceRecord(sql, id, provider, sourceUrl, entityType, entityKey, payload, trustScore = 0.75) {
  await sql.query(
    `
      insert into source_records (
        source_record_id, provider, source_url, entity_type, entity_key, content_hash, trust_score, payload
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      on conflict (source_record_id) do update set
        fetched_at = now(),
        content_hash = excluded.content_hash,
        payload = excluded.payload,
        trust_score = excluded.trust_score
    `,
    [id, provider, sourceUrl, entityType, entityKey, digest(JSON.stringify(payload)), trustScore, JSON.stringify(payload)]
  );
}

async function upsertCompetition(sql, source, item, seasonLabel) {
  const countryId = slug(item.country);
  const competitionId = `${source}-${slug(item.code)}`;
  const seasonId = `${competitionId}-${slug(seasonLabel)}`;
  await sql.query(
    `insert into countries (country_id, name) values ($1, $2) on conflict (country_id) do update set name = excluded.name, updated_at = now()`,
    [countryId, item.country]
  );
  await sql.query(
    `
      insert into competitions (competition_id, name, country_id, country_name, level, provider_ids)
      values ($1, $2, $3, $4, $5, $6::jsonb)
      on conflict (competition_id) do update set
        name = excluded.name,
        country_id = excluded.country_id,
        country_name = excluded.country_name,
        level = excluded.level,
        provider_ids = excluded.provider_ids,
        updated_at = now()
    `,
    [competitionId, item.league, countryId, item.country, item.level || null, JSON.stringify({ [source]: item.code })]
  );
  await sql.query(
    `
      insert into competition_seasons (season_id, competition_id, year_label, status)
      values ($1, $2, $3, $4)
      on conflict (season_id) do update set competition_id = excluded.competition_id, year_label = excluded.year_label, status = excluded.status, updated_at = now()
    `,
    [seasonId, competitionId, seasonLabel, seasonLabel.includes("2025") || seasonLabel.includes("2026") ? "active" : "archived"]
  );
  await sql.query(
    `
      insert into seasons (season_id, competition_id, year_label, status)
      values ($1, $2, $3, $4)
      on conflict (season_id) do update set competition_id = excluded.competition_id, year_label = excluded.year_label, status = excluded.status, updated_at = now()
    `,
    [seasonId, competitionId, seasonLabel, seasonLabel.includes("2025") || seasonLabel.includes("2026") ? "active" : "archived"]
  );
  return { countryId, competitionId, seasonId };
}

async function upsertClub(sql, countryId, countryName, name, provider, providerId = null) {
  const clubId = `${provider}-club-${slug(name)}`;
  const knownVenue = KNOWN_VENUES[canonicalTeamName(name)] || null;
  const venueId = knownVenue ? `venue-${slug(knownVenue.name)}-${slug(knownVenue.city)}` : null;
  if (knownVenue) {
    await sql.query(
      `
        insert into venues (venue_id, name, city, country_id, latitude, longitude, provider_ids)
        values ($1, $2, $3, $4, $5, $6, $7::jsonb)
        on conflict (venue_id) do update set
          name = excluded.name,
          city = excluded.city,
          country_id = excluded.country_id,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          provider_ids = excluded.provider_ids,
          updated_at = now()
      `,
      [venueId, knownVenue.name, knownVenue.city, countryId, knownVenue.lat, knownVenue.lon, JSON.stringify({ curated: true, team: name })]
    );
  }
  await sql.query(
    `
      insert into clubs (club_id, name, country_id, country_name, stadium, venue_id, provider_ids)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      on conflict (club_id) do update set
        name = excluded.name,
        country_id = excluded.country_id,
        country_name = excluded.country_name,
        stadium = coalesce(excluded.stadium, clubs.stadium),
        venue_id = coalesce(excluded.venue_id, clubs.venue_id),
        provider_ids = excluded.provider_ids,
        updated_at = now()
    `,
    [clubId, name, countryId, countryName, knownVenue?.name || null, venueId, JSON.stringify({ [provider]: providerId || name })]
  );
  await sql.query(
    `insert into club_aliases (club_id, alias, normalized_alias, source) values ($1, $2, $3, $4) on conflict (club_id, normalized_alias) do nothing`,
    [clubId, name, slug(name), provider]
  );
  return { clubId, venueId };
}

async function footballDataAlreadyImported(sql, matchId) {
  if (!FOOTBALL_DATA_FULL_SEASONS) return false;
  const [row] = await sql.query(
    `
      select
        exists(select 1 from match_stats where match_id = $1) as has_stats,
        (select count(*)::int from historical_odds_snapshots where match_id = $1) as odds_count
    `,
    [matchId]
  );
  return Boolean(row?.has_stats && Number(row?.odds_count || 0) >= 1);
}

async function importFootballData(sql) {
  let matches = 0;
  let odds = 0;
  let stats = 0;
  const errors = [];
  for (const folder of currentSeasonFolders()) {
    const seasonLabel = seasonLabelFromFolder(folder);
    for (const item of FOOTBALL_DATA_LEAGUES.filter((league) => !LEAGUE_FILTER || league.code.toUpperCase() === LEAGUE_FILTER)) {
      if (matches >= FOOTBALL_DATA_LIMIT) break;
      const url = `https://www.football-data.co.uk/mmz4281/${folder}/${item.code}.csv`;
      try {
        const rows = parseCsv(await fetchText(url)).filter((row) => row.Date && row.HomeTeam && row.AwayTeam);
        const { countryId, competitionId, seasonId } = await upsertCompetition(sql, "football-data", item, seasonLabel);
        await upsertSourceRecord(sql, `src_fd_${folder}_${item.code}`, "Football-Data.co.uk", url, "competition_season_csv", `${item.code}:${folder}`, { rows: rows.length, seasonLabel });
        for (const row of rows.slice(0, Math.max(0, FOOTBALL_DATA_LIMIT - matches))) {
          const dateKey = parseFootballDataDate(row.Date);
          if (!dateKey) continue;
          const homeClub = await upsertClub(sql, countryId, item.country, row.HomeTeam, "football-data");
          const awayClub = await upsertClub(sql, countryId, item.country, row.AwayTeam, "football-data");
          const homeClubId = homeClub.clubId;
          const awayClubId = awayClub.clubId;
          const matchId = `fd-${item.code}-${dateKey}-${digest(`${row.HomeTeam}|${row.AwayTeam}`)}`;
          const sourceRecordId = `src_fd_match_${digest(`${matchId}|${row.Date}`)}`;
          if (await footballDataAlreadyImported(sql, matchId)) continue;
          const finalHome = numeric(row.FTHG);
          const finalAway = numeric(row.FTAG);
          await upsertSourceRecord(sql, sourceRecordId, "Football-Data.co.uk", url, "match_row", matchId, row, 0.82);
          await sql.query(
            `
              insert into matches (
                match_id, source_match_id, data_source, competition_id, season_id, league, season, kickoff_at,
                home_club_id, away_club_id, venue_id, home_team_id, away_team_id, home_team_name, away_team_name,
                status, status_normalized, date_key, raw_payload, source_coverage
              )
              values ($1, $2, 'football-data.co.uk', $3, $4, $5, $6, $7, $8, $9, $10, $8, $9, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb)
              on conflict (match_id) do update set
                competition_id = excluded.competition_id,
                season_id = excluded.season_id,
                league = excluded.league,
                season = excluded.season,
                kickoff_at = excluded.kickoff_at,
                home_club_id = excluded.home_club_id,
                away_club_id = excluded.away_club_id,
                venue_id = excluded.venue_id,
                status = excluded.status,
                status_normalized = excluded.status_normalized,
                date_key = excluded.date_key,
                raw_payload = excluded.raw_payload,
                source_coverage = excluded.source_coverage,
                updated_at = now()
            `,
            [
              matchId,
              `${folder}:${item.code}:${row.Date}:${row.HomeTeam}:${row.AwayTeam}`,
              competitionId,
              seasonId,
              item.league,
              seasonLabel,
              `${dateKey}T12:00:00.000Z`,
              homeClubId,
              awayClubId,
              homeClub.venueId,
              row.HomeTeam,
              row.AwayTeam,
              finalHome !== null && finalAway !== null ? "FT" : "NS",
              finalHome !== null && finalAway !== null ? "finished" : "scheduled",
              dateKey,
              JSON.stringify(row),
              JSON.stringify({
                percent: finalHome !== null && finalAway !== null ? 75 : 50,
                sources: ["Football-Data.co.uk"],
                entries: [
                  { key: "fixture", label: "Fixture", available: true, source: "Football-Data.co.uk" },
                  { key: "result", label: "Eindstand", available: finalHome !== null && finalAway !== null, source: "Football-Data.co.uk" },
                  { key: "stats", label: "Matchstats", available: Boolean(row.HS || row.AS), source: "Football-Data.co.uk" },
                  { key: "odds", label: "Odds", available: Boolean(row.B365H || row.PSH || row.AvgH), source: "Football-Data.co.uk" },
                ],
              }),
            ]
          );
          if (finalHome !== null && finalAway !== null) {
            await sql.query(
              `
                insert into match_results (match_id, final_home_goals, final_away_goals, actual_outcome, result_source, settled_at)
                values ($1, $2::integer, $3::integer, case when $2::integer > $3::integer then 'H' when $3::integer > $2::integer then 'A' else 'D' end, 'Football-Data.co.uk', now())
                on conflict (match_id) do update set final_home_goals = excluded.final_home_goals, final_away_goals = excluded.final_away_goals, actual_outcome = excluded.actual_outcome, result_source = excluded.result_source
              `,
              [matchId, finalHome, finalAway]
            );
          }
          if (row.HS || row.AS || row.HST || row.AST) {
            await sql.query(
              `
                insert into match_stats (
                  match_id, halftime_home_goals, halftime_away_goals, home_shots, away_shots,
                  home_shots_on_target, away_shots_on_target, home_corners, away_corners,
                  home_yellow_cards, away_yellow_cards, home_red_cards, away_red_cards, stats_source, source_record_id
                )
                values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Football-Data.co.uk',$14)
                on conflict (match_id) do update set
                  halftime_home_goals = excluded.halftime_home_goals,
                  halftime_away_goals = excluded.halftime_away_goals,
                  home_shots = excluded.home_shots,
                  away_shots = excluded.away_shots,
                  home_shots_on_target = excluded.home_shots_on_target,
                  away_shots_on_target = excluded.away_shots_on_target,
                  home_corners = excluded.home_corners,
                  away_corners = excluded.away_corners,
                  home_yellow_cards = excluded.home_yellow_cards,
                  away_yellow_cards = excluded.away_yellow_cards,
                  home_red_cards = excluded.home_red_cards,
                  away_red_cards = excluded.away_red_cards,
                  source_record_id = excluded.source_record_id,
                  updated_at = now()
              `,
              [matchId, numeric(row.HTHG), numeric(row.HTAG), numeric(row.HS), numeric(row.AS), numeric(row.HST), numeric(row.AST), numeric(row.HC), numeric(row.AC), numeric(row.HY), numeric(row.AY), numeric(row.HR), numeric(row.AR), sourceRecordId]
            );
            for (const side of ["home", "away"]) {
              const isHome = side === "home";
              await sql.query(
                `
                  insert into team_match_stats (
                    team_match_stats_id, match_id, club_id, side, goals, halftime_goals, shots,
                    shots_on_target, corners, yellow_cards, red_cards, stats_source, source_record_id,
                    style_profile
                  )
                  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Football-Data.co.uk',$12,$13::jsonb)
                  on conflict (match_id, side) do update set
                    club_id = excluded.club_id,
                    goals = excluded.goals,
                    halftime_goals = excluded.halftime_goals,
                    shots = excluded.shots,
                    shots_on_target = excluded.shots_on_target,
                    corners = excluded.corners,
                    yellow_cards = excluded.yellow_cards,
                    red_cards = excluded.red_cards,
                    source_record_id = excluded.source_record_id,
                    style_profile = excluded.style_profile,
                    updated_at = now()
                `,
                [
                  `tms_${digest(`${matchId}|${side}`)}`,
                  matchId,
                  isHome ? homeClubId : awayClubId,
                  side,
                  isHome ? finalHome : finalAway,
                  numeric(isHome ? row.HTHG : row.HTAG),
                  numeric(isHome ? row.HS : row.AS),
                  numeric(isHome ? row.HST : row.AST),
                  numeric(isHome ? row.HC : row.AC),
                  numeric(isHome ? row.HY : row.AY),
                  numeric(isHome ? row.HR : row.AR),
                  sourceRecordId,
                  JSON.stringify({
                    provider: "Football-Data.co.uk",
                    shotVolume: numeric(isHome ? row.HS : row.AS),
                    shotQualityProxy: numeric(isHome ? row.HST : row.AST),
                    setPieceProxy: numeric(isHome ? row.HC : row.AC),
                    disciplineRisk: numeric(isHome ? row.HY : row.AY),
                  }),
                ]
              );
            }
            stats += 1;
          }
          const bookmakerRows = [
            ["Bet365", row.B365H, row.B365D, row.B365A],
            ["Pinnacle", row.PSH, row.PSD, row.PSA],
            ["MarketAvg", row.AvgH, row.AvgD, row.AvgA],
            ["MarketMax", row.MaxH, row.MaxD, row.MaxA],
          ];
          for (const [bookmaker, home, draw, away] of bookmakerRows) {
            if (!home || !draw || !away) continue;
            await sql.query(
              `
                insert into historical_odds_snapshots (
                  historical_odds_snapshot_id, match_id, provider, bookmaker, market, home, draw, away,
                  closing_home, closing_draw, closing_away, captured_at, source_record_id
                )
                values ($1,$2,'Football-Data.co.uk',$3,'1X2',$4,$5,$6,$4,$5,$6,$7,$8)
                on conflict (historical_odds_snapshot_id) do update set
                  home = excluded.home, draw = excluded.draw, away = excluded.away,
                  closing_home = excluded.closing_home, closing_draw = excluded.closing_draw, closing_away = excluded.closing_away,
                  source_record_id = excluded.source_record_id
              `,
              [`hist_odds_${digest(`${matchId}|${bookmaker}`)}`, matchId, bookmaker, numeric(home), numeric(draw), numeric(away), `${dateKey}T12:00:00.000Z`, sourceRecordId]
            );
            odds += 1;
          }
          matches += 1;
        }
      } catch (error) {
        errors.push({ source: "football-data", url, error: error.message });
      }
    }
  }
  return { matches, odds, stats, errors };
}

async function importOpenFootball(sql) {
  let matches = 0;
  let clubs = 0;
  const errors = [];
  const unavailable = [];
  for (const seasonTag of OPENFOOTBALL_SEASON_TAGS) {
    for (const item of OPENFOOTBALL_COMPETITIONS.filter((league) => !LEAGUE_FILTER || league.code.toUpperCase() === LEAGUE_FILTER)) {
      if (matches >= LIMIT) break;
      const url = `https://raw.githubusercontent.com/openfootball/football.json/master/${seasonTag}/${item.code}.json`;
      try {
        const data = JSON.parse(await fetchText(url));
        const seasonLabel = data.name || seasonTag;
        const { countryId, competitionId, seasonId } = await upsertCompetition(sql, "openfootball", item, seasonLabel);
        await upsertSourceRecord(sql, `src_openfootball_${seasonTag}_${item.code}`, "OpenFootball", url, "competition_season_json", `${item.code}:${seasonTag}`, data, 0.8);
        const games = Array.isArray(data.matches)
          ? data.matches.map((match) => ({ ...match, roundName: match.round || null }))
          : (data.rounds || []).flatMap((round) => (round.matches || []).map((match) => ({ ...match, roundName: round.name || null })));
        for (const game of games) {
            if (matches >= LIMIT) break;
            if (!game.team1 || !game.team2 || !game.date) continue;
            const homeClub = await upsertClub(sql, countryId, item.country, game.team1, "openfootball");
            const awayClub = await upsertClub(sql, countryId, item.country, game.team2, "openfootball");
            const homeClubId = homeClub.clubId;
            const awayClubId = awayClub.clubId;
            clubs += 2;
            const matchId = `of-${item.code}-${game.date}-${digest(`${game.team1}|${game.team2}`)}`;
            const score = Array.isArray(game.score?.ft) ? game.score.ft : game.score;
            const finalHome = Array.isArray(score) ? numeric(score[0]) : null;
            const finalAway = Array.isArray(score) ? numeric(score[1]) : null;
            await sql.query(
              `
                insert into matches (
                  match_id, source_match_id, data_source, competition_id, season_id, league, season,
                  kickoff_at, home_club_id, away_club_id, venue_id, home_team_id, away_team_id, home_team_name, away_team_name,
                  status, status_normalized, date_key, raw_payload, source_coverage
                )
                values ($1,$2,'OpenFootball',$3,$4,$5,$6,$7,$8,$9,$10,$8,$9,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb)
                on conflict (match_id) do update set
                  competition_id = excluded.competition_id,
                  season_id = excluded.season_id,
                  league = excluded.league,
                  season = excluded.season,
                  kickoff_at = excluded.kickoff_at,
                  home_club_id = excluded.home_club_id,
                  away_club_id = excluded.away_club_id,
                  venue_id = excluded.venue_id,
                  status = excluded.status,
                  status_normalized = excluded.status_normalized,
                  raw_payload = excluded.raw_payload,
                  source_coverage = excluded.source_coverage,
                  updated_at = now()
              `,
              [
                matchId,
                `${seasonTag}:${item.code}:${game.date}:${game.team1}:${game.team2}`,
                competitionId,
                seasonId,
                item.league,
                seasonLabel,
                `${game.date}T12:00:00.000Z`,
                homeClubId,
                awayClubId,
                homeClub.venueId,
                game.team1,
                game.team2,
                finalHome !== null && finalAway !== null ? "FT" : "NS",
                finalHome !== null && finalAway !== null ? "finished" : "scheduled",
                game.date,
                JSON.stringify({ ...game, round: game.roundName }),
                JSON.stringify({
                  percent: finalHome !== null && finalAway !== null ? 50 : 35,
                  sources: ["OpenFootball"],
                  entries: [
                    { key: "fixture", label: "Fixture", available: true, source: "OpenFootball" },
                    { key: "result", label: "Eindstand", available: finalHome !== null && finalAway !== null, source: "OpenFootball" },
                  ],
                }),
              ]
            );
            if (finalHome !== null && finalAway !== null) {
              await sql.query(
                `
                  insert into match_results (match_id, final_home_goals, final_away_goals, actual_outcome, result_source, settled_at)
                  values ($1, $2::integer, $3::integer, case when $2::integer > $3::integer then 'H' when $3::integer > $2::integer then 'A' else 'D' end, 'OpenFootball', now())
                  on conflict (match_id) do update set final_home_goals = excluded.final_home_goals, final_away_goals = excluded.final_away_goals, actual_outcome = excluded.actual_outcome, result_source = excluded.result_source
                `,
                [matchId, finalHome, finalAway]
              );
            }
            matches += 1;
        }
      } catch (error) {
        if (String(error.message || "").includes("404")) unavailable.push({ url, reason: "not_published" });
        else errors.push({ source: "openfootball", url, error: error.message });
      }
    }
  }
  return { matches, clubs, unavailable: unavailable.slice(0, 12), unavailableCount: unavailable.length, errors };
}

async function importStatsBombCatalog(sql) {
  const url = "https://raw.githubusercontent.com/statsbomb/open-data/master/data/competitions.json";
  const errors = [];
  try {
    const competitions = JSON.parse(await fetchText(url));
    await upsertSourceRecord(sql, "src_statsbomb_open_competitions", "StatsBomb Open Data", url, "xg_style_catalog", "competitions", { competitions: competitions.slice(0, LIMIT), total: competitions.length }, 0.86);
    for (const item of competitions.slice(0, Math.min(LIMIT, 60))) {
      const sourceId = `src_statsbomb_comp_${digest(`${item.competition_id}|${item.season_id}`)}`;
      await upsertSourceRecord(sql, sourceId, "StatsBomb Open Data", url, "competition_season_xg_style", `${item.competition_id}:${item.season_id}`, item, 0.86);
    }
    return { records: Math.min(LIMIT, competitions.length), errors };
  } catch (error) {
    errors.push({ source: "statsbomb", url, error: error.message });
    return { records: 0, errors };
  }
}

async function importStatsBombEvents(sql) {
  const baseUrl = "https://raw.githubusercontent.com/statsbomb/open-data/master/data";
  const errors = [];
  let events = 0;
  let matches = 0;
  let teams = 0;
  try {
    const competitions = await fetchJson(`${baseUrl}/competitions.json`);
    const candidates = competitions
      .filter((item) => item.competition_id != null && item.season_id != null)
      .sort((a, b) => String(b.season_name || "").localeCompare(String(a.season_name || "")))
      .slice(0, 8);
    for (const competition of candidates) {
      if (matches >= STATSBOMB_EVENT_LIMIT) break;
      const matchesUrl = `${baseUrl}/matches/${competition.competition_id}/${competition.season_id}.json`;
      let matchRows = [];
      try {
        matchRows = await fetchJson(matchesUrl);
      } catch (error) {
        errors.push({ source: "statsbomb-matches", url: matchesUrl, error: error.message });
        continue;
      }
      const countryId = slug(competition.country_name || "international");
      const seasonLabel = `${competition.competition_name || "StatsBomb"} ${competition.season_name || competition.season_id}`;
      const comp = await upsertCompetition(sql, "statsbomb", {
        country: competition.country_name || "International",
        league: competition.competition_name || `StatsBomb ${competition.competition_id}`,
        code: String(competition.competition_id),
        level: 1,
      }, seasonLabel);
      for (const match of matchRows.slice(0, Math.max(0, STATSBOMB_EVENT_LIMIT - matches))) {
        const eventsUrl = `${baseUrl}/events/${match.match_id}.json`;
        try {
          const eventRows = await fetchJson(eventsUrl);
          const aggregate = new Map();
          for (const event of eventRows) {
            const teamName = event?.team?.name;
            if (!teamName) continue;
            const current = aggregate.get(teamName) || { shots: 0, xg: 0, passes: 0, pressures: 0, carries: 0 };
            if (event.type?.name === "Shot") {
              current.shots += 1;
              current.xg += Number(event.shot?.statsbomb_xg || 0);
            }
            if (event.type?.name === "Pass") current.passes += 1;
            if (event.type?.name === "Pressure") current.pressures += 1;
            if (event.type?.name === "Carry") current.carries += 1;
            aggregate.set(teamName, current);
          }
          const sourceRecordId = `src_statsbomb_events_${match.match_id}`;
          await upsertSourceRecord(sql, sourceRecordId, "StatsBomb Open Data", eventsUrl, "match_events_xg_style", String(match.match_id), {
            matchId: match.match_id,
            competition,
            match,
            teamAggregates: Object.fromEntries(aggregate),
            eventRows: eventRows.length,
          }, 0.88);
          for (const [teamName, stats] of aggregate.entries()) {
            const club = await upsertClub(sql, countryId, competition.country_name || "International", teamName, "statsbomb", teamName);
            await sql.query(
              `
                insert into team_season_stats (
                  team_season_stats_id, season_id, club_id, matches_played, xg_for, source_record_id, style_profile
                )
                values ($1,$2,$3,1,$4,$5,$6::jsonb)
                on conflict (team_season_stats_id) do update set
                  xg_for = excluded.xg_for,
                  source_record_id = excluded.source_record_id,
                  style_profile = excluded.style_profile,
                  updated_at = now()
              `,
              [
                `tss_statsbomb_${digest(`${comp.seasonId}|${teamName}`)}`,
                comp.seasonId,
                club.clubId,
                Number(stats.xg.toFixed(4)),
                sourceRecordId,
                JSON.stringify({
                  provider: "StatsBomb Open Data",
                  sampleMatchId: match.match_id,
                  shots: stats.shots,
                  xg: Number(stats.xg.toFixed(4)),
                  passes: stats.passes,
                  pressures: stats.pressures,
                  carries: stats.carries,
                  styleTags: [
                    stats.passes >= 450 ? "possession-heavy" : "direct-or-transition",
                    stats.pressures >= 140 ? "high-pressure" : "moderate-pressure",
                    stats.shots >= 14 ? "shot-volume" : "selective-shooting",
                  ],
                }),
              ]
            );
            teams += 1;
          }
          events += eventRows.length;
          matches += 1;
        } catch (error) {
          errors.push({ source: "statsbomb-events", url: eventsUrl, error: error.message });
        }
      }
    }
  } catch (error) {
    errors.push({ source: "statsbomb-events", error: error.message });
  }
  return { matches, teams, events, errors };
}

async function importStoredWeather(sql) {
  const dataPath = path.join(ROOT, "server_data.json");
  const errors = [];
  const store = fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, "utf8")) : { matches: {} };
  let matches = 0;
  for (const dayMatches of Object.values(store.matches || {})) {
    for (const match of dayMatches || []) {
      if (matches >= WEATHER_LIMIT) break;
      if (!match?.id || !match?.weather) continue;
      const payload = { ...match.weather, source: match.weather.source || "Open-Meteo", matchId: match.id };
      await upsertSourceRecord(sql, `src_weather_${digest(match.id)}`, "Open-Meteo", "https://open-meteo.com/", "match_weather", String(match.id), payload, 0.74);
      await sql.query(
        `update matches set weather_payload = $2::jsonb, source_coverage = jsonb_set(coalesce(source_coverage, '{}'::jsonb), '{weather}', $2::jsonb, true), updated_at = now() where match_id = $1`,
        [String(match.id), JSON.stringify(payload)]
      );
      matches += 1;
    }
  }
  const rows = await sql.query(
    `
      select m.match_id, m.date_key, m.kickoff_at, m.source_coverage, v.latitude, v.longitude, v.name as venue_name
      from matches m
      join venues v on v.venue_id = m.venue_id
      where v.latitude is not null
        and v.longitude is not null
        and m.date_key is not null
        and coalesce(m.weather_payload, '{}'::jsonb) = '{}'::jsonb
      order by m.kickoff_at nulls last, m.date_key desc
      limit $1
    `,
    [Math.max(0, WEATHER_LIMIT - matches)]
  );
  for (const row of rows) {
    try {
      const dateKey = String(row.date_key || row.kickoff_at || "").slice(0, 10);
      if (!dateKey) continue;
      const payload = await fetchOpenMeteoWeather(row.latitude, row.longitude, dateKey);
      payload.venueName = row.venue_name;
      payload.matchId = row.match_id;
      const sourceRecordId = `src_weather_${digest(row.match_id)}`;
      await upsertSourceRecord(sql, sourceRecordId, "Open-Meteo", "https://open-meteo.com/", "match_weather", String(row.match_id), payload, 0.78);
      const coverage = row.source_coverage && typeof row.source_coverage === "object" ? row.source_coverage : {};
      const entries = Array.isArray(coverage.entries) ? coverage.entries.filter((entry) => entry.key !== "weather") : [];
      entries.push({ key: "weather", label: "Weer", available: true, source: "Open-Meteo" });
      const nextCoverage = {
        ...coverage,
        entries,
        sources: [...new Set([...(coverage.sources || []), "Open-Meteo"])],
        percent: Math.max(Number(coverage.percent || 0), Math.round((entries.filter((entry) => entry.available).length / Math.max(entries.length, 1)) * 100)),
      };
      await sql.query(
        `update matches set weather_payload = $2::jsonb, source_coverage = $3::jsonb, updated_at = now() where match_id = $1`,
        [String(row.match_id), JSON.stringify(payload), JSON.stringify(nextCoverage)]
      );
      matches += 1;
    } catch (error) {
      errors.push({ source: "open-meteo", matchId: row.match_id, error: error.message });
    }
  }
  return { matches, errors };
}

async function backfillVenueCoordinates(sql) {
  const rows = await sql.query(
    `
      select club_id, name, country_name
      from clubs
      where venue_id is null
      order by updated_at desc nulls last, name
      limit $1
    `,
    [Math.max(VENUE_GEOCODE_LIMIT * 20, VENUE_GEOCODE_LIMIT)]
  );
  const targetRows = rows
    .sort((a, b) => {
      const aKnown = KNOWN_VENUES[canonicalTeamName(a.name)] ? 0 : 1;
      const bKnown = KNOWN_VENUES[canonicalTeamName(b.name)] ? 0 : 1;
      return aKnown - bKnown || String(a.name).localeCompare(String(b.name));
    })
    .slice(0, VENUE_GEOCODE_LIMIT);
  let geocoded = 0;
  let curated = 0;
  const errors = [];
  for (const row of targetRows) {
    try {
      const knownVenue = KNOWN_VENUES[canonicalTeamName(row.name)] || null;
      if (knownVenue) {
        const venueId = `venue-${slug(knownVenue.name)}-${slug(knownVenue.city)}`;
        const sourceRecordId = `src_venue_curated_${digest(row.club_id)}`;
        const payload = { provider: "curated-free-venue-seed", team: row.name, venue: knownVenue };
        await upsertSourceRecord(sql, sourceRecordId, "curated-free-venue-seed", null, "venue_geocode", row.club_id, payload, 0.82);
        await sql.query(
          `
            insert into venues (venue_id, name, city, latitude, longitude, provider_ids)
            values ($1,$2,$3,$4,$5,$6::jsonb)
            on conflict (venue_id) do update set
              name = excluded.name,
              city = excluded.city,
              latitude = excluded.latitude,
              longitude = excluded.longitude,
              provider_ids = excluded.provider_ids,
              updated_at = now()
          `,
          [
            venueId,
            knownVenue.name,
            knownVenue.city,
            knownVenue.lat,
            knownVenue.lon,
            JSON.stringify({ curated: true, team: row.name, sourceRecordId }),
          ]
        );
        await sql.query(`update clubs set venue_id = $2, stadium = coalesce(stadium, $3), updated_at = now() where club_id = $1`, [
          row.club_id,
          venueId,
          knownVenue.name,
        ]);
        curated += 1;
        continue;
      }
      const query = encodeURIComponent(`${row.name} football stadium ${row.country_name || ""}`.trim());
      const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`;
      const results = await fetchNominatimJson(url);
      const first = Array.isArray(results) ? results[0] : null;
      if (!first?.lat || !first?.lon) continue;
      const venueId = `venue-osm-${digest(`${row.club_id}|${first.osm_type}|${first.osm_id}`)}`;
      const payload = {
        provider: "OpenStreetMap Nominatim",
        query: decodeURIComponent(query),
        result: first,
      };
      const sourceRecordId = `src_venue_geocode_${digest(row.club_id)}`;
      await upsertSourceRecord(sql, sourceRecordId, "OpenStreetMap Nominatim", url, "venue_geocode", row.club_id, payload, 0.68);
      await sql.query(
        `
          insert into venues (venue_id, name, city, latitude, longitude, provider_ids)
          values ($1,$2,$3,$4,$5,$6::jsonb)
          on conflict (venue_id) do update set
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            provider_ids = excluded.provider_ids,
            updated_at = now()
        `,
        [
          venueId,
          String(first.display_name || `${row.name} stadium`).split(",")[0],
          String(first.display_name || "").split(",")[1]?.trim() || null,
          Number(first.lat),
          Number(first.lon),
          JSON.stringify({ nominatim: { osmType: first.osm_type, osmId: first.osm_id } }),
        ]
      );
      await sql.query(`update clubs set venue_id = $2, stadium = coalesce(stadium, $3), updated_at = now() where club_id = $1`, [
        row.club_id,
        venueId,
        String(first.display_name || `${row.name} stadium`).split(",")[0],
      ]);
      geocoded += 1;
      await sleep(1100);
    } catch (error) {
      errors.push({ clubId: row.club_id, error: error.message });
    }
  }
  return { scanned: targetRows.length, candidatePool: rows.length, curated, geocoded, errors };
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  if (!sql) {
    console.error("DATABASE_URL of POSTGRES_URL ontbreekt; gratis bronimport overgeslagen.");
    process.exit(2);
  }
  const startedAt = new Date().toISOString();
  const result = {
    generatedAt: startedAt,
    limit: LIMIT,
    sourceFilter: SOURCE_FILTER,
    leagueFilter: LEAGUE_FILTER || null,
    seasonFolderFilter: SEASON_FOLDER_FILTER || null,
    footballData: SOURCE_FILTER === "all" || SOURCE_FILTER === "football-data" ? await importFootballData(sql) : { skipped: true },
    openFootball: SOURCE_FILTER === "all" || SOURCE_FILTER === "openfootball" ? await importOpenFootball(sql) : { skipped: true },
    statsBomb: SOURCE_FILTER === "all" || SOURCE_FILTER === "statsbomb" ? await importStatsBombCatalog(sql) : { skipped: true },
    statsBombEvents: SOURCE_FILTER === "all" || SOURCE_FILTER === "statsbomb" ? await importStatsBombEvents(sql) : { skipped: true },
    venueGeocode: SOURCE_FILTER === "all" || SOURCE_FILTER === "venues" ? await backfillVenueCoordinates(sql) : { skipped: true },
    openMeteoStoredWeather: SOURCE_FILTER === "all" || SOURCE_FILTER === "weather" ? await importStoredWeather(sql) : { skipped: true },
  };
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
