const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_SEASONS_BACK = 4;

function normalize(value) {
  return String(value || "").trim();
}

function isFinal(status = {}) {
  return status?.completed === true || /final|completed/i.test(String(status?.type?.name || status?.type?.description || status?.name || ""));
}

function competitor(competition, homeAway) {
  return (competition?.competitors || []).find((row) => row?.homeAway === homeAway) || null;
}

export function normalizeEspnH2HEvents(events, { homeName, awayName, homeEspnId, awayEspnId, cutoffAt }) {
  const cutoffMs = Date.parse(cutoffAt || "");
  const rows = [];
  for (const event of events || []) {
    const competition = event?.competitions?.[0] || {};
    const home = competitor(competition, "home");
    const away = competitor(competition, "away");
    const date = competition?.date || event?.date || null;
    const dateMs = Date.parse(date || "");
    const homeScore = Number(home?.score?.value ?? home?.score);
    const awayScore = Number(away?.score?.value ?? away?.score);
    const direct = String(home?.team?.id || "") === String(homeEspnId) && String(away?.team?.id || "") === String(awayEspnId);
    const reversed = String(home?.team?.id || "") === String(awayEspnId) && String(away?.team?.id || "") === String(homeEspnId);
    if ((!direct && !reversed) || !isFinal(competition?.status || event?.status) || !Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;
    if (!Number.isFinite(dateMs) || (Number.isFinite(cutoffMs) && dateMs >= cutoffMs)) continue;
    const currentHomeScore = direct ? homeScore : awayScore;
    const currentAwayScore = direct ? awayScore : homeScore;
    rows.push({
      date: new Date(dateMs).toISOString().slice(0, 10),
      home: homeName,
      away: awayName,
      score: `${currentHomeScore}-${currentAwayScore}`,
      homeScore: currentHomeScore,
      awayScore: currentAwayScore,
      winnerId: currentHomeScore > currentAwayScore ? String(homeEspnId) : currentAwayScore > currentHomeScore ? String(awayEspnId) : "",
      source: "espn-team-schedule-h2h",
      sourceTimestamp: date,
      providerFixtureId: String(event?.id || "") || null,
    });
  }
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-8);
}

async function fetchSchedule(leagueCode, teamId, season, fetchImpl) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(leagueCode)}/teams/${encodeURIComponent(teamId)}/schedule?season=${season}`;
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

export async function fetchEspnH2HProfile({ store, homeName, awayName, homeProviderIds, awayProviderIds, kickoff }, options = {}) {
  const homeEspnId = normalize(homeProviderIds?.espn);
  const awayEspnId = normalize(awayProviderIds?.espn);
  const leagueCode = normalize(homeProviderIds?.espnLeagueCode || awayProviderIds?.espnLeagueCode);
  if (!store || !homeEspnId || !awayEspnId || !leagueCode) return null;
  if (!store.espnH2HCache) store.espnH2HCache = {};
  const key = `${homeEspnId}:${awayEspnId}:${leagueCode}`;
  const cached = store.espnH2HCache[key];
  const updatedMs = Date.parse(cached?.updatedAt || "");
  if (cached?.data && Number.isFinite(updatedMs) && Date.now() - updatedMs < CACHE_TTL_MS) return cached.data;

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") return null;
  const seasonsBack = Math.max(1, Math.min(8, Number(options.seasonsBack || process.env.ESPN_H2H_SEASONS_BACK || DEFAULT_SEASONS_BACK)));
  const season = new Date(kickoff || Date.now()).getUTCFullYear();
  const events = [];
  for (let year = season; year > season - seasonsBack; year -= 1) {
    const payload = await fetchSchedule(leagueCode, homeEspnId, year, fetchImpl);
    events.push(...(Array.isArray(payload?.events) ? payload.events : []));
  }
  const results = normalizeEspnH2HEvents(events, { homeName, awayName, homeEspnId, awayEspnId, cutoffAt: kickoff });
  const homeWins = results.filter((row) => row.winnerId === homeEspnId).length;
  const awayWins = results.filter((row) => row.winnerId === awayEspnId).length;
  const data = results.length ? {
    played: results.length,
    homeWins,
    draws: results.length - homeWins - awayWins,
    awayWins,
    sameCompetitionPlayed: results.length,
    results,
    status: "espn-team-schedule-h2h",
    source: "espn-team-schedule-h2h",
    asOf: new Date().toISOString(),
    sourceTimestamp: new Date().toISOString(),
  } : null;
  store.espnH2HCache[key] = { updatedAt: new Date().toISOString(), status: data ? "available" : "not_found", data };
  return data;
}
