#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { buildR2ObjectKey, getR2Config, getR2Object, putR2Object } from "../shared/cloudflare-r2.js";
import { getApiFootballKey, getSportmonksApiKey } from "./provider-env.js";
import { findSportmonksFixture, resolveSportmonksFixtureId } from "./sportmonks-fixture-resolver.js";
import { normalizeApiFootball, normalizeFotMob, normalizeSofaScore, normalizeSportmonks } from "./providers/lineup-normalizers.js";
export { normalizeApiFootball, normalizeFotMob, normalizeSofaScore, normalizeSportmonks } from "./providers/lineup-normalizers.js";
import {
  classifyLineupCaptureWindow,
  mergeLineupCaptureLedger,
  minutesUntilKickoff,
} from "./worker/critical-captures.js";
import { summarizeLeagueCoverage } from "./worker/coverage-summary.js";
import { findCachedApiFootballFixtureId, readApiFootballFixtureCache } from "./worker/api-football-fixture-cache.js";
import { sportmonksEligibleFixtures } from "./worker/sportmonks-coverage-policy.js";
import { getCompetitionAgent, getCompetitionProviderOrder } from "./worker/competition-agents.js";

const ROOT = process.cwd();
const LOOKAHEAD_MINUTES = Math.max(30, Number(process.env.LINEUP_LOOKAHEAD_MINUTES || 90));
const GRACE_MINUTES = Math.max(0, Number(process.env.LINEUP_KICKOFF_GRACE_MINUTES || 10));
const MAX_MATCHES = Math.max(1, Number(process.env.LINEUP_PROVIDER_MAX_MATCHES || 16));
const CAPTURE_WINDOWS_ONLY = String(process.env.LINEUP_CAPTURE_WINDOWS_ONLY || "true").toLowerCase() !== "false";
const OUTPUT = path.join(ROOT, "monitor", "pre-kickoff-lineup-collector.json");
const apiFootballFixtureCache = new Map();
const persistedApiFootballFixtureCache = readApiFootballFixtureCache(ROOT);
const sofaScheduleCache = new Map();
const fotmobScheduleCache = new Map();
const providerHealth = readJson(path.join(ROOT, "monitor", "provider-quota-audit.json"), {});
const sportmonksCatalog = readJson(path.join(ROOT, "monitor", "sportmonks-catalog-sync.json"), {});

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

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

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, payload };
  } catch (error) {
    return { ok: false, status: "request_failed", payload: null, error: error?.name || error?.message || "request_failed" };
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

async function fetchSofaScoreLineup(match) {
  const date = String(match?.kickoff_at || "").slice(0, 10);
  if (!date) return { status: "invalid_date" };
  if (!sofaScheduleCache.has(date)) {
    sofaScheduleCache.set(date, fetchJson(`https://www.sofascore.com/api/v1/sport/football/scheduled-events/${date}`, {
      "User-Agent": "voetbalvoorspellingen-lineup-resolver/1.0",
    }));
  }
  const schedule = await sofaScheduleCache.get(date);
  if (!schedule?.ok) return { status: `schedule_http_${schedule?.status || "unknown"}` };
  let best = null;
  for (const event of asArray(schedule.payload?.events)) {
    const score = Math.min(
      teamSimilarity(match.home_team_name, event?.homeTeam?.name),
      teamSimilarity(match.away_team_name, event?.awayTeam?.name)
    );
    if (score < 0.82 || (best && best.score >= score)) continue;
    best = { eventId: event?.id, score };
  }
  if (!best?.eventId) return { status: "fixture_not_found" };
  const url = `https://www.sofascore.com/api/v1/event/${encodeURIComponent(best.eventId)}/lineups`;
  const result = await fetchJson(url, { "User-Agent": "voetbalvoorspellingen-lineup-resolver/1.0" });
  return { ...result, status: result.ok ? "ok" : `http_${result.status}`, lineup: result.ok ? normalizeSofaScore(result.payload) : null, url };
}

async function fetchFotMobLineup(match) {
  if (String(process.env.FOTMOB_LINEUP_ENABLED || "true").toLowerCase() === "false") {
    return { status: "disabled" };
  }
  const date = String(match?.kickoff_at || "").slice(0, 10);
  if (!date) return { status: "invalid_date" };
  const compactDate = date.replace(/-/g, "");
  if (!fotmobScheduleCache.has(date)) {
    fotmobScheduleCache.set(date, fetchJson(`https://www.fotmob.com/api/data/matches?date=${compactDate}`, {
      "User-Agent": "Mozilla/5.0 (compatible; voetbalvoorspellingen-lineup-resolver/1.0)",
      Referer: "https://www.fotmob.com/",
    }));
  }
  const schedule = await fotmobScheduleCache.get(date);
  if (!schedule?.ok) return { status: `schedule_http_${schedule?.status || "unknown"}` };
  let best = null;
  for (const league of asArray(schedule.payload?.leagues)) {
    for (const event of asArray(league?.matches)) {
      const score = Math.min(
        teamSimilarity(match.home_team_name, event?.home?.name),
        teamSimilarity(match.away_team_name, event?.away?.name)
      );
      const eventKickoff = Date.parse(event?.status?.utcTime || "");
      const kickoffGapHours = Number.isFinite(eventKickoff)
        ? Math.abs(eventKickoff - Date.parse(match.kickoff_at)) / 3600000
        : Infinity;
      if (score < 0.82 || kickoffGapHours > 6 || (best && best.score >= score)) continue;
      best = { eventId: event?.id, score };
    }
  }
  if (!best?.eventId) return { status: "fixture_not_found" };
  const url = `https://www.fotmob.com/api/data/matchDetails?matchId=${encodeURIComponent(best.eventId)}`;
  const result = await fetchJson(url, {
    "User-Agent": "Mozilla/5.0 (compatible; voetbalvoorspellingen-lineup-resolver/1.0)",
    Referer: "https://www.fotmob.com/",
  });
  return { ...result, status: result.ok ? "ok" : `http_${result.status}`, lineup: result.ok ? normalizeFotMob(result.payload) : null, url };
}

async function resolveApiFootballFixture(match) {
  const key = getApiFootballKey();
  const date = String(match?.kickoff_at || "").slice(0, 10);
  if (!key || !date || providerHealth?.apiFootball?.valid === false) return null;
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
  if (!sportmonksEligibleFixtures([{ league: match?.league }], sportmonksCatalog).length) {
    return { status: "plan_coverage_unavailable" };
  }
  const fixtureInput = {
    matchId: match.match_id,
    canonicalFixtureId: match.canonical_fixture_id,
    kickoff: match.kickoff_at,
    homeTeam: match.home_team_name,
    awayTeam: match.away_team_name,
  };
  const resolved = await (sql ? resolveSportmonksFixtureId(sql, fixtureInput) : findSportmonksFixture(fixtureInput))
    .catch((error) => ({ status: "resolver_failed", error: error?.message || String(error) }));
  if (!resolved?.fixtureId) return { status: resolved?.status || "unmapped" };
  // One bounded fixture call supplies confirmed XI, formations and availability context.
  // Player fixture statistics only exist once a match has started, so they are retained when present
  // but are never fabricated as a pre-match feature.
  const url = `https://api.sportmonks.com/v3/football/fixtures/${encodeURIComponent(resolved.fixtureId)}?api_token=${encodeURIComponent(key)}&include=participants;formations;lineups.player;lineups.position;lineups.details;sidelined.player`;
  const result = await fetchJson(url);
  return { ...result, status: result.ok ? "ok" : `http_${result.status}`, lineup: result.ok ? normalizeSportmonks(result.payload) : null, url };
}

async function storeR2Lineup(match, provider, lineup) {
  const config = getR2Config();
  if (!config.configured || !lineup) return { ok: false, skipped: true, reason: "r2_not_configured" };
  const key = buildR2ObjectKey(config, `critical-captures/lineups/${match.match_id}.json`);
  const current = await getR2Object({ config, key })
    .then((object) => object?.ok ? JSON.parse(object.body.toString("utf8")) : null)
    .catch(() => null);
  const payload = mergeLineupCaptureLedger(current, { match, provider, lineup });
  return putR2Object({
    config,
    key,
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
  const minutesBeforeKickoff = minutesUntilKickoff(match.kickoff_at, capturedAt);
  const captureWindow = classifyLineupCaptureWindow(minutesBeforeKickoff);
  const contentHash = digest(JSON.stringify(lineup));
  const sourceRecordId = `lineup_${digest(`${match.match_id}|${provider}|${contentHash}`)}`;
  const matchSourceRecordId = `msr_${digest(`${match.match_id}|${sourceRecordId}`)}`;
  const payload = { matchId: match.match_id, kickoff: match.kickoff_at, capturedAt, minutesBeforeKickoff, captureWindow, provider, lineupSummary: lineup };
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
  if (CAPTURE_WINDOWS_ONLY) {
    matches = matches.filter((match) => classifyLineupCaptureWindow(minutesUntilKickoff(match.kickoff_at)) !== "outside");
  }
  const report = {
    generatedAt: new Date().toISOString(),
    checked: matches.length,
    confirmed: 0,
    partial: 0,
    missing: 0,
    r2Stored: 0,
    playerFixtureStatsCaptured: 0,
    databaseWritable,
    databaseError,
    captureWindows: { t75: 0, t45: 0, t20: 0, outside: 0 },
    providers: {},
    matches: [],
  };
  for (const match of matches) {
    const minutesBeforeKickoff = minutesUntilKickoff(match.kickoff_at);
    const captureWindow = classifyLineupCaptureWindow(minutesBeforeKickoff);
    report.captureWindows[captureWindow] = Number(report.captureWindows[captureWindow] || 0) + 1;
    const attempts = [];
    let result = { status: "not_attempted", lineup: null };
    let provider = "none";
    let apiFootballFixtureId;
    const fetchers = {
      sofascore: () => fetchSofaScoreLineup(match),
      fotmob: () => fetchFotMobLineup(match),
      "api-football": async () => {
        const apiFootballUnavailable = providerHealth?.apiFootball?.valid === false;
        apiFootballFixtureId = apiFootballUnavailable
          ? null
          : match.api_football_fixture_id ||
            findCachedApiFootballFixtureId(persistedApiFootballFixtureCache, match) ||
            await resolveApiFootballFixture(match);
        return apiFootballUnavailable
          ? { status: "account_or_plan_unavailable" }
          : fetchApiFootballLineup(apiFootballFixtureId);
      },
      sportmonks: () => fetchSportmonksLineup(databaseWritable ? sql : null, match),
    };
    const providerOrder = getCompetitionProviderOrder(match.league, "lineups", ["sofascore", "fotmob", "api-football", "sportmonks"]);
    for (const candidateProvider of providerOrder) {
      if (!fetchers[candidateProvider]) continue;
      provider = candidateProvider;
      result = await fetchers[candidateProvider]();
      attempts.push({
        provider,
        status: result.status,
        ...(provider === "api-football" ? { fixtureMapped: Boolean(apiFootballFixtureId) } : {}),
        lineup: Boolean(result.lineup),
        confirmed: Boolean(result.lineup?.confirmed),
      });
      if (result.lineup) break;
    }
    for (const attempt of attempts) {
      const key = `${attempt.provider}:${attempt.status}`;
      report.providers[key] = Number(report.providers[key] || 0) + 1;
    }
    if (result.lineup) {
      report.playerFixtureStatsCaptured += Number(result.lineup.playerFixtureStatsCaptured || 0);
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
    report.matches.push({
      matchId: match.match_id,
      league: match.league || null,
      agent: getCompetitionAgent(match.league)?.key || "default-agent",
      kickoff: match.kickoff_at,
      minutesBeforeKickoff,
      captureWindow,
      homeTeam: match.home_team_name,
      awayTeam: match.away_team_name,
      provider,
      status: result.status,
      attempts,
      confirmed: Boolean(result.lineup?.confirmed),
      partial: Boolean(result.lineup && !result.lineup.confirmed),
    });
  }
  report.leagueCoverage = summarizeLeagueCoverage(report.matches, {
    success: (row) => row.confirmed,
    partial: (row) => row.partial,
  });
  report.confirmedCoverage = report.checked ? Number((report.confirmed / report.checked).toFixed(3)) : 0;
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
