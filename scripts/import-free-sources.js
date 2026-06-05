#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";

const ROOT = process.cwd();
const LIMIT = Math.max(1, Number(process.env.FREE_SOURCE_IMPORT_LIMIT || 120));
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

function currentSeasonFolders() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const start = month >= 7 ? year : year - 1;
  const folder = `${String(start).slice(2)}${String(start + 1).slice(2)}`;
  const previous = `${String(start - 1).slice(2)}${String(start).slice(2)}`;
  return [folder, previous];
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
  await sql.query(
    `
      insert into clubs (club_id, name, country_id, country_name, provider_ids)
      values ($1, $2, $3, $4, $5::jsonb)
      on conflict (club_id) do update set name = excluded.name, country_id = excluded.country_id, country_name = excluded.country_name, provider_ids = excluded.provider_ids, updated_at = now()
    `,
    [clubId, name, countryId, countryName, JSON.stringify({ [provider]: providerId || name })]
  );
  await sql.query(
    `insert into club_aliases (club_id, alias, normalized_alias, source) values ($1, $2, $3, $4) on conflict (club_id, normalized_alias) do nothing`,
    [clubId, name, slug(name), provider]
  );
  return clubId;
}

async function importFootballData(sql) {
  let matches = 0;
  let odds = 0;
  let stats = 0;
  const errors = [];
  for (const folder of currentSeasonFolders()) {
    const seasonLabel = seasonLabelFromFolder(folder);
    for (const item of FOOTBALL_DATA_LEAGUES) {
      if (matches >= LIMIT) break;
      const url = `https://www.football-data.co.uk/mmz4281/${folder}/${item.code}.csv`;
      try {
        const rows = parseCsv(await fetchText(url)).filter((row) => row.Date && row.HomeTeam && row.AwayTeam);
        const { countryId, competitionId, seasonId } = await upsertCompetition(sql, "football-data", item, seasonLabel);
        await upsertSourceRecord(sql, `src_fd_${folder}_${item.code}`, "Football-Data.co.uk", url, "competition_season_csv", `${item.code}:${folder}`, { rows: rows.length, seasonLabel });
        for (const row of rows.slice(0, Math.max(0, LIMIT - matches))) {
          const dateKey = parseFootballDataDate(row.Date);
          if (!dateKey) continue;
          const homeClubId = await upsertClub(sql, countryId, item.country, row.HomeTeam, "football-data");
          const awayClubId = await upsertClub(sql, countryId, item.country, row.AwayTeam, "football-data");
          const matchId = `fd-${item.code}-${dateKey}-${digest(`${row.HomeTeam}|${row.AwayTeam}`)}`;
          const sourceRecordId = `src_fd_match_${digest(`${matchId}|${row.Date}`)}`;
          const finalHome = numeric(row.FTHG);
          const finalAway = numeric(row.FTAG);
          await upsertSourceRecord(sql, sourceRecordId, "Football-Data.co.uk", url, "match_row", matchId, row, 0.82);
          await sql.query(
            `
              insert into matches (
                match_id, source_match_id, data_source, competition_id, season_id, league, season, kickoff_at,
                home_club_id, away_club_id, home_team_id, away_team_id, home_team_name, away_team_name,
                status, status_normalized, date_key, raw_payload, source_coverage
              )
              values ($1, $2, 'football-data.co.uk', $3, $4, $5, $6, $7, $8, $9, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb)
              on conflict (match_id) do update set
                competition_id = excluded.competition_id,
                season_id = excluded.season_id,
                league = excluded.league,
                season = excluded.season,
                kickoff_at = excluded.kickoff_at,
                home_club_id = excluded.home_club_id,
                away_club_id = excluded.away_club_id,
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
  for (const seasonTag of ["2025-26", "2024-25", "2023-24", "2022-23", "2021-22"]) {
    for (const item of OPENFOOTBALL_COMPETITIONS) {
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
            const homeClubId = await upsertClub(sql, countryId, item.country, game.team1, "openfootball");
            const awayClubId = await upsertClub(sql, countryId, item.country, game.team2, "openfootball");
            clubs += 2;
            const matchId = `of-${item.code}-${game.date}-${digest(`${game.team1}|${game.team2}`)}`;
            const score = Array.isArray(game.score?.ft) ? game.score.ft : game.score;
            const finalHome = Array.isArray(score) ? numeric(score[0]) : null;
            const finalAway = Array.isArray(score) ? numeric(score[1]) : null;
            await sql.query(
              `
                insert into matches (
                  match_id, source_match_id, data_source, competition_id, season_id, league, season,
                  kickoff_at, home_club_id, away_club_id, home_team_id, away_team_id, home_team_name, away_team_name,
                  status, status_normalized, date_key, raw_payload, source_coverage
                )
                values ($1,$2,'OpenFootball',$3,$4,$5,$6,$7,$8,$9,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb)
                on conflict (match_id) do update set
                  competition_id = excluded.competition_id,
                  season_id = excluded.season_id,
                  league = excluded.league,
                  season = excluded.season,
                  kickoff_at = excluded.kickoff_at,
                  home_club_id = excluded.home_club_id,
                  away_club_id = excluded.away_club_id,
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
        errors.push({ source: "openfootball", url, error: error.message });
      }
    }
  }
  return { matches, clubs, errors };
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

async function importStoredWeather(sql) {
  const dataPath = path.join(ROOT, "server_data.json");
  if (!fs.existsSync(dataPath)) return { matches: 0, errors: [{ source: "open-meteo", error: "server_data.json missing" }] };
  const store = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  let matches = 0;
  for (const dayMatches of Object.values(store.matches || {})) {
    for (const match of dayMatches || []) {
      if (matches >= LIMIT) break;
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
  return { matches, errors: [] };
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
    footballData: await importFootballData(sql),
    openFootball: await importOpenFootball(sql),
    statsBomb: await importStatsBombCatalog(sql),
    openMeteoStoredWeather: await importStoredWeather(sql),
  };
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
