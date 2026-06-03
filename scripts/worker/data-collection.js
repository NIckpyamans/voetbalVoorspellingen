export const DATA_COLLECTION_MODULE = {
  name: "data-collection",
  owns: ["public API fetches", "source diagnostics", "rate limits", "fallback source ordering"],
};

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36";

export async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchText(url) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/plain,text/csv,text/*;q=0.9,*/*;q=0.8",
        "User-Agent": DEFAULT_USER_AGENT,
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export function createSafeFetch({ sofaBase, sofaFetchCircuit, sportsDbSquadFetchState, logger = console } = {}) {
  return async function safeFetch(url) {
    const isSofaRequest = String(url || "").startsWith(sofaBase || "");
    const isSportsDbSquadRequest = String(url || "").includes("thesportsdb.com/api/v1/json/3/searchplayers.php");
    if (isSofaRequest && sofaFetchCircuit?.blocked) {
      return null;
    }
    if (isSportsDbSquadRequest && Number(sportsDbSquadFetchState?.blockedUntil || 0) > Date.now()) {
      return null;
    }
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          Origin: "https://www.sofascore.com",
          Referer: "https://www.sofascore.com/",
          "User-Agent": DEFAULT_USER_AGENT,
        },
      }, 12000);
      if (!response.ok) {
        if (isSofaRequest && response.status === 403) {
          sofaFetchCircuit.failures += 1;
          sofaFetchCircuit.blocked = true;
          if (!sofaFetchCircuit.logged) {
            logger.error("[worker] Sofascore geeft 403; deze run gebruikt automatisch de gratis fallbackbronnen.");
            sofaFetchCircuit.logged = true;
          }
          return null;
        }
        if (isSportsDbSquadRequest && response.status === 429) {
          sportsDbSquadFetchState.blockedUntil = Date.now() + 60 * 60 * 1000;
          if (!sportsDbSquadFetchState.loggedRateLimit) {
            logger.warn("[worker] TheSportsDB spelerslijsten zijn tijdelijk rate-limited; worker gebruikt afgeleide teamsterkte.");
            sportsDbSquadFetchState.loggedRateLimit = true;
          }
          return null;
        }
        logger.error(`[worker] API error ${response.status} voor ${url}`);
        return null;
      }
      return await response.json();
    } catch (error) {
      logger.error(`[worker] Fetch mislukt voor ${url}: ${error.message}`);
      return null;
    }
  };
}

export async function safeFetchText(url) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "text/plain,text/csv,*/*",
        "User-Agent": DEFAULT_USER_AGENT,
      },
    }, 12000);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export async function fetchExternalJson(url, headers = {}) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json,text/javascript,*/*;q=0.8",
        "User-Agent": DEFAULT_USER_AGENT,
        ...headers,
      },
    }, 12000);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function average(values) {
  const clean = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  return Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(2));
}

function getUnderstatSeason(dateISO) {
  const base = dateISO ? new Date(dateISO) : new Date();
  const amsterdamString = base.toLocaleString("en-US", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "numeric",
  });
  const [monthStr, yearStr] = amsterdamString.split("/");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  return String(month >= 6 ? year : year - 1);
}

export async function fetchUnderstatSnapshot(leagueLabel, dateISO, deps) {
  const code = deps.understatLeagueCodes[leagueLabel];
  if (!code) return null;

  const season = getUnderstatSeason(dateISO);
  const url = `https://understat.com/getLeagueData/${code}/${season}`;
  const json = await fetchExternalJson(url, {
    "X-Requested-With": "XMLHttpRequest",
    Referer: `https://understat.com/league/${code}/${season}`,
  });
  const teamsData = json?.teams || null;
  if (!teamsData || typeof teamsData !== "object") return null;

  const teams = {};
  for (const team of Object.values(teamsData)) {
    const name = String(team?.title || "").trim();
    const history = Array.isArray(team?.history) ? team.history : [];
    if (!name || !history.length) continue;
    const homeRows = history.filter((row) => row.h_a === "h");
    const awayRows = history.filter((row) => row.h_a === "a");
    teams[deps.normalizeName(name)] = {
      teamName: name,
      games: history.length,
      avgXG: average(history.map((row) => row.xG)),
      avgXGA: average(history.map((row) => row.xGA)),
      avgNpxG: average(history.map((row) => row.npxG)),
      avgNpxGA: average(history.map((row) => row.npxGA)),
      homeXG: average(homeRows.map((row) => row.xG)),
      homeXGA: average(homeRows.map((row) => row.xGA)),
      awayXG: average(awayRows.map((row) => row.xG)),
      awayXGA: average(awayRows.map((row) => row.xGA)),
      ppda: average(history.map((row) => Number(row?.ppda?.att || 0) / Math.max(1, Number(row?.ppda?.def || 0)))),
      deep: average(history.map((row) => row.deep)),
      source: "Understat",
      season,
    };
  }

  return {
    updatedAt: Date.now(),
    source: "Understat",
    leagueLabel,
    season,
    sampleSize: Object.keys(teams).length,
    teams,
  };
}

export async function fetchOpenfootballProfile(leagueLabel, dateISO, deps) {
  const competitionCode = deps.openfootballCompetitions[leagueLabel];
  if (!competitionCode) return null;

  const results = [];
  for (const seasonTag of deps.getOpenfootballSeasonTags(dateISO, 3)) {
    const url = `https://raw.githubusercontent.com/openfootball/football.json/master/${seasonTag}/${competitionCode}.json`;
    const json = await fetchExternalJson(url);
    const matches = Array.isArray(json?.matches) ? json.matches : [];
    for (const match of matches) {
      const ft = match?.score?.ft;
      if (!Array.isArray(ft) || ft.length < 2) continue;
      const homeGoals = deps.toNumber(ft[0]);
      const awayGoals = deps.toNumber(ft[1]);
      if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
      results.push({
        date: match.date || null,
        home: match.team1 || match.homeTeam || "",
        away: match.team2 || match.awayTeam || "",
        homeGoals,
        awayGoals,
      });
    }
  }

  if (!results.length) return null;
  return deps.buildH2HProfileFromResults(results, "openfootball");
}

function getFbrefSnapshotUrls(leagueLabel, fbrefReleaseCodes) {
  const info = fbrefReleaseCodes[leagueLabel];
  if (!info) return [];
  const baseName = `${info.country}_M_${info.tier}`;
  const urls = [];
  if (info.advanced) {
    urls.push({
      type: "advanced",
      url: `https://github.com/JaseZiv/worldfootballR_data/releases/download/fb_advanced_match_stats/${baseName}_summary_team_advanced_match_stats.csv`,
    });
  }
  urls.push({
    type: "shooting",
    url: `https://github.com/JaseZiv/worldfootballR_data/releases/download/fb_match_shooting/${baseName}_match_shooting.csv`,
  });
  return urls;
}

function incrementSnapshotTeam(bucket, values) {
  bucket.games += Number(values.games || 0);
  bucket.shots += Number(values.shots || 0);
  bucket.shotsOn += Number(values.shotsOn || 0);
  bucket.xG += Number(values.xG || 0);
  bucket.npxG += Number(values.npxG || 0);
  bucket.homeGames += Number(values.homeGames || 0);
  bucket.awayGames += Number(values.awayGames || 0);
  bucket.homeShots += Number(values.homeShots || 0);
  bucket.awayShots += Number(values.awayShots || 0);
  bucket.homeXG += Number(values.homeXG || 0);
  bucket.awayXG += Number(values.awayXG || 0);
}

export async function fetchFbrefSnapshot(leagueLabel, dateISO, deps) {
  const urls = getFbrefSnapshotUrls(leagueLabel, deps.fbrefReleaseCodes);
  if (!urls.length) return null;

  const currentFolder = deps.getSeasonFolder(dateISO);
  const currentEndYear = 2000 + Number(currentFolder.slice(2));
  const teams = {};
  let sampleSize = 0;
  let sourceType = null;

  for (const item of urls) {
    const csvText = await fetchText(item.url);
    if (!csvText) continue;
    const rows = deps.parseCsv(csvText);
    if (!rows.length) continue;
    sourceType = item.type;
    const seenShotMatches = new Set();

    for (const row of rows) {
      const seasonEnd = Number(row.Season_End_Year || row.season_end_year || 0);
      if (seasonEnd && seasonEnd < currentEndYear - 2) continue;
      if (String(row.Gender || "M") !== "M") continue;
      const teamName = String(row.Team || row.Squad || "").trim();
      if (!teamName) continue;
      const key = deps.normalizeName(teamName);
      if (!teams[key]) {
        teams[key] = {
          teamName,
          games: 0,
          shots: 0,
          shotsOn: 0,
          xG: 0,
          npxG: 0,
          homeGames: 0,
          awayGames: 0,
          homeShots: 0,
          awayShots: 0,
          homeXG: 0,
          awayXG: 0,
        };
      }

      if (item.type === "advanced") {
        const homeAway = String(row.Home_Away || "").toLowerCase();
        const shots = Number(deps.toNumber(row.Sh) || 0);
        const shotsOn = Number(deps.toNumber(row.SoT) || 0);
        const xG = Number(deps.toNumber(row.xG_Expected || row.Home_xG || row.Away_xG) || 0);
        const npxG = Number(deps.toNumber(row.npxG_Expected) || xG || 0);
        incrementSnapshotTeam(teams[key], {
          games: 1,
          shots,
          shotsOn,
          xG,
          npxG,
          homeGames: homeAway === "home" ? 1 : 0,
          awayGames: homeAway === "away" ? 1 : 0,
          homeShots: homeAway === "home" ? shots : 0,
          awayShots: homeAway === "away" ? shots : 0,
          homeXG: homeAway === "home" ? xG : 0,
          awayXG: homeAway === "away" ? xG : 0,
        });
      } else {
        const homeAway = String(row.Home_Away || "").toLowerCase();
        const xG = Number(deps.toNumber(row.xG) || 0);
        const onTarget = ["goal", "saved", "saved to post"].includes(String(row.Outcome || "").toLowerCase()) ? 1 : 0;
        const matchKey = `${key}_${row.MatchURL || row.Date || sampleSize}`;
        const firstShotForMatch = !seenShotMatches.has(matchKey);
        seenShotMatches.add(matchKey);
        incrementSnapshotTeam(teams[key], {
          games: firstShotForMatch ? 1 : 0,
          shots: 1,
          shotsOn: onTarget,
          xG,
          npxG: xG,
          homeGames: firstShotForMatch && homeAway === "home" ? 1 : 0,
          awayGames: firstShotForMatch && homeAway === "away" ? 1 : 0,
          homeShots: homeAway === "home" ? 1 : 0,
          awayShots: homeAway === "away" ? 1 : 0,
          homeXG: homeAway === "home" ? xG : 0,
          awayXG: homeAway === "away" ? xG : 0,
        });
      }
      sampleSize += 1;
    }

    if (Object.keys(teams).length) break;
  }

  if (!Object.keys(teams).length) return null;

  const formattedTeams = {};
  for (const [key, value] of Object.entries(teams)) {
    const games = Math.max(Number(value.games || 0), 1);
    const homeGames = Math.max(Number(value.homeGames || 0), 1);
    const awayGames = Math.max(Number(value.awayGames || 0), 1);
    formattedTeams[key] = {
      teamName: value.teamName,
      games: Number(value.games || 0),
      avgShots: Number((Number(value.shots || 0) / games).toFixed(2)),
      avgShotsOn: Number((Number(value.shotsOn || 0) / games).toFixed(2)),
      avgXG: Number((Number(value.xG || 0) / games).toFixed(2)),
      avgNpxG: Number((Number(value.npxG || 0) / games).toFixed(2)),
      homeShots: Number((Number(value.homeShots || 0) / homeGames).toFixed(2)),
      awayShots: Number((Number(value.awayShots || 0) / awayGames).toFixed(2)),
      homeXG: Number((Number(value.homeXG || 0) / homeGames).toFixed(2)),
      awayXG: Number((Number(value.awayXG || 0) / awayGames).toFixed(2)),
      source: `FBref ${sourceType || "snapshot"}`,
    };
  }

  return {
    updatedAt: Date.now(),
    source: "FBref",
    leagueLabel,
    sourceType,
    sampleSize,
    teams: formattedTeams,
  };
}
