const API_BASE = "https://v3.football.api-sports.io";

export function normalizeApiFootballProbeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|afc|cf|sc|ac|as|club|football club|the|de|la|fk|sv)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function responseRows(payload) {
  return Array.isArray(payload?.response) ? payload.response : [];
}

function countryMatches(teamCountry, country) {
  const wantedCountry = normalizeApiFootballProbeName(country);
  return !wantedCountry || normalizeApiFootballProbeName(teamCountry) === wantedCountry;
}

function teamCandidates(payload, country) {
  return responseRows(payload)
    .map((row) => row?.team)
    .filter((team) => team?.id && countryMatches(team.country, country))
    .slice(0, 5)
    .map((team) => ({ id: String(team.id), name: String(team.name || ""), country: team.country || null }));
}

function exactTeamMatch(payload, teamName, country) {
  const wanted = normalizeApiFootballProbeName(teamName);
  const wantedCountry = normalizeApiFootballProbeName(country);
  const matches = responseRows(payload).filter((row) => {
    const team = row?.team || {};
    const names = [team.name, team.code].map(normalizeApiFootballProbeName).filter(Boolean);
    return names.includes(wanted) && countryMatches(team.country, country) && team.id;
  });
  return matches.length === 1 ? matches[0].team : null;
}

async function requestJson(pathname, params, options) {
  const url = new URL(pathname, options.baseUrl || API_BASE);
  for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, String(value));
  const headers = { Accept: "application/json", "x-apisports-key": options.apiKey };
  if (/rapidapi/i.test(url.hostname)) {
    headers["x-rapidapi-key"] = options.apiKey;
    headers["x-rapidapi-host"] = url.hostname;
    delete headers["x-apisports-key"];
  }
  const signal = options.signal || AbortSignal.timeout(Number(options.timeoutMs || 12_000));
  const response = await (options.fetchImpl || fetch)(url, { headers, method: "GET", signal });
  const payload = await response.json().catch(() => null);
  return {
    ok: response.ok && !Object.keys(payload?.errors || {}).length,
    status: response.status,
    payload,
    quota: {
      dailyRemaining: response.headers?.get?.("x-ratelimit-requests-remaining") || null,
      minuteRemaining: response.headers?.get?.("x-ratelimit-remaining") || null,
    },
  };
}

export async function probeApiFootballH2HPairs(pairs, options = {}) {
  const maxPairs = Math.min(5, Math.max(1, Number(options.maxPairs || 3)));
  const maxRequests = Math.min(15, Math.max(1, Number(options.maxRequests || maxPairs * 3)));
  const selected = (Array.isArray(pairs) ? pairs : []).slice(0, maxPairs);
  const teamCache = new Map();
  let requests = 0;
  let providerStopStatus = null;
  const results = [];
  const quotaSamples = [];

  function updateProviderStop(result) {
    const remainingValue = result?.quota?.dailyRemaining;
    const dailyRemaining = remainingValue == null || remainingValue === "" ? null : Number(remainingValue);
    if (result?.status === 401 || result?.status === 403 || result?.status === 429 || dailyRemaining === 0) {
      providerStopStatus = result.status === 429 || dailyRemaining === 0 ? "provider_quota_exhausted" : `provider_http_${result.status}`;
    }
  }

  async function resolveTeam(name, country, knownId) {
    if (providerStopStatus) return { status: providerStopStatus };
    const key = `${normalizeApiFootballProbeName(name)}|${normalizeApiFootballProbeName(country)}`;
    if (knownId) return { status: "mapped_from_config", id: String(knownId), name, country: country || null };
    if (teamCache.has(key)) return teamCache.get(key);
    if (requests >= maxRequests) return { status: "request_budget_exhausted" };
    requests += 1;
    const response = await requestJson("/teams", { search: name }, options);
    updateProviderStop(response);
    quotaSamples.push({ endpoint: "teams", ...response.quota });
    if (!response.ok) {
      return {
        status: `http_${response.status}`,
        providerMessage: JSON.stringify(response.payload?.errors || response.payload?.message || "").slice(0, 300),
      };
    }
    const team = exactTeamMatch(response.payload, name, country);
    const resolved = team
      ? { status: "mapped", id: String(team.id), name: team.name, country: team.country || null }
      : { status: "mapping_missing", candidates: teamCandidates(response.payload, country) };
    teamCache.set(key, resolved);
    return resolved;
  }

  for (const pair of selected) {
    const country = String(pair.league || "").split(" - ")[0];
    const home = await resolveTeam(pair.homeTeam, country, pair.homeTeamId);
    const away = await resolveTeam(pair.awayTeam, country, pair.awayTeamId);
    const mapped = (team) => ["mapped", "mapped_from_config"].includes(team.status);
    if (!mapped(home) || !mapped(away)) {
      const stopped = [home, away].find((team) => /^provider_(?:quota_exhausted|http_)/.test(team.status));
      if (stopped) {
        results.push({ matchId: pair.matchId || null, league: pair.league || null, homeTeam: pair.homeTeam, awayTeam: pair.awayTeam, status: stopped.status, historyCount: 0, history: [] });
        continue;
      }
      const unmapped = !mapped(home) ? home : away;
      results.push({
        matchId: pair.matchId || null,
        league: pair.league || null,
        homeTeam: pair.homeTeam,
        awayTeam: pair.awayTeam,
        status: !mapped(home) ? `home_${home.status}` : `away_${away.status}`,
        homeTeamId: home.id || null,
        awayTeamId: away.id || null,
        providerMessage: unmapped.providerMessage || null,
        mappingCandidates: unmapped.candidates || [],
        historyCount: 0,
        history: [],
      });
      continue;
    }
    if (providerStopStatus) {
      results.push({ matchId: pair.matchId || null, league: pair.league || null, homeTeam: pair.homeTeam, awayTeam: pair.awayTeam, status: providerStopStatus, homeTeamId: home.id, awayTeamId: away.id, historyCount: 0, history: [] });
      continue;
    }
    if (requests >= maxRequests) {
      results.push({ matchId: pair.matchId || null, league: pair.league || null, homeTeam: pair.homeTeam, awayTeam: pair.awayTeam, status: "request_budget_exhausted", homeTeamId: home.id, awayTeamId: away.id, historyCount: 0, history: [] });
      continue;
    }
    requests += 1;
    const response = await requestJson("/fixtures/headtohead", { h2h: `${home.id}-${away.id}`, last: 5 }, options);
    updateProviderStop(response);
    quotaSamples.push({ endpoint: "fixtures/headtohead", ...response.quota });
    const kickoffMs = Date.parse(pair.kickoff || "");
    const history = response.ok ? responseRows(response.payload).map((row) => {
      const fixtureMs = Date.parse(row?.fixture?.date || "");
      const homeId = String(row?.teams?.home?.id || "");
      const awayId = String(row?.teams?.away?.id || "");
      const involvedTeams = [home.id, away.id].includes(homeId) && [home.id, away.id].includes(awayId) && homeId !== awayId;
      const completed = /^(FT|AET|PEN)$/i.test(String(row?.fixture?.status?.short || ""));
      const homeGoals = Number(row?.goals?.home);
      const awayGoals = Number(row?.goals?.away);
      if (!involvedTeams || !completed || !Number.isFinite(fixtureMs) || (Number.isFinite(kickoffMs) && fixtureMs >= kickoffMs) || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
      return {
        fixtureId: row?.fixture?.id ? String(row.fixture.id) : null,
        date: row?.fixture?.date || null,
        homeTeam: row?.teams?.home?.name || null,
        awayTeam: row?.teams?.away?.name || null,
        homeGoals,
        awayGoals,
        status: row?.fixture?.status?.short || null,
      };
    }).filter((row) => row?.fixtureId) : [];
    results.push({
      matchId: pair.matchId || null,
      league: pair.league || null,
      homeTeam: pair.homeTeam,
      awayTeam: pair.awayTeam,
      homeApiName: home.name || null,
      awayApiName: away.name || null,
      status: response.ok ? history.length ? "history_found" : "no_history_returned" : `http_${response.status}`,
      providerMessage: response.ok ? null : JSON.stringify(response.payload?.errors || response.payload?.message || "").slice(0, 300),
      homeTeamId: home.id,
      awayTeamId: away.id,
      historyCount: history.length,
      history,
    });
  }

  const mappingFailures = results.filter((row) => /mapping_missing/.test(row.status)).map((row) => ({
    matchId: row.matchId,
    league: row.league,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    status: row.status,
    providerMessage: row.providerMessage || null,
    candidatesForManualReview: row.mappingCandidates || [],
  }));
  const mappingSuggestions = results.flatMap((row) => [
    row.homeTeamId ? { name: row.homeTeam, aliases: [row.homeApiName].filter(Boolean), apiFootballTeamId: row.homeTeamId, league: row.league, source: "api-football-h2h-probe" } : null,
    row.awayTeamId ? { name: row.awayTeam, aliases: [row.awayApiName].filter(Boolean), apiFootballTeamId: row.awayTeamId, league: row.league, source: "api-football-h2h-probe" } : null,
  ].filter(Boolean));

  return {
    provider: "api-football",
    mode: "read-only-h2h-probe",
    pairLimit: maxPairs,
    requestLimit: maxRequests,
    checked: results.length,
    requests,
    quotaSamples,
    mappedTeams: new Set(results.flatMap((row) => [row.homeTeamId, row.awayTeamId].filter(Boolean))).size,
    mappingSuggestions,
    mappingFailures,
    results,
  };
}
