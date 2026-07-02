#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { CLUB_ONLY_FIXTURE_WHERE } from "./club-fixture-filter.js";
import { getApiFootballKey } from "./provider-env.js";

const root = process.cwd();
loadLocalEnv(root);
const sql = getSql();
const apiKey = getApiFootballKey();
if (!sql) {
  console.error("DATABASE_URL of POSTGRES_URL ontbreekt.");
  process.exit(2);
}
if (!apiKey) {
  console.error("API_KEY_API_FOOTBALL ontbreekt.");
  process.exit(2);
}

const baseUrl = String(process.env.API_FOOTBALL_BASE_URL || process.env.APISPORTS_BASE_URL || "https://v3.football.api-sports.io").trim();
const limit = Math.max(1, Number(process.env.API_FOOTBALL_COVERAGE_LIMIT || 40));
const daysAhead = Math.max(1, Number(process.env.API_FOOTBALL_COVERAGE_DAYS_AHEAD || 21));
const maxDates = Math.max(1, Number(process.env.API_FOOTBALL_COVERAGE_MAX_DATES || 14));
const maxOddsRequests = Math.max(0, Number(process.env.API_FOOTBALL_ODDS_PROBE_LIMIT || 20));
const timeoutMs = Math.max(1000, Number(process.env.API_FOOTBALL_COVERAGE_TIMEOUT_MS || 12000));
const reportPath = path.join(root, "monitor", "api-football-coverage-scout.json");
const startedAt = Date.now();
const quotaSamples = [];

function digest(value, size = 24) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, size);
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, " ")
    .replace(/\b(football club|futbol club|club de futbol|fc|afc|cf|sc|ssc|ac|as|calcio|club|de|la|the)\b/g, " ")
    .replace(/\butd\b/g, "united")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function similarity(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 5 && b.includes(a)) return 0.94;
  if (b.length >= 5 && a.includes(b)) return 0.94;
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size || 1;
  const containment = intersection / Math.min(aTokens.size || 1, bTokens.size || 1);
  return Math.max(intersection / union, containment >= 0.8 ? 0.9 : containment * 0.88);
}

function dateKey(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value || "").slice(0, 10);
}

async function apiGet(pathname, params = {}) {
  const url = new URL(pathname, baseUrl);
  return apiGetUrl(url, params);
}

async function apiGetUrl(url, params = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim()) url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: "application/json", "x-apisports-key": apiKey };
    if (/rapidapi/i.test(url.hostname)) {
      headers["x-rapidapi-key"] = apiKey;
      headers["x-rapidapi-host"] = url.hostname;
    }
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    const quota = {
      requestsLimit: response.headers.get("x-ratelimit-requests-limit"),
      requestsRemaining: response.headers.get("x-ratelimit-requests-remaining"),
      rateLimit: response.headers.get("x-ratelimit-limit"),
      rateRemaining: response.headers.get("x-ratelimit-remaining"),
    };
    if (quotaSamples.length < 5 && Object.values(quota).some(Boolean)) quotaSamples.push(quota);
    const result = {
      ok: response.ok && !Object.keys(payload?.errors || {}).length,
      status: response.status,
      payload,
      quota,
      message: payload?.message || payload?.error || payload?.errors || text?.slice(0, 500) || null,
      url: url.toString().replace(apiKey, "***"),
    };
    if (result.status === 403 && /rapidapi/i.test(url.hostname)) {
      const directUrl = new URL(url.pathname, "https://v3.football.api-sports.io");
      for (const [key, value] of url.searchParams.entries()) directUrl.searchParams.set(key, value);
      const direct = await apiGetUrl(directUrl, {});
      return { ...direct, fallbackFrom: result };
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function fixtureTeams(row) {
  return {
    id: row?.fixture?.id,
    date: row?.fixture?.date || null,
    home: row?.teams?.home?.name || "",
    away: row?.teams?.away?.name || "",
    league: row?.league?.name || "",
    raw: row,
  };
}

function findBestFixture(match, fixtures) {
  let best = null;
  for (const fixture of fixtures.map(fixtureTeams).filter((item) => item.id && item.home && item.away)) {
    const homeScore = similarity(match.home_team_name, fixture.home);
    const awayScore = similarity(match.away_team_name, fixture.away);
    const reversedHomeScore = similarity(match.home_team_name, fixture.away);
    const reversedAwayScore = similarity(match.away_team_name, fixture.home);
    const direct = Math.min(homeScore, awayScore);
    const reversed = Math.min(reversedHomeScore, reversedAwayScore);
    const score = Math.max(direct, reversed);
    if (score < 0.82) continue;
    if (!best || score > best.confidence) best = { ...fixture, confidence: score, reversed: reversed > direct };
  }
  return best;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 1 ? number : null;
}

function parseApiFootballOdds(payload) {
  for (const item of payload?.response || []) {
    for (const bookmaker of item?.bookmakers || []) {
      for (const bet of bookmaker?.bets || []) {
        const betName = normalize(bet?.name);
        const betId = Number(bet?.id || 0);
        if (betId !== 1 && !/match winner|1x2|fulltime result/.test(betName)) continue;
        const values = Array.isArray(bet?.values) ? bet.values : [];
        const home = values.find((row) => ["home", "1"].includes(normalize(row?.value)));
        const draw = values.find((row) => ["draw", "x"].includes(normalize(row?.value)));
        const away = values.find((row) => ["away", "2"].includes(normalize(row?.value)));
        const snapshot = {
          bookmaker: bookmaker?.name || "api-football",
          market: bet?.name || "Match Winner",
          home: numberOrNull(home?.odd),
          draw: numberOrNull(draw?.odd),
          away: numberOrNull(away?.odd),
        };
        if ([snapshot.home, snapshot.draw, snapshot.away].every(Boolean)) return snapshot;
      }
    }
  }
  return null;
}

const matches = await sql.query(
  `select m.match_id, m.canonical_fixture_id, m.league, m.home_team_name, m.away_team_name, m.kickoff_at, m.date_key,
    fsa.source_match_id as api_football_fixture_id
   from matches m
   left join fixture_source_aliases fsa on fsa.canonical_match_id=m.match_id and fsa.provider='api-football'
   where m.kickoff_at > now()
     and m.kickoff_at <= now() + ($1::text || ' days')::interval
     and m.home_team_name is not null
     and m.away_team_name is not null
     ${CLUB_ONLY_FIXTURE_WHERE}
   order by m.kickoff_at asc
   limit $2`,
  [String(daysAhead), limit]
);

const byDate = new Map();
for (const match of matches) {
  const key = dateKey(match.kickoff_at || match.date_key);
  if (!key) continue;
  if (!byDate.has(key)) byDate.set(key, []);
  byDate.get(key).push(match);
}

let fetchedDates = 0;
let fetchedFixtures = 0;
let mappedFixtures = 0;
let oddsRequests = 0;
let oddsCaptured = 0;
const statusCounts = {};
const errors = [];
const examples = [];
let quotaBlocked = false;

for (const [key, dateMatches] of [...byDate.entries()].slice(0, maxDates)) {
  const fixtureFeed = await apiGet("/fixtures", { date: key });
  fetchedDates += 1;
  statusCounts[`fixtures_${fixtureFeed.status}`] = (statusCounts[`fixtures_${fixtureFeed.status}`] || 0) + 1;
  if (!fixtureFeed.ok) {
    errors.push({
      endpoint: "fixtures",
      date: key,
      status: fixtureFeed.status,
      message: fixtureFeed.message || null,
      errors: fixtureFeed.payload?.errors || null,
      fallbackFrom: fixtureFeed.fallbackFrom
        ? { status: fixtureFeed.fallbackFrom.status, message: fixtureFeed.fallbackFrom.message || null }
        : null,
    });
    if (fixtureFeed.status === 429) {
      quotaBlocked = true;
      break;
    }
    continue;
  }
  const fixtures = Array.isArray(fixtureFeed.payload?.response) ? fixtureFeed.payload.response : [];
  fetchedFixtures += fixtures.length;
  for (const match of dateMatches) {
    const best = match.api_football_fixture_id
      ? { id: match.api_football_fixture_id, confidence: 1, home: null, away: null, raw: null, stored: true }
      : findBestFixture(match, fixtures);
    if (!best?.id) continue;
    const sourceRecordId = `api_football_fixture_${digest(`${match.match_id}|${best.id}`)}`;
    const matchSourceRecordId = `msr_${digest(`${match.match_id}|${sourceRecordId}`)}`;
    const aliasId = `fixture_alias_${digest(`api-football|${best.id}`)}`;
    const payload = {
      source: "API-Football",
      sourceMatchId: String(best.id),
      matchId: match.match_id,
      homeTeam: best.home,
      awayTeam: best.away,
      confidence: best.confidence,
      raw: best.raw,
    };
    await sql.query(
      `insert into source_records (
         source_record_id, provider, source_url, entity_type, entity_key, fetched_at, content_hash, trust_score, payload
       )
       values ($1,'api-football',$2,'fixture',$3,now(),$4,0.8,$5::jsonb)
       on conflict (source_record_id) do update set
         fetched_at=excluded.fetched_at,
         content_hash=excluded.content_hash,
         trust_score=greatest(coalesce(source_records.trust_score,0), excluded.trust_score),
         payload=excluded.payload`,
      [sourceRecordId, "https://v3.football.api-sports.io/fixtures", match.match_id, digest(JSON.stringify(payload), 40), JSON.stringify(payload)]
    );
    await sql.query(
      `insert into match_source_records (match_source_record_id, match_id, source_record_id, provider, source_match_id, is_primary, trust_score)
       values ($1,$2,$3,'api-football',$4,false,0.8)
       on conflict (match_source_record_id) do update set
         source_match_id=excluded.source_match_id,
         trust_score=greatest(coalesce(match_source_records.trust_score,0), excluded.trust_score),
         updated_at=now()`,
      [matchSourceRecordId, match.match_id, sourceRecordId, String(best.id)]
    );
    await sql.query(
      `insert into fixture_source_aliases (fixture_source_alias_id, canonical_fixture_id, canonical_match_id, source_match_id, provider, source_payload)
       values ($1,$2,$3,$4,'api-football',$5::jsonb)
       on conflict (provider, source_match_id) do update set
         canonical_fixture_id=excluded.canonical_fixture_id,
         canonical_match_id=excluded.canonical_match_id,
         source_payload=excluded.source_payload,
         updated_at=now()`,
      [aliasId, String(match.canonical_fixture_id || match.match_id), match.match_id, String(best.id), JSON.stringify(payload)]
    );
    if (!best.stored) mappedFixtures += 1;

    if (oddsRequests < maxOddsRequests) {
      const oddsFeed = await apiGet("/odds", { fixture: best.id });
      oddsRequests += 1;
      statusCounts[`odds_${oddsFeed.status}`] = (statusCounts[`odds_${oddsFeed.status}`] || 0) + 1;
      if (!oddsFeed.ok) {
        errors.push({
          endpoint: "odds",
          fixtureId: best.id,
          status: oddsFeed.status,
          message: oddsFeed.message || null,
          errors: oddsFeed.payload?.errors || null,
        });
        if (oddsFeed.status === 429) quotaBlocked = true;
      } else {
        const odds = parseApiFootballOdds(oddsFeed.payload);
        if (odds && Date.now() < Date.parse(match.kickoff_at)) {
          const capturedAt = new Date().toISOString();
          await sql.query(
            `insert into historical_odds_snapshots (
               historical_odds_snapshot_id,match_id,provider,bookmaker,market,home,draw,away,captured_at,
               odds_role,available_before_kickoff,source_record_id
             )
             values ($1,$2,'api-football',$3,$4,$5,$6,$7,$8,'prematch',true,null)
             on conflict (historical_odds_snapshot_id) do update set
               home=excluded.home, draw=excluded.draw, away=excluded.away, captured_at=excluded.captured_at`,
            [
              `prematch_${digest(`${match.match_id}|api-football|${odds.bookmaker}|${capturedAt.slice(0, 13)}`)}`,
              match.match_id,
              odds.bookmaker,
              odds.market,
              odds.home,
              odds.draw,
              odds.away,
              capturedAt,
            ]
          );
          oddsCaptured += 1;
        }
      }
    }

    if (examples.length < 20) {
      examples.push({
        date: key,
        home: match.home_team_name,
        away: match.away_team_name,
        fixtureId: String(best.id),
        confidence: Number(best.confidence || 0),
      });
    }
  }
}

const report = {
  ok: true,
  generatedAt: new Date().toISOString(),
  provider: "api-football",
  baseHost: new URL(baseUrl).hostname,
  quotaBlocked,
  checked: matches.length,
  fetchedDates,
  fetchedFixtures,
  mappedFixtures,
  oddsRequests,
  oddsCaptured,
  statusCounts,
  quotaSamples,
  examples,
  errors: errors.slice(0, 20),
  durationMs: Date.now() - startedAt,
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
