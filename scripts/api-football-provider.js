import { getApiFootballKey } from "./provider-env.js";

const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_FETCHES_PER_RUN = 20;
const TEAM_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const H2H_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

let fetchesThisRun = 0;

const TEAM_SEARCH_ALIASES = new Map(
  Object.entries({
    "ararat armenia": ["FC Ararat-Armenia", "Ararat Armenia", "Ararat-Armenia"],
    riga: ["Riga FC", "Riga Football Club", "Riga"],
    "kauno zalgiris": ["Kauno Zalgiris", "Kauno Žalgiris", "FK Kauno Zalgiris", "FK Kauno Žalgiris"],
    drita: ["FC Drita", "Drita", "Drita Gjilan"],
    "una strassen": ["UNA Strassen", "FC UNA Strassen", "Strassen"],
    "la fiorita": ["SP La Fiorita", "La Fiorita", "Societa Polisportiva La Fiorita"],
    "af elbasani": ["AF Elbasani", "Elbasani", "KF Elbasani"],
    bate: ["BATE Borisov", "BATE", "FC BATE Borisov"],
    kairat: ["Kairat Almaty", "FC Kairat", "Kairat"],
    sutjeska: ["Sutjeska Niksic", "FK Sutjeska", "FK Sutjeska Nikšić"],
    flora: ["Flora Tallinn", "FC Flora", "Flora"],
    "iberia 1999": ["Iberia 1999", "Saburtalo", "FC Iberia 1999", "FC Saburtalo"],
    zira: ["Zira FK", "Zira", "Zirə FK"],
    "torpedo kutaisi": ["Torpedo Kutaisi", "FC Torpedo Kutaisi", "Torpedo Kutaissi"],
    "connah s quay nomads": ["Connah's Quay Nomads", "Connah S Quay Nomads", "The New Saints Connahs Quay", "Nomads"],
    ballkani: ["Ballkani", "FC Ballkani", "KF Ballkani"],
  }).map(([key, aliases]) => [key, aliases])
);

function apiFootballBaseUrl() {
  return String(process.env.API_FOOTBALL_BASE_URL || process.env.APISPORTS_BASE_URL || API_FOOTBALL_BASE).trim();
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isoDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function leagueCountry(leagueLabel = "") {
  const text = String(leagueLabel || "");
  const country = text.includes(" - ") ? text.split(" - ")[0].trim() : "";
  if (["world", "europe", "africa", "asia", "north america", "south america", "international"].includes(normalizeName(country))) {
    return "";
  }
  return country || "";
}

function recordDiagnostic(store, status, details = {}) {
  if (!store.apiFootballDiagnostics) {
    store.apiFootballDiagnostics = { requests: 0, statusCounts: {} };
  }
  const diagnostics = store.apiFootballDiagnostics;
  diagnostics.requests += 1;
  diagnostics.statusCounts[status] = Number(diagnostics.statusCounts[status] || 0) + 1;
  diagnostics.lastStatus = status;
  diagnostics.lastCheckedAt = new Date().toISOString();
  if (details.statusCode) diagnostics.lastStatusCode = details.statusCode;
  if (details.endpoint) diagnostics.lastEndpoint = details.endpoint;
  if (details.errorCategory) {
    diagnostics.lastErrorCategory = details.errorCategory;
    diagnostics.errorCategories = diagnostics.errorCategories || {};
    diagnostics.errorCategories[details.errorCategory] = Number(diagnostics.errorCategories[details.errorCategory] || 0) + 1;
  }
}

function classifyProviderError(response = {}) {
  const text = JSON.stringify(response.errors || response.data?.errors || response.data || "").toLowerCase();
  if (/quota|limit|rate|request|too many/.test(text)) return "quota_or_rate_limit";
  if (/token|key|auth|unauthorized|forbidden|subscription|plan|rapidapi|endpoint is disabled/.test(text)) return "auth_or_plan";
  if (/endpoint|not found|not_found|coverage/.test(text)) return "endpoint_or_coverage";
  if (response.statusCode) return `http_${response.statusCode}`;
  return "provider_payload_error";
}

function searchVariantsForTeam(teamName) {
  const normalized = normalizeName(teamName);
  const aliases = TEAM_SEARCH_ALIASES.get(normalized) || [];
  return [...new Set([teamName, ...aliases].map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 4);
}

function isFresh(entry, ttlMs, now = Date.now()) {
  const updated = Date.parse(entry?.updatedAt || entry?.updated || "");
  return Number.isFinite(updated) && now - updated <= ttlMs;
}

function maxFetchesPerRun() {
  const configured = Number(process.env.API_FOOTBALL_MAX_FETCHES_PER_RUN || "");
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_FETCHES_PER_RUN;
}

async function apiFootballGet(path, params = {}, options = {}) {
  const apiKey = getApiFootballKey();
  if (!apiKey) return { status: "not_configured", data: null };
  if (fetchesThisRun >= maxFetchesPerRun()) {
    return { status: "rate_limited_locally", data: null };
  }

  const url = new URL(path, options.baseUrl || apiFootballBaseUrl());
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && String(value).trim()) url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  fetchesThisRun += 1;
  try {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== "function") return { status: "fetch_unavailable", data: null };
    const headers = { Accept: "application/json", "x-apisports-key": apiKey };
    if (/rapidapi/i.test(url.hostname)) {
      headers["x-rapidapi-key"] = apiKey;
      headers["x-rapidapi-host"] = url.hostname;
    }
    const response = await fetchImpl(url, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      return {
        status: "provider_error",
        statusCode: response.status,
        errorCategory: classifyProviderError({ statusCode: response.status, data: payload }),
        data: payload,
      };
    }
    const payload = await response.json();
    if (Array.isArray(payload?.errors) && payload.errors.length) {
      return { status: "provider_error", errorCategory: classifyProviderError({ errors: payload.errors, data: payload }), errors: payload.errors, data: payload };
    }
    if (payload?.errors && typeof payload.errors === "object" && Object.keys(payload.errors).length) {
      return { status: "provider_error", errorCategory: classifyProviderError({ errors: payload.errors, data: payload }), errors: payload.errors, data: payload };
    }
    return { status: "ok", data: payload };
  } catch (error) {
    return { status: "provider_exception", error: error?.message || String(error), data: null };
  } finally {
    clearTimeout(timeout);
  }
}

function pickTeamSearchHit(payload, teamName, country) {
  const wanted = normalizeName(teamName);
  const wantedCountry = normalizeName(country);
  const rows = Array.isArray(payload?.response) ? payload.response : [];
  if (!wanted || !rows.length) return null;

  const exact = rows.find((row) => {
    const name = normalizeName(row?.team?.name);
    const code = normalizeName(row?.team?.code);
    const rowCountry = normalizeName(row?.team?.country);
    const nameMatches = name === wanted || code === wanted;
    const countryMatches = !wantedCountry || !rowCountry || rowCountry === wantedCountry;
    return nameMatches && countryMatches;
  });
  if (exact?.team?.id) return exact.team;

  const contained = rows.find((row) => {
    const name = normalizeName(row?.team?.name);
    const rowCountry = normalizeName(row?.team?.country);
    const nameMatches = name && (name.includes(wanted) || wanted.includes(name));
    const countryMatches = !wantedCountry || !rowCountry || rowCountry === wantedCountry;
    return nameMatches && countryMatches;
  });
  return contained?.team?.id ? contained.team : null;
}

async function resolveTeamId(store, teamName, leagueLabel, options = {}) {
  const country = leagueCountry(leagueLabel);
  const key = `${normalizeName(country)}:${normalizeName(teamName)}`;
  if (!store.apiFootballTeamMap) store.apiFootballTeamMap = {};
  const cached = store.apiFootballTeamMap[key];
  const retryableCacheStatuses = new Set(["provider_error", "provider_exception", "fetch_unavailable"]);
  if (cached && isFresh(cached, TEAM_CACHE_TTL_MS) && !retryableCacheStatuses.has(cached.status)) {
    return cached.teamId || null;
  }

  let team = null;
  let lastResponse = null;
  let searchedAs = [];
  for (const search of searchVariantsForTeam(teamName)) {
    searchedAs.push(search);
    const response = await apiFootballGet("/teams", { search }, options);
    lastResponse = response;
    recordDiagnostic(store, response.status, {
      statusCode: response.statusCode,
      endpoint: "teams",
      errorCategory: response.status === "ok" ? "" : response.errorCategory || classifyProviderError(response),
    });
    if (response.status !== "ok") break;
    team = pickTeamSearchHit(response.data, search, country) || pickTeamSearchHit(response.data, teamName, country);
    if (team?.id) break;
  }
  if (!team?.id && lastResponse?.status !== "ok") {
    store.apiFootballTeamMap[key] = {
      teamId: null,
      updatedAt: new Date().toISOString(),
      status: lastResponse?.status || "provider_error",
      statusCode: lastResponse?.statusCode || null,
      searchedAs,
      errorCategory: lastResponse?.errorCategory || classifyProviderError(lastResponse),
    };
    return null;
  }
  store.apiFootballTeamMap[key] = {
    teamId: team?.id || null,
    name: team?.name || null,
    country: team?.country || null,
    updatedAt: new Date().toISOString(),
    status: team?.id ? "resolved" : "not_found",
    searchedAs,
  };
  return team?.id || null;
}

function normalizeFixtureH2H(fixtures, homeName, awayName, homeId, awayId) {
  const currentHome = normalizeName(homeName);
  const currentAway = normalizeName(awayName);
  const results = [];

  for (const row of fixtures || []) {
    const fixture = row?.fixture || {};
    const teams = row?.teams || {};
    const goals = row?.goals || {};
    const status = String(fixture?.status?.short || fixture?.status?.long || "").toUpperCase();
    const homeGoals = Number(goals.home);
    const awayGoals = Number(goals.away);
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
    if (["NS", "TBD", "PST", "CANC", "ABD"].includes(status)) continue;

    const fixtureHome = normalizeName(teams?.home?.name);
    const fixtureAway = normalizeName(teams?.away?.name);
    const sameOrientation = fixtureHome === currentHome && fixtureAway === currentAway;
    const reversed = fixtureHome === currentAway && fixtureAway === currentHome;
    if (!sameOrientation && !reversed) continue;

    const currentHomeGoals = sameOrientation ? homeGoals : awayGoals;
    const currentAwayGoals = sameOrientation ? awayGoals : homeGoals;
    results.push({
      date: isoDate(fixture.date),
      home: homeName,
      away: awayName,
      score: `${currentHomeGoals}-${currentAwayGoals}`,
      homeScore: currentHomeGoals,
      awayScore: currentAwayGoals,
      winnerId: currentHomeGoals > currentAwayGoals ? String(homeId || currentHome) : currentAwayGoals > currentHomeGoals ? String(awayId || currentAway) : "",
      source: "api-football-h2h",
      sourceTimestamp: fixture.date || new Date().toISOString(),
      providerFixtureId: fixture.id || null,
    });
  }

  return results
    .filter((item) => item.date && item.score)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-8);
}

export async function fetchApiFootballH2HProfile({ store, homeName, awayName, homeId, awayId, leagueLabel }, options = {}) {
  if (String(process.env.API_FOOTBALL_H2H_ENABLED || "true").toLowerCase() === "false") return null;
  if (!getApiFootballKey()) return null;
  if (!store || !homeName || !awayName) return null;
  if (!store.apiFootballH2HCache) store.apiFootballH2HCache = {};

  const pairKey = `${normalizeName(leagueLabel)}:${normalizeName(homeName)}__${normalizeName(awayName)}`;
  const cached = store.apiFootballH2HCache[pairKey];
  if (cached?.data && isFresh(cached, H2H_CACHE_TTL_MS)) return cached.data;

  const resolvedHomeId = await resolveTeamId(store, homeName, leagueLabel, options);
  const resolvedAwayId = await resolveTeamId(store, awayName, leagueLabel, options);
  if (!resolvedHomeId || !resolvedAwayId) {
    store.apiFootballH2HCache[pairKey] = {
      updatedAt: new Date().toISOString(),
      status: "team_mapping_missing",
      data: null,
    };
    return null;
  }

  const response = await apiFootballGet("/fixtures/headtohead", { h2h: `${resolvedHomeId}-${resolvedAwayId}`, last: 8 }, options);
  recordDiagnostic(store, response.status, { statusCode: response.statusCode, endpoint: "fixtures/headtohead" });
  if (response.status !== "ok") {
    store.apiFootballH2HCache[pairKey] = {
      updatedAt: new Date().toISOString(),
      status: response.status,
      statusCode: response.statusCode || null,
      data: null,
    };
    return null;
  }

  const results = normalizeFixtureH2H(response.data?.response || [], homeName, awayName, homeId, awayId);
  const homeWins = results.filter((item) => String(item.winnerId || "") === String(homeId || normalizeName(homeName))).length;
  const awayWins = results.filter((item) => String(item.winnerId || "") === String(awayId || normalizeName(awayName))).length;
  const data = results.length
    ? {
        played: results.length,
        homeWins,
        draws: results.length - homeWins - awayWins,
        awayWins,
        sameCompetitionPlayed: results.length,
        results,
        status: "api-football-h2h",
        source: "api-football-h2h",
        asOf: new Date().toISOString(),
        sourceTimestamp: new Date().toISOString(),
      }
    : null;

  store.apiFootballH2HCache[pairKey] = {
    updatedAt: new Date().toISOString(),
    status: data ? "available" : "not_found",
    data,
  };
  return data;
}

export function summarizeApiFootballUsage(store = {}) {
  const teamEntries = Object.values(store.apiFootballTeamMap || {});
  const h2hEntries = Object.values(store.apiFootballH2HCache || {});
  const diagnostics = store.apiFootballDiagnostics || {};
  return {
    configured: Boolean(getApiFootballKey()),
    enabled: String(process.env.API_FOOTBALL_H2H_ENABLED || "true").toLowerCase() !== "false",
    baseUrl: apiFootballBaseUrl().replace(/^https?:\/\//, ""),
    requests: Number(diagnostics.requests || 0),
    statusCounts: diagnostics.statusCounts || {},
    errorCategories: diagnostics.errorCategories || {},
    resolvedTeams: teamEntries.filter((entry) => entry?.teamId).length,
    failedTeamMappings: teamEntries.filter((entry) => !entry?.teamId).length,
    cachedPairs: h2hEntries.length,
    availablePairs: h2hEntries.filter((entry) => entry?.data?.results?.length).length,
    providerResultCount: h2hEntries.reduce((sum, entry) => sum + Number(entry?.data?.results?.length || 0), 0),
    lastStatus: diagnostics.lastStatus || null,
    lastStatusCode: diagnostics.lastStatusCode || null,
    lastCheckedAt: diagnostics.lastCheckedAt || null,
  };
}
