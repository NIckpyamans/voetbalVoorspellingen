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

export async function fetchExternalJson(url, headers = {}, timeoutMs = 12000) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json,text/javascript,*/*;q=0.8",
        "User-Agent": DEFAULT_USER_AGENT,
        ...headers,
      },
    }, timeoutMs);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function decodeHtmlText(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
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

function getBbcLeagueLabel(html, index, bbcCompetitionToLabel) {
  const before = html.slice(Math.max(0, index - 5000), index);
  const headings = [...before.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)];
  const headingName = decodeHtmlText(String(headings.at(-1)?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  if (bbcCompetitionToLabel[headingName]) return bbcCompetitionToLabel[headingName];
  if (headingName) return null;

  const matches = [...before.matchAll(/SignpostLink[^>]*>([^<]+)</g)];
  const competitionName = decodeHtmlText(matches.at(-1)?.[1] || "");
  return bbcCompetitionToLabel[competitionName] || null;
}

function parseBbcAggregate(block, homeName, awayName, deps) {
  const aggregateTextMatch = String(block || "").match(/Aggregate score\s+([^<]+?)<\/span>/i);
  const aggregateText = decodeHtmlText(aggregateTextMatch?.[1] || "");
  const numberMatch = aggregateText.match(/(.+?)\s+(\d+)\s*,\s*(.+?)\s+(\d+)/);
  if (!numberMatch) return null;

  const firstTeam = decodeHtmlText(numberMatch[1]);
  const firstGoals = Number(numberMatch[2]);
  const secondTeam = decodeHtmlText(numberMatch[3]);
  const secondGoals = Number(numberMatch[4]);
  if (!Number.isFinite(firstGoals) || !Number.isFinite(secondGoals)) return null;

  const homeVariants = deps.buildPossibleNames(homeName);
  const awayVariants = deps.buildPossibleNames(awayName);
  const firstVariants = deps.buildPossibleNames(firstTeam);
  const secondVariants = deps.buildPossibleNames(secondTeam);
  const firstIsHome = firstVariants.some((variant) => homeVariants.includes(variant));
  const secondIsAway = secondVariants.some((variant) => awayVariants.includes(variant));
  const firstIsAway = firstVariants.some((variant) => awayVariants.includes(variant));
  const secondIsHome = secondVariants.some((variant) => homeVariants.includes(variant));

  if (firstIsHome && secondIsAway) {
    return {
      homeAggregateBeforeMatch: firstGoals,
      awayAggregateBeforeMatch: secondGoals,
      aggregateText,
      previousLegScore: `${firstGoals}-${secondGoals}`,
      previousLegText: `${homeName} ${firstGoals}-${secondGoals} ${awayName}`,
    };
  }
  if (firstIsAway && secondIsHome) {
    return {
      homeAggregateBeforeMatch: secondGoals,
      awayAggregateBeforeMatch: firstGoals,
      aggregateText,
      previousLegScore: `${secondGoals}-${firstGoals}`,
      previousLegText: `${awayName} ${firstGoals}-${secondGoals} ${homeName}`,
    };
  }

  return {
    homeAggregateBeforeMatch: firstGoals,
    awayAggregateBeforeMatch: secondGoals,
    aggregateText,
    previousLegScore: `${firstGoals}-${secondGoals}`,
    previousLegText: `${firstTeam} ${firstGoals}-${secondGoals} ${secondTeam}`,
  };
}

const espnTeamLogoCache = new Map();
let espnTeamLogoCacheLoaded = false;

function rememberEspnTeamLogo(team, deps) {
  const logo = String(team?.logos?.[0]?.href || team?.logo || "").trim();
  if (!logo) return;
  const names = [team?.displayName, team?.name, team?.shortDisplayName].filter(Boolean);
  for (const name of names) {
    for (const variant of deps.buildLogoLookupNames(name)) {
      espnTeamLogoCache.set(deps.normalizeName(variant), logo);
    }
  }
}

async function ensureEspnTeamLogoCache(deps) {
  if (espnTeamLogoCacheLoaded) return;
  espnTeamLogoCacheLoaded = true;
  const codes = [...new Set(Object.values(deps.espnScoreboardLeagues || {}))];
  for (const code of codes) {
    const json = await fetchExternalJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/teams`);
    const teams = json?.sports?.[0]?.leagues?.[0]?.teams || json?.sports?.leagues?.teams || [];
    for (const wrapper of teams || []) {
      rememberEspnTeamLogo(wrapper?.team || wrapper, deps);
    }
    await deps.sleep(20);
  }
}

export async function resolveEspnTeamLogoByName(teamName, deps) {
  await ensureEspnTeamLogoCache(deps);
  const variants = deps.buildLogoLookupNames(teamName);
  for (const variant of variants) {
    const logo = espnTeamLogoCache.get(deps.normalizeName(variant));
    if (logo) return logo;
  }
  return "";
}

export async function fetchBbcScheduledEvents(dateISO, deps) {
  const html = await fetchText(`https://www.bbc.co.uk/sport/football/scores-fixtures/${dateISO}`);
  if (!html) return [];

  const fallbackEvents = [];
  const pattern = /<span class="visually-hidden[^"]*">([^<]+?) versus ([^<]+?) kick off ([0-9]{1,2}:[0-9]{2})<\/span>/g;
  for (const match of html.matchAll(pattern)) {
    const homeName = decodeHtmlText(match[1]);
    const awayName = decodeHtmlText(match[2]);
    const time = decodeHtmlText(match[3]);
    const leagueLabel = getBbcLeagueLabel(html, match.index || 0, deps.bbcCompetitionToLabel);
    const eventBlock = html.slice(match.index || 0, Math.min(html.length, (match.index || 0) + 3500));
    const bbcAggregate = parseBbcAggregate(eventBlock, homeName, awayName, deps);
    if (!leagueLabel) continue;
    if (deps.isWomenContext(leagueLabel, homeName, awayName) || deps.isYouthContext(leagueLabel, homeName, awayName)) continue;

    const leagueInfo = deps.leagues.find((item) => item.label === leagueLabel) || {
      label: leagueLabel,
      name: leagueLabel.split(" - ").at(-1),
      country: leagueLabel.split(" - ")[0],
      type: leagueLabel.includes("Europe -") ? "cup" : "league",
    };
    const kickoffIso = deps.buildFootballDataKickoffIso(dateISO, time);
    const [homeLogoUrl, awayLogoUrl] = await Promise.all([
      resolveEspnTeamLogoByName(homeName, deps),
      resolveEspnTeamLogoByName(awayName, deps),
    ]);
    fallbackEvents.push({
      id: `bbc-${dateISO}-${deps.normalizeName(homeName)}-${deps.normalizeName(awayName)}`,
      startTimestamp: Math.floor(new Date(kickoffIso).getTime() / 1000),
      homeTeam: { id: "", name: homeName, country: { name: leagueInfo.country || "" }, logoUrl: homeLogoUrl },
      awayTeam: { id: "", name: awayName, country: { name: leagueInfo.country || "" }, logoUrl: awayLogoUrl },
      uniqueTournament: { id: null, name: leagueInfo.name },
      tournament: {
        id: null,
        name: leagueInfo.name,
        category: { name: leagueInfo.country || "" },
        uniqueTournament: { id: null },
      },
      season: { id: null },
      status: { type: "notstarted", description: "NS" },
      homeScore: {},
      awayScore: {},
      bbcMeta: {
        aggregate: bbcAggregate,
      },
      source: "bbc-fixture-fallback",
    });
  }

  return fallbackEvents;
}

function getEspnCompetitor(competition, side) {
  return (competition?.competitors || []).find((competitor) => competitor?.homeAway === side) || null;
}

function getEspnTeamLogo(team) {
  if (team?.logo) return String(team.logo || "");
  const logos = Array.isArray(team?.logos) ? team.logos : [];
  return String(logos.find((logo) => String(logo?.rel || "").includes("default"))?.href || logos[0]?.href || "");
}

function mapEspnStatus(statusType) {
  const state = String(statusType?.state || "").toLowerCase();
  const name = String(statusType?.name || "").toLowerCase();
  const description = String(statusType?.description || statusType?.detail || statusType?.shortDetail || "").toLowerCase();
  const completed = Boolean(statusType?.completed);
  if (completed || state === "post" || name.includes("final") || description.includes("final") || description === "ft") {
    return "finished";
  }
  if (state === "in" || description.includes("'") || description.includes("half")) {
    return description.includes("half") && !description.match(/\d/) ? "halftime" : "inprogress";
  }
  return "notstarted";
}

function getEspnDisplayMinute(status, deps) {
  const detail = String(status?.type?.shortDetail || status?.type?.detail || status?.displayClock || "").trim();
  const minute = deps.parseMinuteFromDescription(detail);
  if (minute?.current) return { current: minute.current, extra: minute.extra || 0, label: detail };
  const clockSeconds = Number(status?.clock || 0);
  if (clockSeconds > 0) {
    const current = Math.max(1, Math.floor(clockSeconds / 60));
    return { current, extra: 0, label: `${current}'` };
  }
  return { current: null, extra: 0, label: detail || null };
}

export async function fetchEspnScoreboardEvents(dateISO, deps) {
  const fallbackEvents = [];
  const requestedDate = new Date(`${dateISO}T12:00:00.000Z`);
  const previousDate = new Date(requestedDate.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const queryDates = [...new Set([previousDate, dateISO].map((value) => String(value || "").replace(/-/g, "")))];

  for (const [leagueLabel, espnCode] of Object.entries(deps.espnScoreboardLeagues)) {
    const leagueInfo = deps.leagues.find((item) => item.label === leagueLabel);
    if (!leagueInfo) continue;

    const eventMap = new Map();
    for (const yyyymmdd of queryDates) {
      const json = await fetchExternalJson(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnCode}/scoreboard?dates=${yyyymmdd}`
      );
      for (const event of Array.isArray(json?.events) ? json.events : []) {
        eventMap.set(String(event?.id || `${event?.date || ""}-${event?.name || ""}`), event);
      }
    }
    const events = [...eventMap.values()];
    for (const event of events) {
      const competition = event?.competitions?.[0] || {};
      const home = getEspnCompetitor(competition, "home");
      const away = getEspnCompetitor(competition, "away");
      const homeName = String(home?.team?.displayName || home?.team?.name || "").trim();
      const awayName = String(away?.team?.displayName || away?.team?.name || "").trim();
      if (!homeName || !awayName) continue;
      if (deps.isWomenContext(leagueLabel, homeName, awayName) || deps.isYouthContext(leagueLabel, homeName, awayName)) continue;

      const kickoff = new Date(competition?.date || event?.date || "");
      if (deps.toAmsterdamDateKey(kickoff) !== dateISO) continue;

      const statusType = competition?.status?.type || event?.status?.type || {};
      const homeGoals = deps.toNumber(home?.score);
      const awayGoals = deps.toNumber(away?.score);
      let appStatusType = mapEspnStatus(statusType);
      const hasNumericScore = Number.isFinite(homeGoals) && Number.isFinite(awayGoals);
      const ageMs = Date.now() - kickoff.getTime();
      if (hasNumericScore && appStatusType === "notstarted") {
        if (ageMs > 130 * 60 * 1000) appStatusType = "finished";
        else if (ageMs > 0) appStatusType = "inprogress";
      }
      const scoreAvailable = Number.isFinite(homeGoals) && Number.isFinite(awayGoals) && appStatusType !== "notstarted";
      const minute = getEspnDisplayMinute(competition?.status || event?.status || {}, deps);

      fallbackEvents.push({
        id: `espn-${espnCode}-${event.id || `${dateISO}-${deps.normalizeName(homeName)}-${deps.normalizeName(awayName)}`}`,
        startTimestamp: Math.floor(kickoff.getTime() / 1000),
        homeTeam: {
          id: String(home?.team?.id || ""),
          name: homeName,
          country: { name: leagueInfo.country || "" },
          logoUrl: String(home?.team?.logo || ""),
        },
        awayTeam: {
          id: String(away?.team?.id || ""),
          name: awayName,
          country: { name: leagueInfo.country || "" },
          logoUrl: String(away?.team?.logo || ""),
        },
        uniqueTournament: { id: null, name: leagueInfo.name },
        tournament: {
          id: null,
          name: leagueInfo.name,
          category: { name: leagueInfo.country || "" },
          uniqueTournament: { id: null },
        },
        season: { id: event?.season?.year || null },
        status: {
          type: appStatusType,
          description: statusType.shortDetail || statusType.detail || statusType.description || "",
        },
        time: minute.current ? { current: minute.current, extra: minute.extra || 0 } : {},
        period: appStatusType === "halftime" ? "HT" : null,
        homeScore: scoreAvailable ? { current: homeGoals } : {},
        awayScore: scoreAvailable ? { current: awayGoals } : {},
        espnMeta: {
          code: espnCode,
          status: statusType.name || statusType.description || null,
          minute: minute.label,
        },
        source: "espn-scoreboard-fallback",
      });
    }
    await deps.sleep(20);
  }

  return fallbackEvents;
}

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}

export function parseSkySportsScheduledEventsHtml(html, dateISO, deps) {
  const events = [];
  const pattern = /data-component-name="ui-sport-match-score"[\s\S]*?data-state="([^"]+)"/g;
  for (const match of String(html || "").matchAll(pattern)) {
    let state;
    try {
      state = JSON.parse(decodeHtmlAttribute(match[1]));
    } catch {
      continue;
    }
    const competitionName = String(state?.competition?.name?.full || "").trim();
    const leagueLabel = deps.skyCompetitionToLabel?.[competitionName] || null;
    const homeName = String(state?.teams?.home?.name?.full || "").trim();
    const awayName = String(state?.teams?.away?.name?.full || "").trim();
    const time = String(state?.start?.time || "").trim();
    if (!leagueLabel || !homeName || !awayName || !/^\d{1,2}:\d{2}$/.test(time)) continue;
    if (deps.isWomenContext(leagueLabel, homeName, awayName) || deps.isYouthContext(leagueLabel, homeName, awayName)) continue;

    const leagueInfo = deps.leagues.find((item) => item.label === leagueLabel) || {
      label: leagueLabel,
      name: leagueLabel.split(" - ").at(-1),
      country: leagueLabel.split(" - ")[0],
      type: leagueLabel.includes("Europe -") ? "cup" : "league",
    };
    const kickoffIso = deps.buildFootballDataKickoffIso(dateISO, time);
    const homeGoals = Number(state?.teams?.home?.score?.current);
    const awayGoals = Number(state?.teams?.away?.score?.current);
    const statusShort = Array.isArray(state?.statusDescription?.short)
      ? state.statusDescription.short.join(" ")
      : String(state?.statusDescription?.short || "");
    const statusDescription = String(state?.statusDescription?.full || statusShort || "").trim();
    const scoreAvailable = Number.isFinite(homeGoals) && Number.isFinite(awayGoals);
    const finished = Boolean(state?.isResult || state?.matchState === "post" || /\b(?:FT|AET|PEN)\b/i.test(statusShort));
    const halftime = /\bHT\b|half.?time/i.test(`${statusShort} ${statusDescription}`);
    const live = !finished && Boolean(state?.currentlyPlaying || state?.isInPlay || state?.matchState === "live");
    const statusType = state?.isPostponed
      ? "postponed"
      : state?.isCancelled || state?.isAbandoned || state?.isSuspended
        ? "cancelled"
        : finished
          ? "finished"
          : halftime
            ? "halftime"
            : live
              ? "inprogress"
              : "notstarted";
    const publishScore = scoreAvailable && ["finished", "halftime", "inprogress"].includes(statusType);
    events.push({
      id: `sky-${state?.id || `${dateISO}-${deps.normalizeName(homeName)}-${deps.normalizeName(awayName)}`}`,
      startTimestamp: Math.floor(new Date(kickoffIso).getTime() / 1000),
      homeTeam: {
        id: state?.teams?.home?.id ? `sky-${state.teams.home.id}` : "",
        name: homeName,
        country: { name: leagueInfo.country || "" },
        logoUrl: String(state?.teams?.home?.badge || ""),
      },
      awayTeam: {
        id: state?.teams?.away?.id ? `sky-${state.teams.away.id}` : "",
        name: awayName,
        country: { name: leagueInfo.country || "" },
        logoUrl: String(state?.teams?.away?.badge || ""),
      },
      uniqueTournament: { id: null, name: leagueInfo.name },
      tournament: {
        id: null,
        name: leagueInfo.name,
        category: { name: leagueInfo.country || "" },
        uniqueTournament: { id: null },
      },
      season: { id: null },
      roundInfo: state?.competition?.round?.name?.full
        ? { name: state.competition.round.name.full, roundType: state.competition.round.name.full }
        : null,
      status: { type: statusType, description: statusDescription || (finished ? "FT" : "NS") },
      homeScore: publishScore ? { current: homeGoals } : {},
      awayScore: publishScore ? { current: awayGoals } : {},
      skyMeta: { matchId: state?.id || null, competition: competitionName },
      source: "sky-fixture-fallback",
    });
  }
  return events;
}

export async function fetchSkySportsScheduledEvents(dateISO, deps) {
  const html = await fetchText(`https://www.skysports.com/football-scores-fixtures/${dateISO}`);
  return html ? parseSkySportsScheduledEventsHtml(html, dateISO, deps) : [];
}

function isTrackedClubName(name, trackedTeamNames, normalizeName) {
  const normalized = normalizeName(name);
  if (!normalized) return false;
  const withoutPrefix = normalized.replace(/^(?:afc|ac|cf|fc|sc|vfl)\s+/, "");
  return trackedTeamNames.some((candidate) => {
    const tracked = normalizeName(candidate);
    if (!tracked) return false;
    const trackedWithoutPrefix = tracked.replace(/^(?:afc|ac|cf|fc|sc|vfl)\s+/, "");
    if (normalized === tracked || withoutPrefix === trackedWithoutPrefix) return true;
    return Math.min(withoutPrefix.length, trackedWithoutPrefix.length) >= 6 &&
      (withoutPrefix.includes(trackedWithoutPrefix) || trackedWithoutPrefix.includes(withoutPrefix));
  });
}

export function parseFotmobScheduledEvents(payload, dateISO, deps) {
  const trackedTeamNames = Array.isArray(deps.trackedTeamNames) ? deps.trackedTeamNames : [];
  const competitionById = new Map(
    Object.entries(deps.fotmobStandingLeagues || {}).map(([label, competition]) => [Number(competition?.id), label])
  );
  const competitionByName = new Map(
    Object.entries(deps.fotmobCompetitionToLabel || {}).map(([name, label]) => [deps.normalizeName(name), label])
  );
  const events = [];
  for (const league of Array.isArray(payload?.leagues) ? payload.leagues : []) {
    // Qualifying competitions receive a new FotMob id each season. Name routing
    // keeps those fixtures visible without weakening the tracked competition filter.
    const mappedLeagueLabel = competitionById.get(Number(league?.id)) ||
      competitionByName.get(deps.normalizeName(league?.name)) || null;
    const isFriendly = /club friendl/i.test(String(league?.name || ""));
    if (!mappedLeagueLabel && !isFriendly) continue;
    const leagueLabel = mappedLeagueLabel || "World - Club Friendlies";
    const countryName = mappedLeagueLabel ? mappedLeagueLabel.split(" - ")[0] : "World";
    for (const match of Array.isArray(league?.matches) ? league.matches : []) {
      const homeName = String(match?.home?.longName || match?.home?.name || "").trim();
      const awayName = String(match?.away?.longName || match?.away?.name || "").trim();
      if (!homeName || !awayName) continue;
      if (isFriendly && !isTrackedClubName(homeName, trackedTeamNames, deps.normalizeName) &&
          !isTrackedClubName(awayName, trackedTeamNames, deps.normalizeName)) continue;
      if (deps.isWomenContext(leagueLabel, homeName, awayName) ||
          deps.isYouthContext(leagueLabel, homeName, awayName)) continue;

      const kickoff = new Date(match?.status?.utcTime || Number(match?.timeTS || 0));
      if (!Number.isFinite(kickoff.getTime()) || deps.toAmsterdamDateKey(kickoff) !== dateISO) continue;
      const finished = Boolean(match?.status?.finished || Number(match?.statusId) === 6);
      const live = !finished && Boolean(match?.status?.started || match?.status?.ongoing);
      const cancelled = Boolean(match?.status?.cancelled);
      const statusType = cancelled ? "cancelled" : finished ? "finished" : live ? "inprogress" : "notstarted";
      const homeGoals = deps.toNumber(match?.home?.score);
      const awayGoals = deps.toNumber(match?.away?.score);
      const publishScore = Number.isFinite(homeGoals) && Number.isFinite(awayGoals) && (finished || live);
      const liveLabel = String(match?.status?.liveTime?.short || "").replace(/[^0-9+]/g, "");

      events.push({
        id: `fotmob-${match?.id || `${dateISO}-${deps.normalizeName(homeName)}-${deps.normalizeName(awayName)}`}`,
        leagueLabel,
        startTimestamp: Math.floor(kickoff.getTime() / 1000),
        homeTeam: {
          id: match?.home?.id ? `fotmob-${match.home.id}` : "",
          name: homeName,
          country: { name: countryName },
          logoUrl: match?.home?.id ? `https://images.fotmob.com/image_resources/logo/teamlogo/${match.home.id}.png` : "",
        },
        awayTeam: {
          id: match?.away?.id ? `fotmob-${match.away.id}` : "",
          name: awayName,
          country: { name: countryName },
          logoUrl: match?.away?.id ? `https://images.fotmob.com/image_resources/logo/teamlogo/${match.away.id}.png` : "",
        },
        uniqueTournament: { id: league?.id || null, name: league?.name || leagueLabel.split(" - ").slice(1).join(" - ") },
        tournament: {
          id: league?.id || null,
          name: league?.name || leagueLabel.split(" - ").slice(1).join(" - "),
          category: { name: countryName },
          uniqueTournament: { id: league?.id || null },
        },
        season: { id: null },
        status: { type: statusType, description: cancelled ? "Cancelled" : finished ? "FT" : live ? "LIVE" : "NS" },
        time: liveLabel ? { current: Number.parseInt(liveLabel, 10) || 0, extra: 0 } : {},
        homeScore: publishScore ? { current: homeGoals } : {},
        awayScore: publishScore ? { current: awayGoals } : {},
        fotmobMeta: { matchId: match?.id || null, leagueId: league?.id || null },
        source: "fotmob-fixture-fallback",
      });
    }
  }
  return events;
}

export async function fetchFotmobScheduledEvents(dateISO, deps) {
  const date = String(dateISO || "").replace(/-/g, "");
  try {
    const response = await fetchWithTimeout(`https://www.fotmob.com/api/data/matches?date=${date}`, {
      headers: {
        Accept: "application/json",
        Referer: "https://www.fotmob.com/",
        "User-Agent": DEFAULT_USER_AGENT,
      },
    }, 12000);
    if (!response.ok) return [];
    return parseFotmobScheduledEvents(await response.json(), dateISO, deps);
  } catch {
    return [];
  }
}

const espnTeamScheduleCache = new Map();

async function fetchEspnTeamSchedule(teamId, seasonYear) {
  const key = `${teamId}|${seasonYear}`;
  if (!espnTeamScheduleCache.has(key)) {
    espnTeamScheduleCache.set(
      key,
      fetchExternalJson(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/club.friendly/teams/${encodeURIComponent(teamId)}/schedule?season=${seasonYear}`
      ).catch(() => ({}))
    );
  }
  return espnTeamScheduleCache.get(key);
}

export async function fetchEspnTeamScheduleEvents(dateISO, deps) {
  const teamIds = [...new Set((deps.espnTeamIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  const seasonYear = Number(dateISO.slice(0, 4));
  const fallbackEvents = [];
  const seen = new Set();

  for (const teamId of teamIds) {
    const cacheKey = `${teamId}|${seasonYear}`;
    const wasCached = espnTeamScheduleCache.has(cacheKey);
    const json = await fetchEspnTeamSchedule(teamId, seasonYear);
    for (const event of Array.isArray(json?.events) ? json.events : []) {
      const competition = event?.competitions?.[0] || {};
      const kickoff = new Date(competition?.date || event?.date || "");
      if (!Number.isFinite(kickoff.getTime()) || deps.toAmsterdamDateKey(kickoff) !== dateISO) continue;

      const home = getEspnCompetitor(competition, "home");
      const away = getEspnCompetitor(competition, "away");
      const homeName = String(home?.team?.displayName || home?.team?.name || "").trim();
      const awayName = String(away?.team?.displayName || away?.team?.name || "").trim();
      if (!homeName || !awayName) continue;
      if (deps.isWomenContext("World - Club Friendlies", homeName, awayName) || deps.isYouthContext("World - Club Friendlies", homeName, awayName)) continue;

      const uniqueKey = String(event?.id || `${dateISO}-${deps.normalizeName(homeName)}-${deps.normalizeName(awayName)}`);
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);

      const statusType = competition?.status?.type || event?.status?.type || {};
      const homeGoals = deps.toNumber(home?.score?.value ?? home?.score);
      const awayGoals = deps.toNumber(away?.score?.value ?? away?.score);
      const appStatusType = mapEspnStatus(statusType);
      const scoreAvailable = Number.isFinite(homeGoals) && Number.isFinite(awayGoals) && appStatusType !== "notstarted";
      const minute = getEspnDisplayMinute(competition?.status || event?.status || {}, deps);

      fallbackEvents.push({
        id: `espn-team-club-friendly-${uniqueKey}`,
        startTimestamp: Math.floor(kickoff.getTime() / 1000),
        homeTeam: {
          id: String(home?.team?.id || ""),
          name: homeName,
          country: { name: "World" },
          logoUrl: getEspnTeamLogo(home?.team),
        },
        awayTeam: {
          id: String(away?.team?.id || ""),
          name: awayName,
          country: { name: "World" },
          logoUrl: getEspnTeamLogo(away?.team),
        },
        uniqueTournament: { id: null, name: "Club Friendlies" },
        tournament: {
          id: null,
          name: "Club Friendlies",
          category: { name: "World" },
          uniqueTournament: { id: null },
        },
        season: { id: seasonYear },
        status: {
          type: appStatusType,
          description: statusType.shortDetail || statusType.detail || statusType.description || "",
        },
        time: minute.current ? { current: minute.current, extra: minute.extra || 0 } : {},
        period: appStatusType === "halftime" ? "HT" : null,
        homeScore: scoreAvailable ? { current: homeGoals } : {},
        awayScore: scoreAvailable ? { current: awayGoals } : {},
        espnMeta: {
          code: "club.friendly",
          mode: "team-schedule",
          teamId,
          status: statusType.name || statusType.description || null,
          minute: minute.label,
        },
        source: "espn-team-schedule-fallback",
      });
    }
    if (!wasCached) await deps.sleep(20);
  }

  return fallbackEvents;
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
