const DEFAULT_BASE_URL = "https://www.thesportsdb.com/api/v1/json/123";
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_PARTIAL_TTL_MS = 2 * 60 * 60 * 1000;

function normalized(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function score(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function pickExactTeam(teams, teamName, nameVariants) {
  const variants = new Set((nameVariants?.(teamName) || [teamName]).map(normalized).filter(Boolean));
  return (teams || []).find((team) => {
    const sport = normalized(team?.strSport);
    const isFootball = !sport || sport === "soccer" || sport === "football";
    return isFootball && variants.has(normalized(team?.strTeam));
  }) || null;
}

export function normalizeTheSportsDbRecentEvents(events, teamName, teamId) {
  return (events || [])
    .map((event) => {
      const home = String(event?.strHomeTeam || "").trim();
      const away = String(event?.strAwayTeam || "").trim();
      const homeScore = score(event?.intHomeScore);
      const awayScore = score(event?.intAwayScore);
      const isHome = normalized(home) === normalized(teamName);
      const isAway = normalized(away) === normalized(teamName);
      if ((!isHome && !isAway) || homeScore === null || awayScore === null) return null;
      const goalsFor = isHome ? homeScore : awayScore;
      const goalsAgainst = isHome ? awayScore : homeScore;
      return {
        date: event?.dateEvent || null,
        eventId: event?.idEvent || null,
        league: event?.strLeague || null,
        venue: isHome ? "H" : "A",
        opponent: isHome ? away : home,
        opponentId: "",
        score: `${goalsFor}-${goalsAgainst}`,
        goalsFor,
        goalsAgainst,
        result: goalsFor > goalsAgainst ? "W" : goalsFor === goalsAgainst ? "D" : "L",
        source: "thesportsdb-recent-results",
        providerTeamId: String(teamId || ""),
      };
    })
    .filter(Boolean)
    .sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchingName(value, expected, nameVariants) {
  const variants = new Set((nameVariants?.(expected) || [expected]).map(normalized).filter(Boolean));
  return variants.has(normalized(value));
}

export function findTheSportsDbDirectResult(homeProfile, awayProfile, homeName, awayName, nameVariants) {
  const candidates = [...(homeProfile?.recentMatches || []), ...(awayProfile?.recentMatches || [])];
  const seen = new Set();
  for (const item of candidates) {
    if (!item?.score) continue;
    const isHomePerspective = matchingName(item?.opponent, awayName, nameVariants) && matchingName(item?.providerTeamName || homeName, homeName, nameVariants);
    const isAwayPerspective = matchingName(item?.opponent, homeName, nameVariants) && matchingName(item?.providerTeamName || awayName, awayName, nameVariants);
    if (!isHomePerspective && !isAwayPerspective) continue;
    const key = String(item.eventId || `${item.date}|${item.score}|${item.opponent}`);
    if (seen.has(key)) continue;
    seen.add(key);
    const perspectiveName = isHomePerspective ? homeName : awayName;
    const opponentName = isHomePerspective ? awayName : homeName;
    const perspectiveWasAway = String(item.venue || "").toUpperCase() === "A";
    const home = perspectiveWasAway ? opponentName : perspectiveName;
    const away = perspectiveWasAway ? perspectiveName : opponentName;
    const homeGoals = perspectiveWasAway ? Number(item.goalsAgainst) : Number(item.goalsFor);
    const awayGoals = perspectiveWasAway ? Number(item.goalsFor) : Number(item.goalsAgainst);
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
    return {
      eventId: item.eventId || null,
      date: item.date || null,
      home,
      away,
      score: `${homeGoals}-${awayGoals}`,
      source: "thesportsdb-direct-fixture",
    };
  }
  return null;
}

export async function fetchTheSportsDbTeamForm({
  teamName,
  cache,
  nameVariants,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  baseUrl = DEFAULT_BASE_URL,
  requestState = null,
  minDelayMs = 250,
  maxSearchVariants = 4,
  minRecentMatches = 10,
  partialTtlMs = DEFAULT_PARTIAL_TTL_MS,
}) {
  const key = normalized(teamName);
  if (!key || typeof fetchImpl !== "function") return null;
  const cached = cache?.[key];
  const cachedMatchCount = Number(cached?.data?.recentMatches?.length || 0);
  const cacheTtl = cachedMatchCount >= minRecentMatches ? DEFAULT_TTL_MS : partialTtlMs;
  const checkedAt = cached?.providerCheckedAt || cached?.updatedAt;
  const checkedAtMs = typeof checkedAt === "number" ? checkedAt : Date.parse(String(checkedAt || ""));
  if (cached?.data && Number.isFinite(checkedAtMs) && now - checkedAtMs < cacheTtl) return cached.data;
  if (requestState?.blockedUntil > now || (requestState?.max && requestState.count >= requestState.max)) return null;
  try {
    if (requestState) {
      const waitMs = Math.max(0, Number(minDelayMs || 0) - (now - Number(requestState.lastAt || 0)));
      if (waitMs) await wait(waitMs);
      requestState.count = Number(requestState.count || 0) + 1;
      requestState.lastAt = Date.now();
    }
    const queryVariants = [...new Set([teamName, ...(nameVariants?.(teamName) || [])].map(String).filter(Boolean))]
      .slice(0, Math.max(1, Number(maxSearchVariants) || 1));
    let team = null;
    for (const query of queryVariants) {
      const search = await fetchImpl(`${baseUrl}/searchteams.php?t=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } });
      if (!search.ok) {
        if (requestState && Number(search.status) === 429) requestState.blockedUntil = Date.now() + 60 * 60 * 1000;
        if (Number(search.status) === 429) return null;
        continue;
      }
      team = pickExactTeam((await search.json())?.teams, teamName, nameVariants);
      if (team?.idTeam) break;
    }
    if (!team?.idTeam) return null;
    const eventsResponse = await fetchImpl(`${baseUrl}/eventslast.php?id=${encodeURIComponent(team.idTeam)}`, { headers: { Accept: "application/json" } });
    if (!eventsResponse.ok) {
      if (requestState && Number(eventsResponse.status) === 429) requestState.blockedUntil = Date.now() + 60 * 60 * 1000;
      return null;
    }
    const recentMatches = normalizeTheSportsDbRecentEvents((await eventsResponse.json())?.results, team.strTeam, team.idTeam);
    const data = {
      providerTeamId: String(team.idTeam),
      providerTeamName: String(team.strTeam || teamName),
      recentMatches,
      source: "thesportsdb-recent-results",
      asOf: new Date(now).toISOString(),
    };
    for (const match of data.recentMatches) match.providerTeamName = data.providerTeamName;
    if (cache) cache[key] = { updatedAt: now, providerCheckedAt: now, data };
    return data;
  } catch {
    return null;
  }
}
