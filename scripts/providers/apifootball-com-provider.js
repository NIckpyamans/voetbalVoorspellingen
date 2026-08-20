import { getApiFootballComKey } from "../provider-env.js";

const BASE_URL = "https://apiv3.apifootball.com/";
const TIMEOUT_MS = 12_000;
const FREE_LEAGUES = new Set(["England - Championship", "France - Ligue 2"]);
let requestsThisRun = 0;

export function apiFootballComSupportsLeague(league) {
  return FREE_LEAGUES.has(String(league || "").trim());
}

export function normalizeApiFootballComName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|afc|cf|sc|club|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function similarity(left, right) {
  const a = normalizeApiFootballComName(left);
  const b = normalizeApiFootballComName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.94;
  const aa = new Set(a.split(" "));
  const bb = new Set(b.split(" "));
  return [...aa].filter((token) => bb.has(token)).length / Math.max(1, Math.min(aa.size, bb.size));
}

export async function apiFootballComRequest(action, params = {}, options = {}) {
  const apiKey = options.apiKey || getApiFootballComKey();
  if (!apiKey) return { status: "not_configured", payload: null, quota: null };
  const maximum = Math.max(1, Number(process.env.APIFOOTBALL_MAX_REQUESTS_PER_RUN || 20));
  if (requestsThisRun >= maximum) return { status: "local_quota_guard", payload: null, quota: null };
  const url = new URL(options.baseUrl || BASE_URL);
  url.searchParams.set("action", action);
  url.searchParams.set("APIkey", apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && String(value).trim()) url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || TIMEOUT_MS));
  const reportUrl = new URL(url);
  reportUrl.searchParams.set("APIkey", "[redacted]");
  requestsThisRun += 1;
  try {
    const response = await (options.fetchImpl || fetch)(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    const quota = {
      remaining: response.headers.get("x-ratelimit-remaining"),
      limit: response.headers.get("x-ratelimit-limit"),
      retryAfter: response.headers.get("retry-after"),
    };
    return { status: response.ok ? "ok" : `http_${response.status}`, statusCode: response.status, payload, quota, url: reportUrl.toString() };
  } catch (error) {
    return { status: "request_failed", payload: null, error: error?.name || error?.message || "request_failed", quota: null, url: reportUrl.toString() };
  } finally {
    clearTimeout(timeout);
  }
}

function eventRows(payload) {
  if (Array.isArray(payload)) return payload;
  return [];
}

export async function resolveApiFootballComFixture(match, options = {}) {
  if (!apiFootballComSupportsLeague(match?.league)) return { status: "unsupported_free_league", fixtureId: null };
  const date = String(match?.kickoff_at || match?.kickoff || "").slice(0, 10);
  if (!date) return { status: "invalid_date", fixtureId: null };
  const result = await apiFootballComRequest("get_events", { from: date, to: date, timezone: "Europe/Amsterdam" }, options);
  if (result.status !== "ok") return { ...result, fixtureId: null };
  let best = null;
  for (const row of eventRows(result.payload)) {
    const score = Math.min(
      similarity(match.home_team_name || match.homeTeamName, row.match_hometeam_name),
      similarity(match.away_team_name || match.awayTeamName, row.match_awayteam_name)
    );
    if (score >= 0.82 && (!best || score > best.score)) best = { fixtureId: String(row.match_id), score, row };
  }
  return best ? { ...result, status: "mapped", ...best } : { ...result, status: "fixture_not_found", fixtureId: null };
}

function lineupPlayers(rows, source) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row.player_key ? `apifootball:${row.player_key}` : null,
    name: String(row.lineup_player || "").trim(),
    position: String(row.lineup_position || "").trim(),
    shirtNumber: row.lineup_number || null,
    rating: null,
    source,
  })).filter((row) => row.name);
}

function lineupSide(side) {
  const players = lineupPlayers(side?.starting_lineups, "APIfootball.com confirmed lineups").slice(0, 11);
  return {
    formation: null,
    starters: players.length,
    bench: Array.isArray(side?.substitutes) ? side.substitutes.length : 0,
    players,
    avgRating: null,
    keeperName: players.find((player) => player.position === "1")?.name || null,
    keeperRating: null,
    confirmed: players.length >= 10,
    projected: false,
  };
}

export function normalizeApiFootballComLineup(payload, fixtureId) {
  const root = payload?.[fixtureId] || Object.values(payload || {})[0];
  const lineup = root?.lineup;
  if (!lineup) return null;
  const home = lineupSide(lineup.home);
  const away = lineupSide(lineup.away);
  if (!home.starters && !away.starters) return null;
  return {
    home,
    away,
    confirmed: home.confirmed && away.confirmed,
    projected: false,
    source: "APIfootball.com confirmed lineups",
    summary: "Bevestigde opstellingen uit de gratis competitiefeed.",
  };
}

export async function fetchApiFootballComLineup(match, options = {}) {
  const fixture = await resolveApiFootballComFixture(match, options);
  if (!fixture.fixtureId) return { status: fixture.status, lineup: null, url: fixture.url };
  const result = await apiFootballComRequest("get_lineups", { match_id: fixture.fixtureId }, options);
  return {
    ...result,
    status: result.status === "ok" ? "ok" : result.status,
    fixtureId: fixture.fixtureId,
    lineup: result.status === "ok" ? normalizeApiFootballComLineup(result.payload, fixture.fixtureId) : null,
  };
}

function normalizeH2HRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const homeGoals = Number(row.match_hometeam_score);
    const awayGoals = Number(row.match_awayteam_score);
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
    return {
      id: `apifootball:${row.match_id}`,
      date: row.match_date || null,
      home: row.match_hometeam_name || "",
      away: row.match_awayteam_name || "",
      score: `${homeGoals}-${awayGoals}`,
      homeGoals,
      awayGoals,
      homeScore: homeGoals,
      awayScore: awayGoals,
      source: "APIfootball.com",
    };
  }).filter(Boolean).sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

export async function fetchApiFootballComH2HProfile({ homeName, awayName, leagueLabel }, options = {}) {
  if (!apiFootballComSupportsLeague(leagueLabel)) return null;
  const result = await apiFootballComRequest("get_H2H", { firstTeam: homeName, secondTeam: awayName }, options);
  if (result.status !== "ok") return null;
  const root = Array.isArray(result.payload) ? result.payload[0] : result.payload;
  const rows = normalizeH2HRows(root?.firstTeam_VS_secondTeam).slice(0, 5);
  if (!rows.length) return null;
  return {
    source: "apifootball-com-h2h",
    asOf: new Date().toISOString(),
    played: rows.length,
    results: rows,
    providerStatus: "ok",
  };
}

export function resetApiFootballComBudgetForTests() {
  requestsThisRun = 0;
}
