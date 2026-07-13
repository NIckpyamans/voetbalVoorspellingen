#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { buildR2ObjectKey, getR2Config, putR2Object } from "../shared/cloudflare-r2.js";
import { getApiFootballKey, getSportmonksApiKey } from "./provider-env.js";
import { findSportmonksFixture, resolveSportmonksFixtureId } from "./sportmonks-fixture-resolver.js";

const ROOT = process.cwd();
const LOOKAHEAD_MINUTES = Math.max(30, Number(process.env.LINEUP_LOOKAHEAD_MINUTES || 150));
const GRACE_MINUTES = Math.max(0, Number(process.env.LINEUP_KICKOFF_GRACE_MINUTES || 10));
const MAX_MATCHES = Math.max(1, Number(process.env.LINEUP_PROVIDER_MAX_MATCHES || 16));
const OUTPUT = path.join(ROOT, "monitor", "pre-kickoff-lineup-collector.json");
const apiFootballFixtureCache = new Map();

function digest(value, size = 40) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, size);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedTeam(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|afc|cf|sc|ac|club|fk|sv|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function teamSimilarity(left, right) {
  const a = normalizedTeam(left);
  const b = normalizedTeam(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.94;
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  return overlap / Math.max(1, Math.min(aTokens.size, bTokens.size));
}

function playerRow(item, source) {
  const player = item?.player || item || {};
  const position = player?.position || item?.position?.code || item?.position?.name || item?.position || "";
  return {
    name: String(player?.name || player?.display_name || item?.player_name || "").trim(),
    position: String(position || "").trim(),
    shirtNumber: item?.number ?? item?.jersey_number ?? item?.shirt_number ?? null,
    rating: Number(item?.rating || player?.rating || 0) || null,
    source,
  };
}

function lineupSide({ formation = null, starters = [], substitutes = [], source }) {
  const players = starters.map((item) => playerRow(item, source)).filter((item) => item.name).slice(0, 11);
  const keeper = players.find((item) => /^g|goal/i.test(item.position));
  const ratings = players.map((item) => Number(item.rating || 0)).filter((value) => value > 0);
  return {
    formation,
    starters: players.length,
    bench: substitutes.length,
    players,
    avgRating: ratings.length ? Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2)) : null,
    keeperName: keeper?.name || null,
    keeperRating: keeper?.rating || null,
    confirmed: players.length >= 10,
    projected: false,
  };
}

export function normalizeApiFootball(payload) {
  const teams = asArray(payload?.response);
  if (teams.length < 2) return null;
  const sides = teams.slice(0, 2).map((team) => lineupSide({
    formation: team?.formation || null,
    starters: asArray(team?.startXI),
    substitutes: asArray(team?.substitutes),
    source: "API-Football confirmed lineups",
  }));
  if (!sides.some((side) => side.starters > 0)) return null;
  return {
    home: sides[0],
    away: sides[1],
    confirmed: sides.every((side) => side.confirmed),
    projected: false,
    source: "API-Football confirmed lineups",
    summary: "Officiele wedstrijselecties opgehaald vlak voor de aftrap.",
  };
}

export function normalizeSportmonks(payload) {
  const fixture = payload?.data || null;
  const participants = asArray(fixture?.participants);
  const lineups = asArray(fixture?.lineups);
  if (!fixture || !lineups.length) return null;
  const homeParticipant = participants.find((item) => item?.meta?.location === "home") || participants[0];
  const awayParticipant = participants.find((item) => item?.meta?.location === "away") || participants[1];
  const teamRows = (teamId) => lineups.filter((item) => String(item?.team_id || item?.participant_id || "") === String(teamId || ""));
  const build = (participant) => {
    const rows = teamRows(participant?.id);
    const starters = rows.filter((item) => item?.type_id === 11 || item?.starter === true || item?.formation_position != null);
    const substitutes = rows.filter((item) => !starters.includes(item));
    return lineupSide({ formation: participant?.meta?.formation || null, starters, substitutes, source: "Sportmonks confirmed lineups" });
  };
  const home = build(homeParticipant);
  const away = build(awayParticipant);
  if (!home.starters && !away.starters) return null;
  return {
    home,
    away,
    confirmed: home.confirmed && away.confirmed,
    projected: false,
    source: "Sportmonks confirmed lineups",
    summary: "Officiele wedstrijselecties opgehaald vlak voor de aftrap.",
  };
}

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchApiFootballLineup(fixtureId) {
  const key = getApiFootballKey();
  if (!key || !fixtureId) return { status: "not_configured_or_unmapped" };
  const base = String(process.env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io").replace(/\/$/, "");
  const url = `${base}/fixtures/lineups?fixture=${encodeURIComponent(fixtureId)}`;
  const hostname = new URL(url).hostname;
  const headers = /rapidapi/i.test(hostname)
    ? { "x-rapidapi-key": key, "x-rapidapi-host": hostname }
    : { "x-apisports-key": key };
  const result = await fetchJson(url, headers);
  return { ...result, status: result.ok ? "ok" : `http_${result.status}`, lineup: result.ok ? normalizeApiFootball(result.payload) : null, url };
}

async function resolveApiFootballFixture(match) {
  const key = getApiFootballKey();
  const date = String(match?.kickoff_at || "").slice(0, 10);
  if (!key || !date) return null;
  if (!apiFootballFixtureCache.has(date)) {
    const base = String(process.env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io").replace(/\/$/, "");
    const url = `${base}/fixtures?date=${encodeURIComponent(date)}`;
    const hostname = new URL(url).hostname;
    const headers = /rapidapi/i.test(hostname)
      ? { "x-rapidapi-key": key, "x-rapidapi-host": hostname }
      : { "x-apisports-key": key };
    apiFootballFixtureCache.set(date, fetchJson(url, headers));
  }
  const result = await apiFootballFixtureCache.get(date);
  if (!result?.ok) return null;
  let best = null;
  for (const row of asArray(result.payload?.response)) {
    const direct = Math.min(
      teamSimilarity(match.home_team_name, row?.teams?.home?.name),
      teamSimilarity(match.away_team_name, row?.teams?.away?.name)
    );
    if (direct < 0.82 || (best && best.score >= direct)) continue;
    best = { fixtureId: String(row?.fixture?.id || ""), score: direct };
  }
  return best?.fixtureId || null;
}

async function fetchSportmonksLineup(sql, match) {
  const key = getSportmonksApiKey();
  if (!key) return { status: "not_configured" };
  const fixtureInput = {
    matchId: match.match_id,
    canonicalFixtureId: match.canonical_fixture_id,
    kickoff: match.kickoff_at,
    homeTeam: match.home_team_name,
    awayTeam: match.away_team_name,
  };
  const resolved = sql ? await resolveSportmonksFixtureId(sql, fixtureInput) : await findSportmonksFixture(fixtureInput);
  if (!resolved?.fixtureId) return { status: resolved?.status || "unmapped" };
  const url = `https://api.sportmonks.com/v3/football/fixtures/${encodeURIComponent(resolved.fixtureId)}?api_token=${encodeURIComponent(key)}&include=participants;lineups.player;lineups.position`;
  const result = await fetchJson(url);
  return { ...result, status: result.ok ? "ok" : `http_${result.status}`, lineup: result.ok ? normalizeSportmonks(result.payload) : null, url };
}

async function storeR2Lineup(match, provider, lineup) {
  const config = getR2Config();
  if (!config.configured || !lineup) return { ok: false, skipped: true, reason: "r2_not_configured" };
  const payload = {
    matchId: match.match_id,
    kickoff: match.kickoff_at,
    capturedAt: new Date().toISOString(),
    provider,
    lineupSummary: lineup,
  };
  return putR2Object({
    config,
    key: buildR2ObjectKey(config, `critical-captures/lineups/${match.match_id}.json`),
    body: `${JSON.stringify(payload)}\n`,
    contentType: "application/json",
    metadata: { provider, match: match.match_id },
  });
}

function staticMatchesInWindow() {
  const now = Date.now();
  const rows = [];
  for (let offset = 0; offset <= 1; offset += 1) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() + offset);
    const filePath = path.join(ROOT, "data", "days", `${day.toISOString().slice(0, 10)}.json`);
    if (!fs.existsSync(filePath)) continue;
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    for (const match of asArray(payload?.matches)) {
      const kickoff = Date.parse(match?.kickoff || "");
      const minutes = (kickoff - now) / 60000;
      if (!Number.isFinite(kickoff) || minutes < -GRACE_MINUTES || minutes > LOOKAHEAD_MINUTES) continue;
      if (!match?.homeTeamName || !match?.awayTeamName) continue;
      rows.push({
        match_id: String(match.id || `ss-${match.sofaId}`),
        canonical_fixture_id: String(match.id || `ss-${match.sofaId}`),
        kickoff_at: new Date(kickoff).toISOString(),
        league: match.league || null,
        home_team_name: match.homeTeamName,
        away_team_name: match.awayTeamName,
        api_football_fixture_id: null,
      });
    }
  }
  return rows.sort((left, right) => Date.parse(left.kickoff_at) - Date.parse(right.kickoff_at)).slice(0, MAX_MATCHES);
}

async function storeLineup(sql, match, provider, sourceUrl, lineup) {
  const capturedAt = new Date().toISOString();
  const contentHash = digest(JSON.stringify(lineup));
  const sourceRecordId = `lineup_${digest(`${match.match_id}|${provider}|${contentHash}`)}`;
  const matchSourceRecordId = `msr_${digest(`${match.match_id}|${sourceRecordId}`)}`;
  const payload = { matchId: match.match_id, kickoff: match.kickoff_at, capturedAt, provider, lineupSummary: lineup };
  await sql.query(
    `insert into source_records(source_record_id,provider,source_url,entity_type,entity_key,fetched_at,source_timestamp,content_hash,trust_score,payload)
     values($1,$2,$3,'lineup',$4,now(),$5,$6,$7,$8::jsonb)
     on conflict(source_record_id) do update set fetched_at=excluded.fetched_at, source_timestamp=excluded.source_timestamp, payload=excluded.payload`,
    [sourceRecordId, provider, sourceUrl || null, match.match_id, capturedAt, contentHash, lineup.confirmed ? 0.92 : 0.72, JSON.stringify(payload)]
  );
  await sql.query(
    `insert into match_source_records(match_source_record_id,match_id,source_record_id,provider,is_primary,trust_score)
     values($1,$2,$3,$4,false,$5)
     on conflict(match_source_record_id) do update set trust_score=excluded.trust_score,updated_at=now()`,
    [matchSourceRecordId, match.match_id, sourceRecordId, provider, lineup.confirmed ? 0.92 : 0.72]
  );
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  let databaseWritable = Boolean(sql);
  let databaseError = sql ? null : "database_not_configured";
  let matches = [];
  try {
    if (!sql) throw new Error("database_not_configured");
    matches = await sql.query(
    `select m.match_id,m.canonical_fixture_id,m.kickoff_at,m.league,m.home_team_name,m.away_team_name,
       max(case when fsa.provider='api-football' then fsa.source_match_id end) as api_football_fixture_id
     from matches m
     left join fixture_source_aliases fsa on fsa.canonical_match_id=m.match_id
     where m.kickoff_at >= now() - ($1::int * interval '1 minute')
       and m.kickoff_at <= now() + ($2::int * interval '1 minute')
       and m.identity_status='resolved'
       and m.home_club_id is not null and m.away_club_id is not null
       and coalesce(m.league,'') !~* '(fifa|world cup|national team|nations league)'
     group by m.match_id,m.canonical_fixture_id,m.kickoff_at,m.league,m.home_team_name,m.away_team_name
     order by m.kickoff_at limit $3`,
    [GRACE_MINUTES, LOOKAHEAD_MINUTES, MAX_MATCHES]
    );
  } catch (error) {
    databaseWritable = false;
    databaseError = error?.message || String(error);
    matches = staticMatchesInWindow();
  }
  const report = { generatedAt: new Date().toISOString(), checked: matches.length, confirmed: 0, partial: 0, missing: 0, r2Stored: 0, databaseWritable, databaseError, providers: {}, matches: [] };
  for (const match of matches) {
    const apiFootballFixtureId = match.api_football_fixture_id || await resolveApiFootballFixture(match);
    let result = await fetchApiFootballLineup(apiFootballFixtureId);
    let provider = "api-football";
    if (!result.lineup) {
      result = await fetchSportmonksLineup(databaseWritable ? sql : null, match);
      provider = "sportmonks";
    }
    report.providers[`${provider}:${result.status}`] = Number(report.providers[`${provider}:${result.status}`] || 0) + 1;
    if (result.lineup) {
      const r2 = await storeR2Lineup(match, provider, result.lineup).catch((error) => ({ ok: false, error: error?.message || String(error) }));
      if (r2.ok) report.r2Stored += 1;
      if (databaseWritable) {
        await storeLineup(sql, match, provider, result.url, result.lineup);
      }
      if (result.lineup.confirmed) report.confirmed += 1;
      else report.partial += 1;
    } else {
      report.missing += 1;
    }
    report.matches.push({ matchId: match.match_id, kickoff: match.kickoff_at, homeTeam: match.home_team_name, awayTeam: match.away_team_name, provider, status: result.status, confirmed: Boolean(result.lineup?.confirmed) });
  }
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
