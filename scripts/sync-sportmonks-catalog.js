#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { getSportmonksApiKey } from "./provider-env.js";

const root = process.cwd();
loadLocalEnv(root);
const sql = getSql();
const apiKey = getSportmonksApiKey();

if (!sql) {
  console.error("DATABASE_URL of POSTGRES_URL ontbreekt.");
  process.exit(2);
}
if (!apiKey) {
  console.error("SPORTMONKS_API_KEY of MYSPORTS_API_KEY ontbreekt.");
  process.exit(2);
}

const startedAt = Date.now();
const maxLeagues = Math.max(1, Number(process.env.SPORTMONKS_SYNC_MAX_LEAGUES || 250));
const maxSeasonTeamFetches = Math.max(0, Number(process.env.SPORTMONKS_SYNC_TEAM_SEASON_LIMIT || 60));
const perPage = Math.min(100, Math.max(1, Number(process.env.SPORTMONKS_SYNC_PER_PAGE || 100)));
const timeoutMs = Math.max(1000, Number(process.env.SPORTMONKS_SYNC_TIMEOUT_MS || 12000));
const reportPath = path.join(root, "monitor", "sportmonks-catalog-sync.json");

function digest(value, size = 24) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, size);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeAlias(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function rowsFromPayload(payload) {
  return Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
}

function nextPageUrl(payload) {
  return (
    payload?.pagination?.links?.next ||
    payload?.meta?.pagination?.links?.next ||
    payload?.meta?.pagination?.next_page_url ||
    payload?.links?.next ||
    null
  );
}

function rateLimitFromPayload(payload) {
  return payload?.rate_limit || payload?.meta?.rate_limit || payload?.meta?.pagination?.rate_limit || null;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "voetbalvoorspellingen-sportmonks-catalog-sync/1.0" },
    });
    const payload = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      payload,
      quota: {
        limit: response.headers.get("x-ratelimit-limit"),
        remaining: response.headers.get("x-ratelimit-remaining"),
        retryAfter: response.headers.get("retry-after"),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPaged(baseUrl, limit) {
  const rows = [];
  const errors = [];
  const quotas = [];
  let url = baseUrl;
  while (url && rows.length < limit) {
    const result = await fetchJson(url);
    quotas.push({ status: result.status, quota: result.quota, rateLimit: rateLimitFromPayload(result.payload) });
    if (!result.ok) {
      errors.push({ url: url.replace(apiKey, "***"), status: result.status, message: result.payload?.message || result.payload?.error || null });
      break;
    }
    rows.push(...rowsFromPayload(result.payload));
    url = nextPageUrl(result.payload);
    if (url && !/api_token=/.test(url)) url += `${url.includes("?") ? "&" : "?"}api_token=${encodeURIComponent(apiKey)}`;
  }
  return { rows: rows.slice(0, limit), errors, quotas };
}

function countryFromLeague(league) {
  return league?.country || league?.country_id && { id: league.country_id } || null;
}

function seasonsFromLeague(league) {
  return [
    ...asArray(league?.seasons),
    ...asArray(league?.season),
    ...asArray(league?.currentseason),
    ...asArray(league?.currentSeason),
  ]
    .filter((season) => season?.id)
    .filter((season, index, all) => all.findIndex((item) => String(item.id) === String(season.id)) === index);
}

function usefulSeasonScore(season) {
  const name = String(season?.name || season?.year || "");
  const current = season?.is_current || season?.current || season?.finished === false ? 100 : 0;
  const recency = Number(String(name).match(/\d{4}/)?.[0] || season?.id || 0);
  return current + recency;
}

function leagueBucket(league) {
  const name = `${league?.name || ""} ${league?.short_code || ""}`.toLowerCase();
  const country = String(countryFromLeague(league)?.name || league?.country_name || "").toLowerCase();
  if (/conference|champions|europa|uefa/.test(name) || /europe/.test(country)) return "uefa_or_europe";
  if (/friendly|friendlies/.test(name)) return "friendlies";
  if (league?.type === "cup") return "cup";
  return "domestic";
}

const leagueUrl =
  `https://api.sportmonks.com/v3/football/leagues?api_token=${encodeURIComponent(apiKey)}` +
  `&include=country;seasons&per_page=${perPage}`;
const leagueFetch = await fetchPaged(leagueUrl, maxLeagues);
const leagues = leagueFetch.rows;

const countries = [];
const competitions = [];
const seasons = [];
const seasonTargets = [];
const sourceRecords = [];

for (const league of leagues) {
  const country = countryFromLeague(league);
  const countryId = country?.id ? `sportmonks-country-${country.id}` : null;
  if (countryId) {
    countries.push({
      country_id: countryId,
      name: country.name || country.official_name || `Sportmonks Country ${country.id}`,
      fifa_code: country.fifa_name || country.iso2 || country.iso3 || null,
      region: country.continent_id ? `continent-${country.continent_id}` : null,
    });
  }
  const competitionId = `sportmonks-league-${league.id}`;
  competitions.push({
    competition_id: competitionId,
    name: league.name || `Sportmonks League ${league.id}`,
    country_id: countryId,
    country_name: country?.name || null,
    competition_type: league.type || league.sub_type || "league",
    provider_ids: {
      sportmonks: {
        leagueId: league.id,
        sportId: league.sport_id || null,
        shortCode: league.short_code || null,
        active: league.active ?? null,
        category: league.category || null,
        type: league.type || null,
        subType: league.sub_type || null,
        bucket: leagueBucket(league),
      },
    },
  });
  sourceRecords.push({
    source_record_id: `sportmonks_league_${league.id}`,
    provider: "sportmonks",
    source_url: "https://api.sportmonks.com/v3/football/leagues",
    entity_type: "competition",
    entity_key: String(league.id),
    content_hash: digest(JSON.stringify({
      id: league.id,
      name: league.name,
      country: country?.name || null,
      type: league.type || null,
      active: league.active ?? null,
    }), 40),
    trust_score: 0.84,
    payload: {
      id: league.id,
      name: league.name,
      country: country?.name || null,
      active: league.active ?? null,
      type: league.type || null,
      subType: league.sub_type || null,
      bucket: leagueBucket(league),
    },
  });

  const leagueSeasons = seasonsFromLeague(league).sort((a, b) => usefulSeasonScore(b) - usefulSeasonScore(a)).slice(0, 3);
  for (const season of leagueSeasons) {
    const seasonId = `sportmonks-season-${season.id}`;
    seasons.push({
      season_id: seasonId,
      competition_id: competitionId,
      year_label: String(season.name || season.year || season.id),
      start_date: season.starting_at || season.start_date || null,
      end_date: season.ending_at || season.end_date || null,
      status: season.is_current || season.current || season.finished === false ? "active" : "planned",
      sportmonksSeasonId: String(season.id),
      leagueName: league.name || null,
      leagueBucket: leagueBucket(league),
    });
    seasonTargets.push({
      season_id: seasonId,
      competition_id: competitionId,
      sportmonksSeasonId: String(season.id),
      leagueName: league.name || null,
      leagueBucket: leagueBucket(league),
      score: usefulSeasonScore(season),
    });
  }
}

function uniqueBy(items, keyFn) {
  const map = new Map();
  for (const item of items) map.set(keyFn(item), item);
  return [...map.values()];
}

const uniqueCountries = uniqueBy(countries, (row) => row.country_id);
const uniqueCompetitions = uniqueBy(competitions, (row) => row.competition_id);
const uniqueSeasons = uniqueBy(seasons, (row) => row.season_id);

if (uniqueCountries.length) {
  await sql.query(
    `with incoming as (
       select * from jsonb_to_recordset($1::jsonb) as x(country_id text, name text, fifa_code text, region text)
     )
     insert into countries (country_id, name, fifa_code, region)
     select country_id, name, fifa_code, region from incoming
     on conflict (country_id) do update set
       name=excluded.name,
       fifa_code=coalesce(excluded.fifa_code, countries.fifa_code),
       region=coalesce(excluded.region, countries.region),
       updated_at=now()`,
    [JSON.stringify(uniqueCountries)]
  );
}

if (uniqueCompetitions.length) {
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
    [JSON.stringify(uniqueCompetitions)]
  );
}

for (const table of ["seasons", "competition_seasons"]) {
  if (!uniqueSeasons.length) continue;
  await sql.query(
    `with incoming as (
       select * from jsonb_to_recordset($1::jsonb) as x(
         season_id text, competition_id text, year_label text, start_date date, end_date date, status text
       )
     )
     insert into ${table} (season_id, competition_id, year_label, start_date, end_date, status)
     select season_id, competition_id, year_label, start_date, end_date, status from incoming
     on conflict (season_id) do update set
       competition_id=excluded.competition_id,
       year_label=excluded.year_label,
       start_date=coalesce(excluded.start_date, ${table}.start_date),
       end_date=coalesce(excluded.end_date, ${table}.end_date),
       status=excluded.status,
       updated_at=now()`,
    [JSON.stringify(uniqueSeasons)]
  );
}

if (sourceRecords.length) {
  await sql.query(
    `with incoming as (
       select * from jsonb_to_recordset($1::jsonb) as x(
         source_record_id text, provider text, source_url text, entity_type text, entity_key text,
         content_hash text, trust_score numeric, payload jsonb
       )
     )
     insert into source_records (
       source_record_id, provider, source_url, entity_type, entity_key, fetched_at, content_hash, trust_score, payload
     )
     select source_record_id, provider, source_url, entity_type, entity_key, now(), content_hash, trust_score, payload from incoming
     on conflict (source_record_id) do update set
       fetched_at=excluded.fetched_at,
       content_hash=excluded.content_hash,
       trust_score=greatest(coalesce(source_records.trust_score,0), excluded.trust_score),
       payload=excluded.payload`,
    [JSON.stringify(sourceRecords)]
  );
}

const teamSeasonTargets = seasonTargets
  .filter((row) => ["domestic", "uefa_or_europe"].includes(row.leagueBucket))
  .sort((a, b) => b.score - a.score)
  .slice(0, maxSeasonTeamFetches);

let teamFetches = 0;
let teamRows = 0;
let memberships = 0;
const teamErrors = [];
const teamExamples = [];

for (const target of teamSeasonTargets) {
  const url =
    `https://api.sportmonks.com/v3/football/teams/seasons/${encodeURIComponent(target.sportmonksSeasonId)}` +
    `?api_token=${encodeURIComponent(apiKey)}&include=country&per_page=${perPage}`;
  const teamsFetch = await fetchPaged(url, 200);
  teamFetches += 1;
  teamErrors.push(...teamsFetch.errors.map((error) => ({ ...error, seasonId: target.sportmonksSeasonId, league: target.leagueName })));
  const teams = teamsFetch.rows.filter((team) => team?.id && team?.name);
  teamRows += teams.length;
  if (!teams.length) continue;

  const teamCountries = uniqueBy(
    teams
      .filter((team) => team?.country_id && team?.country?.name)
      .map((team) => ({
        country_id: `sportmonks-country-${team.country_id}`,
        name: team.country.name,
        fifa_code: team.country.fifa_name || team.country.iso2 || team.country.iso3 || null,
        region: team.country.continent_id ? `continent-${team.country.continent_id}` : null,
      })),
    (row) => row.country_id
  );
  if (teamCountries.length) {
    await sql.query(
      `with incoming as (
         select * from jsonb_to_recordset($1::jsonb) as x(country_id text, name text, fifa_code text, region text)
       )
       insert into countries (country_id, name, fifa_code, region)
       select country_id, name, fifa_code, region from incoming
       on conflict (country_id) do update set
         name=excluded.name,
         fifa_code=coalesce(excluded.fifa_code, countries.fifa_code),
         region=coalesce(excluded.region, countries.region),
         updated_at=now()`,
      [JSON.stringify(teamCountries)]
    );
  }

  const clubs = uniqueBy(teams.map((team) => ({
    club_id: `sportmonks-team-${team.id}`,
    name: team.name,
    country_id: team.country_id ? `sportmonks-country-${team.country_id}` : null,
    country_name: team.country?.name || null,
    stadium: null,
    founded_year: Number(team.founded || 0) || null,
    provider_ids: {
      sportmonks: {
        teamId: team.id,
        shortCode: team.short_code || null,
        type: team.type || null,
        placeholder: team.placeholder ?? null,
      },
    },
  })), (club) => club.club_id);
  await sql.query(
    `with incoming as (
       select * from jsonb_to_recordset($1::jsonb) as x(
         club_id text, name text, country_id text, country_name text, stadium text, founded_year integer, provider_ids jsonb
       )
     )
     insert into clubs (club_id, name, country_id, country_name, stadium, founded_year, provider_ids)
     select club_id, name, country_id, country_name, stadium, founded_year, provider_ids from incoming
     on conflict (club_id) do update set
       name=excluded.name,
       country_id=coalesce(excluded.country_id, clubs.country_id),
       country_name=coalesce(excluded.country_name, clubs.country_name),
       founded_year=coalesce(excluded.founded_year, clubs.founded_year),
       provider_ids=clubs.provider_ids || excluded.provider_ids,
       updated_at=now()`,
    [JSON.stringify(clubs)]
  );

  const aliases = uniqueBy(clubs.flatMap((club) => [
    { club_id: club.club_id, alias: club.name, normalized_alias: normalizeAlias(club.name), source: "sportmonks" },
    club.provider_ids?.sportmonks?.shortCode
      ? { club_id: club.club_id, alias: club.provider_ids.sportmonks.shortCode, normalized_alias: normalizeAlias(club.provider_ids.sportmonks.shortCode), source: "sportmonks-short-code" }
      : null,
  ].filter(Boolean)), (alias) => `${alias.club_id}|${alias.normalized_alias}`);
  await sql.query(
    `with incoming as (
       select * from jsonb_to_recordset($1::jsonb) as x(club_id text, alias text, normalized_alias text, source text)
     )
     insert into club_aliases (club_id, alias, normalized_alias, source)
     select club_id, alias, normalized_alias, source from incoming
     on conflict (club_id, normalized_alias) do update set
       alias=excluded.alias,
       source=excluded.source`,
    [JSON.stringify(aliases)]
  );

  const membershipRows = uniqueBy(clubs.map((club) => ({
    season_id: target.season_id,
    competition_id: target.competition_id,
    club_id: club.club_id,
    club_name: club.name,
    status: "active",
    entry_reason: "sportmonks-season-teams",
    source: "sportmonks",
  })), (membership) => `${membership.season_id}|${membership.club_id}`);
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
    [JSON.stringify(membershipRows)]
  );
  memberships += membershipRows.length;
  if (teamExamples.length < 12) {
    teamExamples.push({
      league: target.leagueName,
      seasonId: target.sportmonksSeasonId,
      teams: teams.length,
      sample: teams.slice(0, 5).map((team) => team.name),
    });
  }
}

const buckets = {};
for (const league of leagues) buckets[leagueBucket(league)] = (buckets[leagueBucket(league)] || 0) + 1;

const uefaLeagues = leagues
  .filter((league) => leagueBucket(league) === "uefa_or_europe")
  .map((league) => ({
    id: league.id,
    name: league.name,
    country: countryFromLeague(league)?.name || null,
    active: league.active ?? null,
    type: league.type || null,
    seasons: seasonsFromLeague(league).length,
  }))
  .slice(0, 40);

const smallLeagueExamples = leagues
  .filter((league) => leagueBucket(league) === "domestic")
  .map((league) => ({
    id: league.id,
    name: league.name,
    country: countryFromLeague(league)?.name || null,
    active: league.active ?? null,
    seasons: seasonsFromLeague(league).length,
  }))
  .slice(0, 40);

const report = {
  ok: true,
  generatedAt: new Date().toISOString(),
  apiLimits: {
    maxLeagues,
    maxSeasonTeamFetches,
    perPage,
  },
  accessible: {
    leagues: leagues.length,
    countries: uniqueCountries.length,
    seasons: uniqueSeasons.length,
    teamSeasonFetches: teamFetches,
    teams: teamRows,
    memberships,
    buckets,
  },
  uefaOrEuropeLeagues: uefaLeagues,
  domesticLeagueExamples: smallLeagueExamples,
  teamExamples,
  errors: [...leagueFetch.errors, ...teamErrors].slice(0, 30),
  quotaSamples: leagueFetch.quotas.slice(-3),
  durationMs: Date.now() - startedAt,
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
