import fs from "fs";
import path from "path";
import { getGoalApiKey } from "../provider-env.js";
import { normalizeGoalApiName } from "./goal-api-acceptance-utils.js";

const BASE_URL = "https://api.goal-api.com/v1";
const ACCEPTANCE_FILE = path.join(process.cwd(), "monitor", "goal-api-acceptance.json");
const dateCache = new Map();
let requestsThisRun = 0;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function rows(value) { return Array.isArray(value) ? value : []; }

function similarity(left, right) {
  const a = normalizeGoalApiName(left);
  const b = normalizeGoalApiName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.94;
  const aa = new Set(a.split(" "));
  const bb = new Set(b.split(" "));
  return [...aa].filter((token) => bb.has(token)).length / Math.max(1, Math.min(aa.size, bb.size));
}

export function goalApiFeatureEnabled(feature, options = {}) {
  if (feature === "odds") return false;
  const report = options.acceptance || readJson(options.acceptanceFile || ACCEPTANCE_FILE, {});
  const endpoint = report?.history?.at?.(-1)?.endpointAccess?.[feature] || report?.endpointAccess?.[feature];
  return Boolean(report?.accepted && endpoint?.valid && endpoint?.available);
}

export async function goalApiRequest(pathname, options = {}) {
  const apiKey = options.apiKey || getGoalApiKey();
  if (!apiKey) return { status: "not_configured", payload: null };
  const maximum = Math.max(1, Number(process.env.GOAL_API_MAX_ENRICHMENT_REQUESTS_PER_RUN || 30));
  if (requestsThisRun >= maximum) return { status: "local_quota_guard", payload: null };
  requestsThisRun += 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 12_000));
  try {
    const response = await (options.fetchImpl || fetch)(`${options.baseUrl || BASE_URL}${pathname}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    return {
      status: response.ok ? "ok" : `http_${response.status}`,
      statusCode: response.status,
      payload,
      quota: {
        limit: response.headers.get("x-ratelimit-limit"),
        remaining: response.headers.get("x-ratelimit-remaining"),
        reset: response.headers.get("x-ratelimit-reset"),
      },
    };
  } catch (error) {
    return { status: "request_failed", payload: null, error: error?.name || error?.message || "request_failed" };
  } finally { clearTimeout(timeout); }
}

function fixtureTeams(fixture) {
  return {
    id: fixture?.id || fixture?.fixture?.id || fixture?.matchId || fixture?.match_id || null,
    homeId: fixture?.homeTeam?.id || fixture?.home_team?.id || fixture?.teams?.home?.id || fixture?.homeTeamId || null,
    awayId: fixture?.awayTeam?.id || fixture?.away_team?.id || fixture?.teams?.away?.id || fixture?.awayTeamId || null,
    home: fixture?.homeTeam?.name || fixture?.home_team?.name || fixture?.teams?.home?.name || fixture?.homeTeamName,
    away: fixture?.awayTeam?.name || fixture?.away_team?.name || fixture?.teams?.away?.name || fixture?.awayTeamName,
  };
}

async function fixturesForDate(date, options) {
  const cacheKey = `${date}|${options?.apiKey ? "test" : "env"}`;
  if (!dateCache.has(cacheKey)) {
    dateCache.set(cacheKey, (async () => {
      const fixtures = [];
      let result = null;
      const maximumPages = Math.max(1, Math.min(10, Number(process.env.GOAL_API_MAX_ENRICHMENT_PAGES_PER_DATE || 10)));
      for (let page = 0; page < maximumPages; page += 1) {
        result = await goalApiRequest(`/fixtures/date/${encodeURIComponent(date)}?limit=100&offset=${page * 100}`, options);
        if (result.status !== "ok") break;
        const data = result.payload?.data;
        fixtures.push(...rows(data?.fixtures || data));
        if (!result.payload?.pagination?.hasMore) break;
      }
      return { result, fixtures };
    })());
  }
  return dateCache.get(cacheKey);
}

export async function resolveGoalApiFixture(match, options = {}) {
  const date = String(match?.kickoff_at || match?.kickoff || "").slice(0, 10);
  if (!date) return { status: "invalid_date", fixtureId: null };
  const { result, fixtures } = await fixturesForDate(date, options);
  if (result.status !== "ok") return { ...result, fixtureId: null };
  let best = null;
  for (const fixture of fixtures) {
    const team = fixtureTeams(fixture);
    const score = Math.min(
      similarity(match.home_team_name || match.homeTeamName || match.homeTeam, team.home),
      similarity(match.away_team_name || match.awayTeamName || match.awayTeam, team.away)
    );
    if (score >= 0.82 && (!best || score > best.score)) best = { fixtureId: String(team.id), score, fixture, ...team };
  }
  return best ? { status: "mapped", ...best } : { status: "fixture_not_found", fixtureId: null };
}

function lineupPlayers(value) {
  return rows(value).map((player) => ({
    id: player?.id || player?.player?.id || null,
    name: String(player?.name || player?.player?.name || player?.playerName || "").trim(),
    position: player?.position?.name || player?.position || player?.pos || null,
    shirtNumber: player?.number || player?.shirtNumber || null,
    rating: Number(player?.rating) || null,
    source: "GOAL API confirmed lineups",
  })).filter((player) => player.name);
}

function lineupSide(value) {
  const players = lineupPlayers(value?.startingXI || value?.starters || value?.players || value?.lineup || value);
  return {
    formation: value?.formation || null,
    starters: players.length,
    bench: rows(value?.substitutes || value?.bench).length,
    players,
    avgRating: null,
    keeperName: players.find((player) => /goalkeeper|keeper|gk/i.test(String(player.position)))?.name || null,
    keeperRating: null,
    confirmed: players.length >= 10,
    projected: false,
  };
}

export function normalizeGoalApiLineup(payload) {
  const root = payload?.data || payload;
  const home = lineupSide(root?.home || root?.homeTeam || root?.lineups?.home);
  const away = lineupSide(root?.away || root?.awayTeam || root?.lineups?.away);
  if (!home.starters && !away.starters) return null;
  return { home, away, confirmed: home.confirmed && away.confirmed, projected: false, source: "GOAL API confirmed lineups", summary: "Opstellingen uit GOAL API na de veertiendaagse provideracceptatie." };
}

export async function fetchGoalApiLineup(match, options = {}) {
  if (!goalApiFeatureEnabled("lineups", options)) return { status: "acceptance_gate_closed", lineup: null };
  const fixture = await resolveGoalApiFixture(match, options);
  if (!fixture.fixtureId) return { status: fixture.status, lineup: null };
  const result = await goalApiRequest(`/fixtures/${encodeURIComponent(fixture.fixtureId)}/lineups`, options);
  const lineup = result.status === "ok" ? normalizeGoalApiLineup(result.payload) : null;
  return { ...result, status: lineup ? "ok" : result.status === "ok" ? "not_found" : result.status, lineup, fixtureId: fixture.fixtureId };
}

function resultRows(payload) {
  const root = payload?.data || payload;
  return rows(root?.direct || root?.matches || root?.fixtures || root?.results || root);
}

export function normalizeGoalApiH2H(payload) {
  return resultRows(payload).map((row) => {
    const teams = fixtureTeams(row);
    const homeScore = Number(row?.homeScore ?? row?.home_score ?? row?.score?.home ?? row?.goals?.home);
    const awayScore = Number(row?.awayScore ?? row?.away_score ?? row?.score?.away ?? row?.goals?.away);
    if (!teams.home || !teams.away || !Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
    return { id: `goal-api:${teams.id || `${teams.home}-${teams.away}`}`, date: row?.date || row?.kickoff || row?.fixture?.date || null, home: teams.home, away: teams.away, homeScore, awayScore, score: `${homeScore}-${awayScore}`, source: "GOAL API" };
  }).filter(Boolean).sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

export async function fetchGoalApiH2HProfile(match, options = {}) {
  if (!goalApiFeatureEnabled("h2h", options)) return null;
  const fixture = await resolveGoalApiFixture(match, options);
  if (!fixture.homeId || !fixture.awayId) return null;
  const result = await goalApiRequest(`/h2h/${encodeURIComponent(fixture.homeId)}/${encodeURIComponent(fixture.awayId)}/direct`, options);
  if (result.status !== "ok") return null;
  const history = normalizeGoalApiH2H(result.payload).slice(0, 5);
  return history.length ? { source: "goal-api-h2h", asOf: new Date().toISOString(), played: history.length, results: history } : null;
}

export async function fetchGoalApiFixtureStatistics(match, options = {}) {
  if (!goalApiFeatureEnabled("statistics", options)) return { status: "acceptance_gate_closed", statistics: null };
  const fixture = await resolveGoalApiFixture(match, options);
  if (!fixture.fixtureId) return { status: fixture.status, statistics: null };
  const result = await goalApiRequest(`/fixtures/${encodeURIComponent(fixture.fixtureId)}/statistics`, options);
  return { ...result, fixtureId: fixture.fixtureId, statistics: result.status === "ok" ? result.payload?.data || result.payload : null };
}

export function resetGoalApiBudgetForTests() { requestsThisRun = 0; dateCache.clear(); }
