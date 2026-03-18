#!/usr/bin/env node

import fs from "fs";
import path from "path";

const SOFA = "https://api.sofascore.com/api/v1";
const DATA_FILE = path.resolve(process.cwd(), "server_data.json");

const LEAGUES = [
  ["netherlands", "eredivisie", "Netherlands - Eredivisie"],
  ["netherlands", "eerste divisie", "Netherlands - Eerste Divisie"],
  ["england", "premier league", "England - Premier League"],
  ["england", "championship", "England - Championship"],
  ["germany", "bundesliga", "Germany - Bundesliga"],
  ["spain", "laliga", "Spain - LaLiga"],
  ["italy", "serie a", "Italy - Serie A"],
  ["france", "ligue 1", "France - Ligue 1"],
  ["belgium", "pro league", "Belgium - Pro League"],
  ["", "champions league", "Europe - Champions League"],
  ["", "europa league", "Europe - Europa League"],
  ["", "conference league", "Europe - Conference League"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const factorial = (n) => {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
};

const poisson = (lambda, k) => {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
};


async function safeFetch(url) {
  try {
    const r = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: "https://www.sofascore.com",
        Referer: "https://www.sofascore.com/",
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function getLeague(event) {
  const tournament = String(event?.tournament?.name || "").toLowerCase();
  const country = String(event?.tournament?.category?.name || "").toLowerCase();
  for (const [c, name, label] of LEAGUES) {
    if ((!c || country.includes(c)) && (tournament === name || tournament.includes(name))) return label;
  }
  return null;
}

function emptySplit() {
  return { games: 0, avgScored: 1.35, avgConceded: 1.35, bttsRate: 0.5, wins: 0, draws: 0, losses: 0 };
}

function finalizeSplit(s) {
  if (!s.games) return emptySplit();
  return {
    games: s.games,
    avgScored: Number((s.scored / s.games).toFixed(2)),
    avgConceded: Number((s.conceded / s.games).toFixed(2)),
    bttsRate: Number((s.btts / s.games).toFixed(2)),
    wins: s.wins,
    draws: s.draws,
    losses: s.losses,
  };
}

async function fetchTeamForm(teamId) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/events/last/0`);
  const events = (json?.events || []).filter((e) => e.status?.type === "finished").slice(-10);
  if (!events.length) return { form: "", avgScored: 1.35, avgConceded: 1.35, gamesPlayed: 0, splits: { home: emptySplit(), away: emptySplit() }, lastMatchKickoff: null };

  let form = "", scored = 0, conceded = 0;
  const split = {
    home: { games: 0, scored: 0, conceded: 0, btts: 0, wins: 0, draws: 0, losses: 0 },
    away: { games: 0, scored: 0, conceded: 0, btts: 0, wins: 0, draws: 0, losses: 0 },
  };

  for (const e of events) {
    const isHome = String(e.homeTeam?.id) === String(teamId);
    const gf = isHome ? e.homeScore?.current : e.awayScore?.current;
    const ga = isHome ? e.awayScore?.current : e.homeScore?.current;
    if (gf == null || ga == null) continue;
    scored += gf;
    conceded += ga;
    form += gf > ga ? "W" : gf === ga ? "D" : "L";
    const b = isHome ? split.home : split.away;
    b.games += 1; b.scored += gf; b.conceded += ga;
    if (gf > 0 && ga > 0) b.btts += 1;
    if (gf > ga) b.wins += 1; else if (gf === ga) b.draws += 1; else b.losses += 1;
  }

  return {
    form: form.slice(-5),
    avgScored: Number((scored / events.length).toFixed(2)),
    avgConceded: Number((conceded / events.length).toFixed(2)),
    gamesPlayed: events.length,
    wins: (form.match(/W/g) || []).length,
    draws: (form.match(/D/g) || []).length,
    losses: (form.match(/L/g) || []).length,
    splits: { home: finalizeSplit(split.home), away: finalizeSplit(split.away) },
    lastMatchKickoff: events[events.length - 1]?.startTimestamp ? new Date(events[events.length - 1].startTimestamp * 1000).toISOString() : null,
  };
}

async function fetchInjuries(teamId) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/players`);
  if (!json?.players) return { injuredCount: 0, injuredRating: 0, keyPlayersMissing: [] };
  const injured = json.players.filter((p) => p.player?.injured === true || p.status === "injured" || p.status === "doubtful");
  return {
    injuredCount: injured.length,
    injuredRating: Number(injured.reduce((t, p) => t + Math.max(0, Number(p.player?.rating || 6) - 6), 0).toFixed(2)),
    keyPlayersMissing: injured.map((p) => p.player?.name).filter(Boolean).slice(0, 3),
  };
}

async function fetchSeasonStats(teamId, tournamentId, seasonId) {
  if (!tournamentId || !seasonId) return null;
  const json = await safeFetch(`${SOFA}/team/${teamId}/unique-tournament/${tournamentId}/season/${seasonId}/statistics/overall`);
  const s = json?.statistics;
  if (!s) return null;
  return { avgShotsOn: s.averageShotsOnTarget || null, avgPossession: s.averageBallPossession || null, games: s.matches || null };
}

async function fetchH2H(eventId, currentHomeId, currentAwayId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/h2h`);
  const events = (json?.events || []).filter((e) => e.status?.type === "finished").slice(-8);
  if (!events.length) return null;
  let homeWins = 0, draws = 0, awayWins = 0;
  const results = [];
  for (const e of events) {
    const hg = e.homeScore?.current, ag = e.awayScore?.current;
    if (hg == null || ag == null) continue;
    const winner = hg === ag ? "" : hg > ag ? String(e.homeTeam?.id || "") : String(e.awayTeam?.id || "");
    if (hg === ag) draws += 1;
    else if (winner === String(currentHomeId || "")) homeWins += 1;
    else if (winner === String(currentAwayId || "")) awayWins += 1;
    results.push({ home: e.homeTeam?.name, away: e.awayTeam?.name, score: `${hg}-${ag}` });
  }
  return { played: results.length, homeWins, draws, awayWins, results };
}

async function fetchLineupSummary(eventId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/lineups`);
  if (!json) return null;
  const convert = (t) => {
    if (!t) return null;
    const starters = t.players?.filter((p) => p?.substitute === false) || [];
    return { formation: t.formation || null, starters: starters.length, confirmed: starters.length >= 10 };
  };
  const home = convert(json.home || json.homeTeam);
  const away = convert(json.away || json.awayTeam);
  if (!home && !away) return null;
  return { home, away, confirmed: !!(home?.confirmed && away?.confirmed) };
}

async function fetchEventDetails(eventId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}`);
  return json?.event || null;
}

function getCoords(eventDetails) {
  const v = eventDetails?.venue || {};
  const loc = v.location || v.coordinates || eventDetails?.venueCoordinates;
  if (!loc) return null;
  const lat = Number(loc.latitude ?? loc.lat);
  const lon = Number(loc.longitude ?? loc.lng ?? loc.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

async function fetchWeather(lat, lon, kickoffISO) {
  if (!kickoffISO) return null;
  const d = new Date(kickoffISO);
  const date = d.toISOString().split("T")[0];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,precipitation,windspeed_10m&timezone=auto&start_date=${date}&end_date=${date}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const times = j?.hourly?.time || [];
    if (!times.length) return null;
    let idx = 0, best = Infinity;
    for (let i = 0; i < times.length; i += 1) {
      const diff = Math.abs(new Date(times[i]).getTime() - d.getTime());
      if (diff < best) { best = diff; idx = i; }
    }
    const windSpeed = j.hourly.windspeed_10m?.[idx] ?? null;
    const precipitationProbability = j.hourly.precipitation_probability?.[idx] ?? null;
    const precipitation = j.hourly.precipitation?.[idx] ?? null;
    return {
      temperature: j.hourly.temperature_2m?.[idx] ?? null,
      windSpeed,
      precipitationProbability,
      precipitation,
      riskLevel: (Number(windSpeed || 0) >= 22 || Number(precipitationProbability || 0) >= 55) ? "medium" : "low",
    };
  } catch { return null; }
}

function calcRestDays(lastMatchKickoff, currentKickoff) {
  if (!lastMatchKickoff || !currentKickoff) return null;
  const diff = new Date(currentKickoff).getTime() - new Date(lastMatchKickoff).getTime();
  return diff > 0 ? Number((diff / 86400000).toFixed(1)) : null;
}

function predict(input) {
  const avgLeagueGoals = 1.35;
  const homeSplit = input.homeStats.splits?.home || emptySplit();
  const awaySplit = input.awayStats.splits?.away || emptySplit();
  let homeXG = avgLeagueGoals * 1.1 * ((input.homeStats.avgScored || 1.35) / avgLeagueGoals) * ((awaySplit.avgConceded || 1.35) / avgLeagueGoals);
  let awayXG = avgLeagueGoals * ((input.awayStats.avgScored || 1.35) / avgLeagueGoals) * ((homeSplit.avgConceded || 1.35) / avgLeagueGoals);
  if (input.homeSeasonStats?.avgShotsOn && input.awaySeasonStats?.avgShotsOn) {
    const avgShots = (input.homeSeasonStats.avgShotsOn + input.awaySeasonStats.avgShotsOn) / 2 || 1;
    homeXG *= clamp(input.homeSeasonStats.avgShotsOn / avgShots, 0.85, 1.15);
    awayXG *= clamp(input.awaySeasonStats.avgShotsOn / avgShots, 0.85, 1.15);
  }
  if (input.homeRestDays != null && input.awayRestDays != null) {
    const diff = input.homeRestDays - input.awayRestDays;
    homeXG *= clamp(1 + diff * 0.012, 0.94, 1.06);
    awayXG *= clamp(1 - diff * 0.012, 0.94, 1.06);
  }
  if (input.weather?.riskLevel === "medium") { homeXG *= 0.96; awayXG *= 0.96; }
  if (input.homeInjuries?.injuredCount) homeXG *= clamp(1 - input.homeInjuries.injuredCount * 0.025, 0.88, 1);
  if (input.awayInjuries?.injuredCount) awayXG *= clamp(1 - input.awayInjuries.injuredCount * 0.025, 0.88, 1);
  if (input.h2h?.played >= 4) {
    const balance = (input.h2h.homeWins - input.h2h.awayWins) / Math.max(input.h2h.played, 1);
    homeXG *= 1 + balance * 0.05; awayXG *= 1 - balance * 0.05;
  }
  homeXG = clamp(homeXG, 0.25, 3.5); awayXG = clamp(awayXG, 0.25, 3.5);

  const maxGoals = 6;
  let hp = 0, dp = 0, ap = 0, bestP = 0, bestScore = "1-1", over25 = 0, btts = 0;
  const scoreMatrix = {};
  for (let h = 0; h <= maxGoals; h += 1) {
    for (let a = 0; a <= maxGoals; a += 1) {
      const p = poisson(homeXG, h) * poisson(awayXG, a) * dixonColesAdjustment(h, a, homeXG, awayXG);
      if (h > a) hp += p; else if (h === a) dp += p; else ap += p;
      if (p > bestP) { bestP = p; bestScore = `${h}-${a}`; }
      if (h + a > 2.5) over25 += p;
      if (h > 0 && a > 0) btts += p;
      if (p > 0.01) scoreMatrix[`${h}-${a}`] = Number(p.toFixed(4));
    }
  }
  const total = hp + dp + ap; hp /= total; dp /= total; ap /= total;
  const [predHomeGoals, predAwayGoals] = bestScore.split("-").map(Number);
  return {
    homeProb: Number(hp.toFixed(4)),
    drawProb: Number(dp.toFixed(4)),
    awayProb: Number(ap.toFixed(4)),
    homeXG: Number(homeXG.toFixed(2)),
    awayXG: Number(awayXG.toFixed(2)),
    predHomeGoals,
    predAwayGoals,
    exactProb: Number(bestP.toFixed(4)),
    confidence: Number(Math.min(0.9, bestP * 3.5 + 0.18).toFixed(3)),
    over25: Number(over25.toFixed(3)),
    btts: Number(btts.toFixed(3)),
    scoreMatrix,
    modelEdges: {
      rest: input.homeRestDays != null && input.awayRestDays != null ? Number((input.homeRestDays - input.awayRestDays).toFixed(1)) : null,
      weatherRisk: input.weather?.riskLevel || "low",
      lineupConfirmed: !!input.lineupSummary?.confirmed,
    },
  };
}

function getTeam(storeTeams, id, name) {
  const key = id ? `id:${id}` : `name:${String(name || "").toLowerCase()}`;
  if (!storeTeams[key]) storeTeams[key] = { id: id || "", name, elo: 1500 };
  return storeTeams[key];
}

async function main() {
  let store = { teams: {}, predictions: {}, matches: {}, teamStats: {}, teamSeasonStats: {}, teamInjuries: {}, standings: {}, h2hCache: {}, weatherCache: {}, lastRun: null, workerVersion: "v2-free" };
  if (fs.existsSync(DATA_FILE)) {
    try { store = { ...store, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) }; } catch {}
  }

  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  const dates = [today, tomorrow];

  const allEvents = {};
  for (const date of dates) {
    const json = await safeFetch(`${SOFA}/sport/football/scheduled-events/${date}`);
    allEvents[date] = (json?.events || []).filter((e) => getLeague(e));
  }

  for (const date of dates) {
    const dayMatches = [];
    const dayPredictions = [];
    for (const event of allEvents[date]) {
      const league = getLeague(event);
      const homeId = String(event.homeTeam?.id || "");
      const awayId = String(event.awayTeam?.id || "");
      const homeName = event.homeTeam?.name || "Home";
      const awayName = event.awayTeam?.name || "Away";
      getTeam(store.teams, homeId, homeName);
      getTeam(store.teams, awayId, awayName);

      if (!store.teamStats[homeId]) store.teamStats[homeId] = await fetchTeamForm(homeId);
      if (!store.teamStats[awayId]) store.teamStats[awayId] = await fetchTeamForm(awayId);
      if (!store.teamInjuries[homeId]) store.teamInjuries[homeId] = await fetchInjuries(homeId);
      if (!store.teamInjuries[awayId]) store.teamInjuries[awayId] = await fetchInjuries(awayId);

      const tournamentId = event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id;
      const seasonId = event.season?.id;
      if (!store.teamSeasonStats[homeId]) store.teamSeasonStats[homeId] = await fetchSeasonStats(homeId, tournamentId, seasonId);
      if (!store.teamSeasonStats[awayId]) store.teamSeasonStats[awayId] = await fetchSeasonStats(awayId, tournamentId, seasonId);

      const kickoff = event.startTimestamp ? new Date(event.startTimestamp * 1000).toISOString() : null;
      const eventDetails = await fetchEventDetails(event.id);
      const coords = getCoords(eventDetails);
      const weather = coords ? await fetchWeather(coords.lat, coords.lon, kickoff) : null;
      const lineupSummary = await fetchLineupSummary(event.id);
      const h2h = await fetchH2H(event.id, homeId, awayId);

      const homeRestDays = calcRestDays(store.teamStats[homeId]?.lastMatchKickoff, kickoff);
      const awayRestDays = calcRestDays(store.teamStats[awayId]?.lastMatchKickoff, kickoff);

      const pred = predict({
        homeStats: store.teamStats[homeId],
        awayStats: store.teamStats[awayId],
        homeSeasonStats: store.teamSeasonStats[homeId],
        awaySeasonStats: store.teamSeasonStats[awayId],
        homeInjuries: store.teamInjuries[homeId],
        awayInjuries: store.teamInjuries[awayId],
        homeRestDays,
        awayRestDays,
        weather,
        lineupSummary,
        h2h,
      });

      const matchId = `ss-${event.id}`;
      dayMatches.push({
        id: matchId,
        sofaId: event.id,
        date,
        kickoff,
        league,
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeTeamName: homeName,
        awayTeamName: awayName,
        homeLogo: homeId ? `https://api.sofascore.app/api/v1/team/${homeId}/image` : "",
        awayLogo: awayId ? `https://api.sofascore.app/api/v1/team/${awayId}/image` : "",
        status: event.status?.type === "inprogress" ? "LIVE" : event.status?.type === "finished" ? "FT" : "NS",
        score: event.homeScore?.current != null && event.awayScore?.current != null ? `${event.homeScore.current}-${event.awayScore.current}` : null,
        minute: event.time?.current ? `${event.time.current}${event.time?.extra ? `+${event.time.extra}` : ""}'` : null,
        minuteValue: event.time?.current || null,
        extraTime: event.time?.extra || null,
        period: event.status?.description || null,
        liveUpdatedAt: event.status?.type === "inprogress" ? Date.now() : null,
        homeForm: store.teamStats[homeId]?.form || "",
        awayForm: store.teamStats[awayId]?.form || "",
        homeInjuries: store.teamInjuries[homeId],
        awayInjuries: store.teamInjuries[awayId],
        homeSeasonStats: store.teamSeasonStats[homeId],
        awaySeasonStats: store.teamSeasonStats[awayId],
        homeRecent: store.teamStats[homeId],
        awayRecent: store.teamStats[awayId],
        homeRestDays,
        awayRestDays,
        weather,
        lineupSummary,
        h2h,
        modelEdges: pred.modelEdges,
      });

      dayPredictions.push({
        matchId,
        homeTeam: homeName,
        awayTeam: awayName,
        league,
        homeForm: store.teamStats[homeId]?.form || "",
        awayForm: store.teamStats[awayId]?.form || "",
        homeRestDays,
        awayRestDays,
        weather,
        lineupSummary,
        h2h,
        ...pred,
      });

      await sleep(80);
    }
    store.matches[date] = dayMatches;
    store.predictions[date] = dayPredictions;
  }

  const liveJson = await safeFetch(`${SOFA}/sport/football/events/live`);
  for (const live of liveJson?.events || []) {
    const matchId = `ss-${live.id}`;
    const match = (store.matches[today] || []).find((m) => m.id === matchId);
    if (!match) continue;
    match.status = "LIVE";
    match.score = live.homeScore?.current != null && live.awayScore?.current != null ? `${live.homeScore.current}-${live.awayScore.current}` : match.score;
    match.minute = live.time?.current ? `${live.time.current}${live.time?.extra ? `+${live.time.extra}` : ""}'` : match.minute;
    match.minuteValue = live.time?.current || match.minuteValue || null;
    match.extraTime = live.time?.extra || null;
    match.period = live.status?.description || null;
    match.liveUpdatedAt = Date.now();
    match.liveStats = await fetchLiveStats(live.id);
    await sleep(50);
  }

  store.lastRun = Date.now();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

main();

