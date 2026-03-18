#!/usr/bin/env node

import fs from "fs";
import path from "path";

const SOFA = "https://api.sofascore.com/api/v1";
const DATA_FILE = path.resolve(process.cwd(), "server_data.json");

const LEAGUES = [
  { country: "netherlands", name: "eredivisie", label: "Netherlands - Eredivisie", type: "league" },
  { country: "netherlands", name: "eerste divisie", label: "Netherlands - Eerste Divisie", type: "league" },
  { country: "netherlands", name: "knvb beker", label: "Netherlands - KNVB Beker", type: "cup" },
  { country: "england", name: "premier league", label: "England - Premier League", type: "league" },
  { country: "england", name: "championship", label: "England - Championship", type: "league" },
  { country: "germany", name: "bundesliga", label: "Germany - Bundesliga", type: "league" },
  { country: "germany", name: "2. bundesliga", label: "Germany - 2. Bundesliga", type: "league" },
  { country: "spain", name: "laliga", label: "Spain - LaLiga", type: "league" },
  { country: "spain", name: "la liga", label: "Spain - LaLiga", type: "league" },
  { country: "spain", name: "laliga2", label: "Spain - LaLiga2", type: "league" },
  { country: "spain", name: "segunda", label: "Spain - LaLiga2", type: "league" },
  { country: "italy", name: "serie a", label: "Italy - Serie A", type: "league" },
  { country: "italy", name: "serie b", label: "Italy - Serie B", type: "league" },
  { country: "france", name: "ligue 1", label: "France - Ligue 1", type: "league" },
  { country: "france", name: "ligue 2", label: "France - Ligue 2", type: "league" },
  { country: "portugal", name: "liga portugal", label: "Portugal - Liga Portugal", type: "league" },
  { country: "portugal", name: "liga portugal 2", label: "Portugal - Liga Portugal 2", type: "league" },
  { country: "belgium", name: "pro league", label: "Belgium - Pro League", type: "league" },
  { country: "belgium", name: "challenger pro league", label: "Belgium - Challenger Pro League", type: "league" },
  { country: "", name: "champions league", label: "Europe - Champions League", type: "cup" },
  { country: "", name: "europa league", label: "Europe - Europa League", type: "cup" },
  { country: "", name: "conference league", label: "Europe - Conference League", type: "cup" },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const FORM_TTL = 6 * 60 * 60 * 1000;
const INJURY_TTL = 4 * 60 * 60 * 1000;
const SEASON_TTL = 12 * 60 * 60 * 1000;
const H2H_TTL = 3 * 24 * 60 * 60 * 1000;
const WEATHER_TTL = 6 * 60 * 60 * 1000;
const EVENT_TTL = 12 * 60 * 60 * 1000;
const CLUB_ELO_TTL = 12 * 60 * 60 * 1000;

process.on("unhandledRejection", (err) => {
  console.error("[worker] unhandledRejection:", err?.message || err);
});

process.on("uncaughtException", (err) => {
  console.error("[worker] uncaughtException:", err?.message || err);
});

function factorial(n) {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

function poisson(lambda, k) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function dixonColesAdjustment(h, a, homeXG, awayXG, rho = -0.13) {
  if (h === 0 && a === 0) return 1 - homeXG * awayXG * rho;
  if (h === 0 && a === 1) return 1 + homeXG * rho;
  if (h === 1 && a === 0) return 1 + awayXG * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

function parseMinuteFromDescription(description) {
  const text = String(description || "");
  const plus = text.match(/(\d+)\s*\+\s*(\d+)/);
  if (plus) return { current: Number(plus[1]), extra: Number(plus[2]) };

  const plain = text.match(/(\d+)/);
  if (plain) return { current: Number(plain[1]), extra: 0 };

  return null;
}

function resolveMinuteState(eventLike, eventDetails) {
  const period =
    eventLike?.status?.description ||
    eventDetails?.status?.description ||
    null;

  const parsed =
    parseMinuteFromDescription(period) ||
    parseMinuteFromDescription(eventDetails?.time?.injuryTime1) ||
    null;

  const current =
    Number(eventLike?.time?.current ?? eventDetails?.time?.current ?? parsed?.current ?? 0) || null;
  const extra =
    Number(eventLike?.time?.extra ?? eventDetails?.time?.extra ?? parsed?.extra ?? 0) || null;

  const periodText = String(period || "").toLowerCase();
  const minute =
    periodText.includes("half time") || periodText.includes("halftime") || periodText === "ht"
      ? "HT"
      : current
        ? `${current}${extra ? `+${extra}` : ""}'`
        : null;

  return {
    minute,
    minuteValue: current,
    extraTime: extra,
    period,
  };
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildPossibleNames(name) {
  const normalized = normalizeName(name);
  const variants = new Set([normalized]);
  if (normalized.includes("fc ")) variants.add(normalized.replace("fc ", "").trim());
  if (normalized.includes(" cf")) variants.add(normalized.replace(" cf", "").trim());
  if (normalized.includes(" afc")) variants.add(normalized.replace(" afc", "").trim());
  if (normalized.includes(" sc")) variants.add(normalized.replace(" sc", "").trim());
  if (normalized.includes(" ac")) variants.add(normalized.replace(" ac", "").trim());
  return [...variants].filter(Boolean);
}

function emptySplit() {
  return {
    games: 0,
    avgScored: 1.35,
    avgConceded: 1.35,
    bttsRate: 0.5,
    wins: 0,
    draws: 0,
    losses: 0,
    scoredTotal: 0,
    concededTotal: 0,
  };
}

function finalizeSplit(split) {
  if (!split.games) return emptySplit();
  return {
    games: split.games,
    avgScored: Number((split.scored / split.games).toFixed(2)),
    avgConceded: Number((split.conceded / split.games).toFixed(2)),
    bttsRate: Number((split.btts / split.games).toFixed(2)),
    wins: split.wins,
    draws: split.draws,
    losses: split.losses,
    scoredTotal: split.scored,
    concededTotal: split.conceded,
  };
}

function calcMatchImportance(homePos, awayPos, totalTeams) {
  if (!homePos || !awayPos || !totalTeams) return 1;

  const relegationStart = Math.max(totalTeams - 2, 1);
  const homePressure =
    homePos <= 3 || homePos >= relegationStart ? 1.08 : homePos <= 6 ? 1.03 : 1;
  const awayPressure =
    awayPos <= 3 || awayPos >= relegationStart ? 1.08 : awayPos <= 6 ? 1.03 : 1;

  return Number(Math.max(homePressure, awayPressure).toFixed(2));
}

async function safeFetch(url) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: "https://www.sofascore.com",
        Referer: "https://www.sofascore.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
      },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function safeFetchText(url) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/plain,text/csv,*/*",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/53736",
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function getLeagueInfo(event) {
  const tournament = String(
    event?.uniqueTournament?.name || event?.tournament?.name || ""
  ).toLowerCase();
  const country = String(event?.tournament?.category?.name || "").toLowerCase();
  return LEAGUES.find(
    (league) =>
      (!league.country || country.includes(league.country)) &&
      (tournament === league.name || tournament.includes(league.name))
  ) || null;
}

function deriveStandingMeta(label, rowsCount) {
  const rows = Number(rowsCount || 0);
  const zones = [];
  const notes = [];

  if (label.includes("Premier League") || label.includes("LaLiga") || label.includes("Serie A") || label.includes("Bundesliga") || label.includes("Ligue 1")) {
    zones.push(
      { key: "ucl", label: "Champions League", color: "blue", from: 1, to: 4 },
      { key: "europe", label: "Europees", color: "amber", from: 5, to: 6 },
      { key: "relegation", label: "Degradatie", color: "red", from: Math.max(rows - 2, 1), to: rows }
    );
  } else if (label.includes("Championship")) {
    zones.push(
      { key: "promotion", label: "Promotie", color: "blue", from: 1, to: 2 },
      { key: "playoffs", label: "Play-offs", color: "amber", from: 3, to: 6 },
      { key: "relegation", label: "Degradatie", color: "red", from: Math.max(rows - 2, 1), to: rows }
    );
    notes.push("Posities 3 tot en met 6 spelen promotie-play-offs.");
  } else if (label.includes("Eerste Divisie")) {
    zones.push(
      { key: "promotion", label: "Promotie", color: "blue", from: 1, to: 2 },
      { key: "period", label: "Play-off zone", color: "amber", from: 3, to: 8 }
    );
    notes.push("Eerste Divisie gebruikt periode- en play-offtickets.");
  } else if (label.includes("Eredivisie")) {
    zones.push(
      { key: "ucl", label: "Champions League", color: "blue", from: 1, to: 3 },
      { key: "playoffs", label: "Europees play-off", color: "amber", from: 4, to: 8 },
      { key: "relegation", label: "Degradatie / nacompetitie", color: "red", from: Math.max(rows - 2, 1), to: rows }
    );
  } else {
    zones.push(
      { key: "top", label: "Topzone", color: "blue", from: 1, to: Math.min(4, rows || 4) },
      { key: "bottom", label: "Gevarenzone", color: "red", from: Math.max(rows - 2, 1), to: rows || 1 }
    );
  }

  return {
    format: "league",
    zones,
    notes,
  };
}

function getZoneForPosition(meta, position) {
  if (!meta?.zones?.length || !position) return null;
  return meta.zones.find((zone) => position >= zone.from && position <= zone.to) || null;
}

async function fetchStandings(tournamentId, seasonId, label) {
  if (!tournamentId || !seasonId) return null;
  const json = await safeFetch(
    `${SOFA}/unique-tournament/${tournamentId}/season/${seasonId}/standings/total`
  );
  const rows = json?.standings?.[0]?.rows || [];
  if (!rows.length) return null;

  const mapped = rows.map((row) => ({
    pos: row.position,
    team: row.team?.name,
    teamId: String(row.team?.id || ""),
    p: row.matches,
    w: row.wins,
    d: row.draws,
    l: row.losses,
    gf: row.scoresFor,
    ga: row.scoresAgainst,
    pts: row.points,
  }));

  return {
    label,
    rows: mapped,
    updated: Date.now(),
    meta: deriveStandingMeta(label, mapped.length),
  };
}

async function fetchLiveStats(eventId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/statistics`);
  if (!json?.statistics) return null;

  const flat = {};
  for (const block of json.statistics) {
    for (const group of block.groups || []) {
      for (const item of group.statisticsItems || []) {
        const key = String(item.name || "")
          .toLowerCase()
          .replace(/\s+/g, "_");
        if (key) flat[key] = { home: item.home, away: item.away };
      }
    }
  }

  return {
    shots_on_target: flat.shots_on_target || flat.on_target || null,
    shots_total: flat.total_shots || flat.shots_total || null,
    possession: flat.ball_possession || null,
    corners: flat.corner_kicks || null,
    xg: flat.expected_goals || null,
  };
}

async function fetchTeamForm(teamId) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/events/last/0`);
  const finished = (json?.events || [])
    .filter((event) => event.status?.type === "finished")
    .sort((a, b) => Number(a.startTimestamp || 0) - Number(b.startTimestamp || 0));

  if (!finished.length) {
    return {
      form: "",
      avgScored: 1.35,
      avgConceded: 1.35,
      bttsRate: 0.5,
      gamesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      splits: { home: emptySplit(), away: emptySplit() },
      recentMatches: [],
      lastMatchKickoff: null,
      strongestSide: "balanced",
    };
  }

  const sample = finished.slice(-10);
  let form = "";
  let scored = 0;
  let conceded = 0;
  let btts = 0;
  const splitState = {
    home: { games: 0, scored: 0, conceded: 0, btts: 0, wins: 0, draws: 0, losses: 0 },
    away: { games: 0, scored: 0, conceded: 0, btts: 0, wins: 0, draws: 0, losses: 0 },
  };

  const recentMatches = sample.slice(-5).map((event) => {
    const isHome = String(event.homeTeam?.id || "") === String(teamId);
    const gf = isHome ? event.homeScore?.current : event.awayScore?.current;
    const ga = isHome ? event.awayScore?.current : event.homeScore?.current;
    const result = gf > ga ? "W" : gf === ga ? "D" : "L";
    return {
      date: event.startTimestamp
        ? new Date(event.startTimestamp * 1000).toISOString().split("T")[0]
        : null,
      eventId: event.id || null,
      league: event.tournament?.name || event.uniqueTournament?.name || null,
      tournamentId:
        event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id || event.tournament?.id || null,
      seasonId: event.season?.id || null,
      venue: isHome ? "H" : "A",
      opponent: isHome ? event.awayTeam?.name || "Opponent" : event.homeTeam?.name || "Opponent",
      opponentId: isHome ? String(event.awayTeam?.id || "") : String(event.homeTeam?.id || ""),
      score: gf != null && ga != null ? `${gf}-${ga}` : null,
      goalsFor: gf ?? null,
      goalsAgainst: ga ?? null,
      result,
    };
  });

  for (const event of sample) {
    const isHome = String(event.homeTeam?.id || "") === String(teamId);
    const gf = isHome ? event.homeScore?.current : event.awayScore?.current;
    const ga = isHome ? event.awayScore?.current : event.homeScore?.current;
    if (gf == null || ga == null) continue;

    scored += gf;
    conceded += ga;
    if (gf > 0 && ga > 0) btts += 1;
    form += gf > ga ? "W" : gf === ga ? "D" : "L";

    const target = isHome ? splitState.home : splitState.away;
    target.games += 1;
    target.scored += gf;
    target.conceded += ga;
    if (gf > 0 && ga > 0) target.btts += 1;
    if (gf > ga) target.wins += 1;
    else if (gf === ga) target.draws += 1;
    else target.losses += 1;
  }

  const homeSplit = finalizeSplit(splitState.home);
  const awaySplit = finalizeSplit(splitState.away);

  let strongestSide = "balanced";
  if (homeSplit.avgScored > awaySplit.avgScored + 0.25) strongestSide = "home";
  if (awaySplit.avgScored > homeSplit.avgScored + 0.25) strongestSide = "away";

  return {
    form: form.slice(-5),
    avgScored: Number((scored / sample.length).toFixed(2)),
    avgConceded: Number((conceded / sample.length).toFixed(2)),
    bttsRate: Number((btts / sample.length).toFixed(2)),
    gamesPlayed: sample.length,
    wins: (form.match(/W/g) || []).length,
    draws: (form.match(/D/g) || []).length,
    losses: (form.match(/L/g) || []).length,
    splits: { home: homeSplit, away: awaySplit },
    recentMatches,
    lastMatchKickoff: sample[sample.length - 1]?.startTimestamp
      ? new Date(sample[sample.length - 1].startTimestamp * 1000).toISOString()
      : null,
    strongestSide,
  };
}

async function fetchInjuries(teamId) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/players`);
  if (!json?.players) {
    return { injuredCount: 0, injuredRating: 0, keyPlayersMissing: [] };
  }

  const injured = json.players.filter(
    (player) =>
      player.player?.injured === true ||
      player.status === "injured" ||
      player.status === "doubtful"
  );

  return {
    injuredCount: injured.length,
    injuredRating: Number(
      injured.reduce(
        (total, player) => total + Math.max(0, Number(player.player?.rating || 6) - 6),
        0
      ).toFixed(2)
    ),
    keyPlayersMissing: injured
      .map((player) => player.player?.name)
      .filter(Boolean)
      .slice(0, 4),
  };
}

async function fetchSeasonStats(teamId, tournamentId, seasonId) {
  if (!tournamentId || !seasonId) return null;
  const json = await safeFetch(
    `${SOFA}/team/${teamId}/unique-tournament/${tournamentId}/season/${seasonId}/statistics/overall`
  );
  const stats = json?.statistics;
  if (!stats) return null;
  return {
    avgShotsOn: stats.averageShotsOnTarget || null,
    avgShots: stats.averageShots || null,
    avgPossession: stats.averageBallPossession || null,
    avgCorners: stats.averageCorners || null,
    cleanSheets: stats.cleanSheets || null,
    games: stats.matches || null,
  };
}

async function fetchEventDetails(eventId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}`);
  return json?.event || null;
}

async function fetchLineupSummary(eventId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/lineups`);
  if (!json) return null;

  const convert = (lineupTeam) => {
    if (!lineupTeam) return null;
    const starters = (lineupTeam.players || []).filter((player) => player?.substitute === false);
    const bench = (lineupTeam.players || []).filter((player) => player?.substitute === true);
    const rated = starters
      .map((player) => Number(player.player?.rating || player.rating || 0))
      .filter((rating) => rating > 0);
    return {
      formation: lineupTeam.formation || null,
      starters: starters.length,
      bench: bench.length,
      avgRating: rated.length
        ? Number((rated.reduce((sum, rating) => sum + rating, 0) / rated.length).toFixed(2))
        : null,
      confirmed: starters.length >= 10,
    };
  };

  const home = convert(json.home || json.homeTeam);
  const away = convert(json.away || json.awayTeam);
  if (!home && !away) return null;

  return {
    home,
    away,
    confirmed: !!(home?.confirmed && away?.confirmed),
  };
}

async function fetchH2H(eventId, currentHomeId, currentAwayId, tournamentId, seasonId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/h2h`);
  const raw = json?.events || [];

  const finished = raw
    .filter((event) => event.status?.type === "finished")
    .filter((event) => {
      if (!tournamentId || !seasonId) return true;
      const eventTournamentId =
        event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id || event.tournament?.id;
      const eventSeasonId = event.season?.id;
      return eventTournamentId === tournamentId && eventSeasonId === seasonId;
    })
    .sort((a, b) => Number(a.startTimestamp || 0) - Number(b.startTimestamp || 0))
    .slice(-8);

  if (!finished.length) {
    return { played: 0, homeWins: 0, draws: 0, awayWins: 0, results: [], status: "empty" };
  }

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  const results = [];

  for (const event of finished) {
    const homeGoals = event.homeScore?.current;
    const awayGoals = event.awayScore?.current;
    if (homeGoals == null || awayGoals == null) continue;

    const winnerId =
      homeGoals === awayGoals
        ? ""
        : homeGoals > awayGoals
          ? String(event.homeTeam?.id || "")
          : String(event.awayTeam?.id || "");

    if (homeGoals === awayGoals) draws += 1;
    else if (winnerId === String(currentHomeId || "")) homeWins += 1;
    else if (winnerId === String(currentAwayId || "")) awayWins += 1;

    results.push({
      eventId: event.id,
      date: event.startTimestamp
        ? new Date(event.startTimestamp * 1000).toISOString().split("T")[0]
        : null,
      tournamentId:
        event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id || event.tournament?.id || null,
      seasonId: event.season?.id || null,
      homeTeamId: String(event.homeTeam?.id || ""),
      awayTeamId: String(event.awayTeam?.id || ""),
      home: event.homeTeam?.name || "Home",
      away: event.awayTeam?.name || "Away",
      score: `${homeGoals}-${awayGoals}`,
      winnerId,
    });
  }

  return {
    played: results.length,
    homeWins,
    draws,
    awayWins,
    results,
    status: results.length ? "loaded" : "empty",
  };
}

function getCoords(eventDetails) {
  const venue = eventDetails?.venue || {};
  const loc = venue.location || venue.coordinates || eventDetails?.venueCoordinates;
  if (!loc) return null;
  const lat = Number(loc.latitude ?? loc.lat);
  const lon = Number(loc.longitude ?? loc.lng ?? loc.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

async function fetchWeather(lat, lon, kickoffISO) {
  if (!kickoffISO) return null;
  const kickoff = new Date(kickoffISO);
  const date = kickoff.toISOString().split("T")[0];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,precipitation,windspeed_10m&timezone=auto&start_date=${date}&end_date=${date}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const json = await response.json();
    const times = json?.hourly?.time || [];
    if (!times.length) return null;
    let bestIndex = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i += 1) {
      const diff = Math.abs(new Date(times[i]).getTime() - kickoff.getTime());
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    }

    const windSpeed = json.hourly.windspeed_10m?.[bestIndex] ?? null;
    const precipitationProbability = json.hourly.precipitation_probability?.[bestIndex] ?? null;
    const precipitation = json.hourly.precipitation?.[bestIndex] ?? null;

    return {
      temperature: json.hourly.temperature_2m?.[bestIndex] ?? null,
      windSpeed,
      precipitationProbability,
      precipitation,
      riskLevel:
        Number(windSpeed || 0) >= 28 || Number(precipitationProbability || 0) >= 70
          ? "high"
          : Number(windSpeed || 0) >= 20 || Number(precipitationProbability || 0) >= 50
            ? "medium"
            : "low",
    };
  } catch {
    return null;
  }
}

function calcRestDays(lastMatchKickoff, currentKickoff) {
  if (!lastMatchKickoff || !currentKickoff) return null;
  const diff = new Date(currentKickoff).getTime() - new Date(lastMatchKickoff).getTime();
  return diff > 0 ? Number((diff / 86400000).toFixed(1)) : null;
}

async function fetchClubEloSnapshot(dateISO) {
  const urls = [`https://api.clubelo.com/${dateISO}`, `http://api.clubelo.com/${dateISO}`];

  let text = null;
  for (const url of urls) {
    text = await safeFetchText(url);
    if (text) break;
  }

  if (!text) return null;
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const headers = lines[0].split(",");
  const clubIndex = headers.findIndex((header) => /club/i.test(header));
  const eloIndex = headers.findIndex((header) => /^elo$/i.test(header));
  if (clubIndex < 0 || eloIndex < 0) return null;

  const map = {};
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    const club = parts[clubIndex];
    const elo = Number(parts[eloIndex]);
    if (!club || !Number.isFinite(elo)) continue;
    for (const variant of buildPossibleNames(club)) {
      map[variant] = elo;
    }
  }

  return map;
}

function lookupClubElo(snapshot, teamName) {
  if (!snapshot) return null;
  for (const variant of buildPossibleNames(teamName)) {
    if (snapshot[variant] != null) return Number(snapshot[variant]);
  }
  return null;
}

function inferRivalry(homeName, awayName, homeCountry, awayCountry) {
  const home = normalizeName(homeName);
  const away = normalizeName(awayName);
  const rivalryPairs = [
    ["ajax", "feyenoord"],
    ["ajax", "psv"],
    ["feyenoord", "psv"],
    ["arsenal", "tottenham"],
    ["liverpool", "everton"],
    ["manchester united", "manchester city"],
    ["barcelona", "real madrid"],
    ["inter", "milan"],
    ["lazio", "roma"],
    ["celtic", "rangers"],
  ];

  for (const [a, b] of rivalryPairs) {
    if ((home.includes(a) && away.includes(b)) || (home.includes(b) && away.includes(a))) {
      return "rivaliteit";
    }
  }

  if (homeCountry && awayCountry && homeCountry === awayCountry) {
    const firstHomeWord = home.split(" ")[0];
    const firstAwayWord = away.split(" ")[0];
    if (firstHomeWord && firstAwayWord && firstHomeWord === firstAwayWord) {
      return "streekduel";
    }
  }

  return null;
}

function extractRoundLabel(eventDetails) {
  return (
    eventDetails?.roundInfo?.name ||
    eventDetails?.roundInfo?.roundType ||
    eventDetails?.roundInfo?.round ||
    eventDetails?.roundInfo?.cupRoundType ||
    null
  );
}

function buildAggregateInfo(event, eventDetails, h2h, fallbackPreviousLeg = null) {
  const results = h2h?.results || [];
  const currentEventId = Number(event.id || 0);
  const previousLeg = [...results]
    .filter((result) => Number(result.eventId || 0) !== currentEventId)
    .filter((result) => {
      const d = result.date ? new Date(result.date).getTime() : 0;
      const now = Number(event.startTimestamp || 0) * 1000;
      return d > 0 && now > 0 && now - d < 160 * 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0] || fallbackPreviousLeg;

  const label = String(
    eventDetails?.roundInfo?.cupRoundType ||
      eventDetails?.roundInfo?.name ||
      eventDetails?.roundInfo?.roundType ||
      ""
  ).toLowerCase();
  const isKnockoutHint =
    label.includes("round") ||
    label.includes("play") ||
    label.includes("quarter") ||
    label.includes("semi") ||
    label.includes("final") ||
    label.includes("knockout") ||
    label.includes("qualif");

  if (!previousLeg && !isKnockoutHint) return null;

  let firstLegHomeGoals = 0;
  let firstLegAwayGoals = 0;
  let firstLegText = null;
  if (previousLeg?.score) {
    const [prevHomeGoals, prevAwayGoals] = previousLeg.score.split("-").map(Number);
    if (!Number.isNaN(prevHomeGoals) && !Number.isNaN(prevAwayGoals)) {
      const currentHomeId = String(event.homeTeam?.id || "");
      if (String(previousLeg.homeTeamId || "") === currentHomeId) {
        firstLegHomeGoals = prevHomeGoals;
        firstLegAwayGoals = prevAwayGoals;
      } else if (String(previousLeg.awayTeamId || "") === currentHomeId) {
        firstLegHomeGoals = prevAwayGoals;
        firstLegAwayGoals = prevHomeGoals;
      }
      firstLegText = `${previousLeg.home} ${previousLeg.score} ${previousLeg.away}`;
    }
  }

  const currentHomeGoals = Number(event.homeScore?.current || 0);
  const currentAwayGoals = Number(event.awayScore?.current || 0);
  const homeAggregate = firstLegHomeGoals + currentHomeGoals;
  const awayAggregate = firstLegAwayGoals + currentAwayGoals;
  const leader =
    homeAggregate === awayAggregate
      ? null
      : homeAggregate > awayAggregate
        ? event.homeTeam?.name || null
        : event.awayTeam?.name || null;

  return {
    active: !!previousLeg || isKnockoutHint,
    firstLegScore: previousLeg?.score || null,
    firstLegText,
    aggregateScore: `${homeAggregate}-${awayAggregate}`,
    homeAggregate,
    awayAggregate,
    currentHomeGoals,
    currentAwayGoals,
    leader,
    roundLabel: extractRoundLabel(eventDetails),
    note:
      leader && (currentHomeGoals > 0 || currentAwayGoals > 0 || previousLeg)
        ? `${leader} ligt voor in het tweeluik`
        : "Tweeluik / knock-out context",
  };
}

function buildContext(matchInput) {
  const homeZone = getZoneForPosition(matchInput.standingMeta, matchInput.homePos);
  const awayZone = getZoneForPosition(matchInput.standingMeta, matchInput.awayPos);
  const rivalry = inferRivalry(
    matchInput.homeTeamName,
    matchInput.awayTeamName,
    matchInput.homeCountry,
    matchInput.awayCountry
  );

  const notes = [];
  if (homeZone?.key === "relegation" || awayZone?.key === "relegation") notes.push("degradatiedruk");
  if (homeZone?.key === "ucl" || awayZone?.key === "ucl" || homeZone?.key === "promotion" || awayZone?.key === "promotion") notes.push("topstrijd");
  if (homeZone?.key === "playoffs" || awayZone?.key === "playoffs" || homeZone?.key === "period" || awayZone?.key === "period") notes.push("play-off druk");
  if (matchInput.aggregate?.active) notes.push("tweeluik");
  if (matchInput.leagueType === "cup") notes.push("knock-out");
  if (rivalry) notes.push(rivalry);

  return {
    homeZone: homeZone?.label || null,
    awayZone: awayZone?.label || null,
    rivalry,
    summary: notes.length ? notes.join(" · ") : null,
    stakes:
      notes.length > 0
        ? notes.join(", ")
        : matchInput.homePos && matchInput.awayPos
          ? `stand posities ${matchInput.homePos} en ${matchInput.awayPos}`
          : null,
  };
}

function pickHomeStrength(homeRecent) {
  const split = homeRecent?.splits?.home || emptySplit();
  return split.games > 0 ? split : emptySplit();
}

function pickAwayStrength(awayRecent) {
  const split = awayRecent?.splits?.away || emptySplit();
  return split.games > 0 ? split : emptySplit();
}

function buildHomeAwayEdge(homeRecent, awayRecent) {
  const home = pickHomeStrength(homeRecent);
  const away = pickAwayStrength(awayRecent);
  return Number(((home.avgScored - away.avgConceded) + (away.avgScored - home.avgConceded)).toFixed(2));
}

function findPreviousLegFromRecent(
  homeRecent,
  awayRecent,
  currentHomeId,
  currentAwayId,
  currentHomeName,
  currentAwayName,
  tournamentId,
  seasonId,
  currentEventId
) {
  const combined = [
    ...(homeRecent?.recentMatches || []),
    ...(awayRecent?.recentMatches || []),
  ];

  const homeNameNorm = normalizeName(currentHomeName);
  const awayNameNorm = normalizeName(currentAwayName);

  const match = combined.find((item) => {
    if (String(item.eventId || "") === String(currentEventId || "")) return false;
    if (tournamentId && item.tournamentId && item.tournamentId !== tournamentId) return false;
    if (seasonId && item.seasonId && item.seasonId !== seasonId) return false;
    const opponentIdMatch =
      String(item.opponentId || "") === String(currentAwayId || "") ||
      String(item.opponentId || "") === String(currentHomeId || "");
    const opponentNameNorm = normalizeName(item.opponent || "");
    const opponentNameMatch =
      opponentNameNorm === homeNameNorm || opponentNameNorm === awayNameNorm;
    return (
      opponentIdMatch || opponentNameMatch
    );
  });

  if (!match?.score) return null;

  const [goalsFor, goalsAgainst] = String(match.score).split("-").map(Number);
  if (Number.isNaN(goalsFor) || Number.isNaN(goalsAgainst)) return null;

  const currentHomeWasHome = String(match.opponentId || "") === String(currentAwayId || "");
  const homeTeamId = currentHomeWasHome ? String(currentHomeId || "") : String(currentAwayId || "");
  const awayTeamId = currentHomeWasHome ? String(currentAwayId || "") : String(currentHomeId || "");
  const home = currentHomeWasHome ? currentHomeName : currentAwayName;
  const away = currentHomeWasHome ? currentAwayName : currentHomeName;

  return {
    eventId: match.eventId || null,
    date: match.date || null,
    homeTeamId,
    awayTeamId,
    home,
    away,
    score: `${goalsFor}-${goalsAgainst}`,
  };
}

function predict(input) {
  const avgLeagueGoals = 1.35;
  const homeSplit = pickHomeStrength(input.homeRecent);
  const awaySplit = pickAwayStrength(input.awayRecent);

  let homeXG =
    avgLeagueGoals *
    1.11 *
    clamp((input.homeRecent?.avgScored || avgLeagueGoals) / avgLeagueGoals, 0.7, 1.6) *
    clamp((awaySplit.avgConceded || avgLeagueGoals) / avgLeagueGoals, 0.75, 1.5);

  let awayXG =
    avgLeagueGoals *
    clamp((input.awayRecent?.avgScored || avgLeagueGoals) / avgLeagueGoals, 0.7, 1.6) *
    clamp((homeSplit.avgConceded || avgLeagueGoals) / avgLeagueGoals, 0.75, 1.5);

  const homeClubElo = Number(input.homeClubElo || 0);
  const awayClubElo = Number(input.awayClubElo || 0);
  if (homeClubElo > 0 && awayClubElo > 0) {
    const eloDiff = homeClubElo - awayClubElo;
    homeXG *= clamp(1 + eloDiff / 1600, 0.9, 1.14);
    awayXG *= clamp(1 - eloDiff / 1600, 0.9, 1.14);
  }

  if (input.homeSeasonStats?.avgShotsOn && input.awaySeasonStats?.avgShotsOn) {
    const averageShots =
      (Number(input.homeSeasonStats.avgShotsOn || 0) + Number(input.awaySeasonStats.avgShotsOn || 0)) / 2 || 1;
    homeXG *= clamp(Number(input.homeSeasonStats.avgShotsOn || 0) / averageShots, 0.88, 1.14);
    awayXG *= clamp(Number(input.awaySeasonStats.avgShotsOn || 0) / averageShots, 0.88, 1.14);
  }

  if (input.homeRestDays != null && input.awayRestDays != null) {
    const diff = Number(input.homeRestDays) - Number(input.awayRestDays);
    homeXG *= clamp(1 + diff * 0.012, 0.93, 1.08);
    awayXG *= clamp(1 - diff * 0.012, 0.93, 1.08);
  }

  if (input.weather?.riskLevel === "medium") {
    homeXG *= 0.97;
    awayXG *= 0.97;
  }
  if (input.weather?.riskLevel === "high") {
    homeXG *= 0.93;
    awayXG *= 0.93;
  }

  if (input.homeInjuries?.injuredCount) {
    homeXG *= clamp(1 - Number(input.homeInjuries.injuredCount) * 0.025, 0.85, 1);
  }
  if (input.awayInjuries?.injuredCount) {
    awayXG *= clamp(1 - Number(input.awayInjuries.injuredCount) * 0.025, 0.85, 1);
  }

  if (input.lineupSummary?.confirmed) {
    const homeRating = Number(input.lineupSummary.home?.avgRating || 6.8);
    const awayRating = Number(input.lineupSummary.away?.avgRating || 6.8);
    const diff = homeRating - awayRating;
    homeXG *= clamp(1 + diff * 0.02, 0.94, 1.08);
    awayXG *= clamp(1 - diff * 0.02, 0.94, 1.08);
  }

  if (input.h2h?.played >= 3) {
    const balance = (Number(input.h2h.homeWins || 0) - Number(input.h2h.awayWins || 0)) / Math.max(Number(input.h2h.played || 1), 1);
    homeXG *= clamp(1 + balance * 0.05, 0.92, 1.08);
    awayXG *= clamp(1 - balance * 0.05, 0.92, 1.08);
  }

  if (input.matchImportance && input.matchImportance > 1) {
    homeXG *= clamp(input.matchImportance, 1, 1.08);
    awayXG *= clamp(input.matchImportance, 1, 1.08);
  }

  homeXG = clamp(homeXG, 0.22, 3.8);
  awayXG = clamp(awayXG, 0.22, 3.8);

  let homeProb = 0;
  let drawProb = 0;
  let awayProb = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let btts = 0;
  let bestScore = "1-1";
  let bestProb = 0;
  const scoreMatrix = {};

  for (let homeGoals = 0; homeGoals <= 6; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 6; awayGoals += 1) {
      const probability =
        poisson(homeXG, homeGoals) *
        poisson(awayXG, awayGoals) *
        dixonColesAdjustment(homeGoals, awayGoals, homeXG, awayXG);

      if (homeGoals > awayGoals) homeProb += probability;
      else if (homeGoals === awayGoals) drawProb += probability;
      else awayProb += probability;

      if (probability > bestProb) {
        bestProb = probability;
        bestScore = `${homeGoals}-${awayGoals}`;
      }

      const totalGoals = homeGoals + awayGoals;
      if (totalGoals > 1.5) over15 += probability;
      if (totalGoals > 2.5) over25 += probability;
      if (totalGoals > 3.5) over35 += probability;
      if (homeGoals > 0 && awayGoals > 0) btts += probability;
      if (probability > 0.01) scoreMatrix[`${homeGoals}-${awayGoals}`] = Number(probability.toFixed(4));
    }
  }

  const totalProb = homeProb + drawProb + awayProb;
  homeProb /= totalProb;
  drawProb /= totalProb;
  awayProb /= totalProb;

  const [predHomeGoals, predAwayGoals] = bestScore.split("-").map(Number);
  const homeAwayEdge = buildHomeAwayEdge(input.homeRecent, input.awayRecent);

  return {
    homeProb: Number(homeProb.toFixed(4)),
    drawProb: Number(drawProb.toFixed(4)),
    awayProb: Number(awayProb.toFixed(4)),
    homeXG: Number(homeXG.toFixed(2)),
    awayXG: Number(awayXG.toFixed(2)),
    predHomeGoals,
    predAwayGoals,
    exactProb: Number(bestProb.toFixed(4)),
    confidence: Number(Math.min(0.92, bestProb * 3.5 + 0.22).toFixed(3)),
    over15: Number(over15.toFixed(3)),
    over25: Number(over25.toFixed(3)),
    over35: Number(over35.toFixed(3)),
    btts: Number(btts.toFixed(3)),
    scoreMatrix,
    modelEdges: {
      rest: input.homeRestDays != null && input.awayRestDays != null
        ? Number((Number(input.homeRestDays) - Number(input.awayRestDays)).toFixed(1))
        : null,
      weatherRisk: input.weather?.riskLevel || "low",
      lineupConfirmed: !!input.lineupSummary?.confirmed,
      homeAwayEdge,
      clubEloDiff: homeClubElo > 0 && awayClubElo > 0 ? Math.round(homeClubElo - awayClubElo) : null,
      stakes: input.context?.summary || null,
      matchImportance: input.matchImportance || 1,
    },
    matchImportance: input.matchImportance || 1,
  };
}

function getTeam(storeTeams, id, name) {
  const key = id ? `id:${id}` : `name:${normalizeName(name)}`;
  if (!storeTeams[key]) {
    storeTeams[key] = { id: id || "", name: name || "Unknown", elo: 1500 };
  }
  storeTeams[key].name = name || storeTeams[key].name;
  if (id) storeTeams[key].id = id;
  return storeTeams[key];
}

function defaultStore() {
  return {
    teams: {},
    predictions: {},
    matches: {},
    standings: {},
    knockoutOverview: {},
    cupSheets: {},
    teamStats: {},
    teamStatsUpdated: {},
    teamInjuries: {},
    teamInjuriesUpdated: {},
    teamSeasonStats: {},
    teamSeasonStatsUpdated: {},
    eventCache: {},
    eventCacheUpdated: {},
    h2hCache: {},
    weatherCache: {},
    clubEloCache: null,
    clubEloUpdated: null,
    lastRun: null,
    workerVersion: "v3-rich",
  };
}

async function main() {
  let store = defaultStore();
  if (fs.existsSync(DATA_FILE)) {
    try {
      store = { ...store, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) };
    } catch {
      console.warn("[worker] kon server_data.json niet lezen, start leeg");
    }
  }

  const now = Date.now();
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  const dates = [today, tomorrow];

  if (!store.knockoutOverview) store.knockoutOverview = {};
  if (!store.cupSheets) store.cupSheets = {};
  for (const date of dates) store.knockoutOverview[date] = [];
  store.cupSheets = {};

  let clubEloSnapshot = store.clubEloCache;
  if (!clubEloSnapshot || !store.clubEloUpdated || now - store.clubEloUpdated > CLUB_ELO_TTL) {
    clubEloSnapshot = await fetchClubEloSnapshot(today);
    if (clubEloSnapshot) {
      store.clubEloCache = clubEloSnapshot;
      store.clubEloUpdated = now;
    }
  }

  const allEvents = {};
  const teamTournamentMap = new Map();
  const tournamentsMap = new Map();
  const requiredTeamIds = new Set();

  for (const date of dates) {
    const json = await safeFetch(`${SOFA}/sport/football/scheduled-events/${date}`);
    const events = (json?.events || []).filter((event) => getLeagueInfo(event));
    allEvents[date] = events;

    for (const event of events) {
      const leagueInfo = getLeagueInfo(event);
      const homeId = String(event.homeTeam?.id || "");
      const awayId = String(event.awayTeam?.id || "");
      const tournamentId =
        event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id || event.tournament?.id || null;
      const seasonId = event.season?.id || null;

      if (homeId) requiredTeamIds.add(homeId);
      if (awayId) requiredTeamIds.add(awayId);
      if (homeId && tournamentId && seasonId) teamTournamentMap.set(homeId, { tournamentId, seasonId });
      if (awayId && tournamentId && seasonId) teamTournamentMap.set(awayId, { tournamentId, seasonId });
      if (tournamentId && seasonId && leagueInfo) {
        tournamentsMap.set(`${tournamentId}_${seasonId}`, { tournamentId, seasonId, label: leagueInfo.label });
      }
    }
  }

  for (const teamId of requiredTeamIds) {
    if (!store.teamStats[teamId] || now - Number(store.teamStatsUpdated?.[teamId] || 0) > FORM_TTL) {
      store.teamStats[teamId] = await fetchTeamForm(teamId);
      store.teamStatsUpdated[teamId] = now;
      await sleep(90);
    }
    if (!store.teamInjuries[teamId] || now - Number(store.teamInjuriesUpdated?.[teamId] || 0) > INJURY_TTL) {
      store.teamInjuries[teamId] = await fetchInjuries(teamId);
      store.teamInjuriesUpdated[teamId] = now;
      await sleep(70);
    }
    const seasonInfo = teamTournamentMap.get(teamId);
    if (
      seasonInfo &&
      (!store.teamSeasonStats[teamId] || now - Number(store.teamSeasonStatsUpdated?.[teamId] || 0) > SEASON_TTL)
    ) {
      store.teamSeasonStats[teamId] = await fetchSeasonStats(teamId, seasonInfo.tournamentId, seasonInfo.seasonId);
      store.teamSeasonStatsUpdated[teamId] = now;
      await sleep(70);
    }
  }

  const standingsByTournament = {};
  for (const [key, info] of tournamentsMap.entries()) {
    const cached = store.standings[key];
    if (cached?.rows?.length && now - Number(cached.updated || 0) <= SEASON_TTL) {
      standingsByTournament[key] = cached;
      continue;
    }
    const fresh = await fetchStandings(info.tournamentId, info.seasonId, info.label);
    if (fresh) {
      store.standings[key] = fresh;
      standingsByTournament[key] = fresh;
      await sleep(60);
    }
  }

  for (const date of dates) {
    const dayMatches = [];
    const dayPredictions = [];

    for (const event of allEvents[date] || []) {
      const leagueInfo = getLeagueInfo(event);
      if (!leagueInfo) continue;

      const homeId = String(event.homeTeam?.id || "");
      const awayId = String(event.awayTeam?.id || "");
      const homeName = event.homeTeam?.name || "Home";
      const awayName = event.awayTeam?.name || "Away";
      const homeCountry = String(event.homeTeam?.country?.name || event.tournament?.category?.name || "");
      const awayCountry = String(event.awayTeam?.country?.name || event.tournament?.category?.name || "");
      const kickoff = event.startTimestamp ? new Date(event.startTimestamp * 1000).toISOString() : null;
      const tournamentId =
        event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id || event.tournament?.id || null;
      const seasonId = event.season?.id || null;
      const standingsKey = tournamentId && seasonId ? `${tournamentId}_${seasonId}` : "";
      const standing = standingsByTournament[standingsKey] || store.standings[standingsKey] || null;
      const standingMeta = standing?.meta || null;
      const homePos = standing?.rows?.find((row) => String(row.teamId || "") === homeId)?.pos ?? null;
      const awayPos = standing?.rows?.find((row) => String(row.teamId || "") === awayId)?.pos ?? null;

      getTeam(store.teams, homeId, homeName);
      getTeam(store.teams, awayId, awayName);

      let eventDetails = store.eventCache?.[event.id] || null;
      if (!eventDetails || now - Number(store.eventCacheUpdated?.[event.id] || 0) > EVENT_TTL) {
        eventDetails = await fetchEventDetails(event.id);
        if (eventDetails) {
          store.eventCache[event.id] = eventDetails;
          store.eventCacheUpdated[event.id] = now;
        }
        await sleep(60);
      }

      const lineupSummary = await fetchLineupSummary(event.id);

      const h2hKey = `${event.id}_${homeId}_${awayId}`;
      let h2h = store.h2hCache?.[h2hKey]?.data || null;
      if (!h2h || now - Number(store.h2hCache?.[h2hKey]?.updated || 0) > H2H_TTL) {
        h2h = await fetchH2H(event.id, homeId, awayId, tournamentId, seasonId);
        store.h2hCache[h2hKey] = { updated: now, data: h2h };
        await sleep(60);
      }

      const coords = getCoords(eventDetails);
      const weatherKey = coords && kickoff ? `${coords.lat.toFixed(2)}_${coords.lon.toFixed(2)}_${kickoff.slice(0, 13)}` : null;
      let weather = weatherKey ? store.weatherCache?.[weatherKey]?.data || null : null;
      if (weatherKey && (!weather || now - Number(store.weatherCache?.[weatherKey]?.updated || 0) > WEATHER_TTL)) {
        weather = await fetchWeather(coords.lat, coords.lon, kickoff);
        if (!store.weatherCache) store.weatherCache = {};
        store.weatherCache[weatherKey] = { updated: now, data: weather };
      }

      const homeRecent = store.teamStats[homeId] || null;
      const awayRecent = store.teamStats[awayId] || null;
      const fallbackPreviousLeg = findPreviousLegFromRecent(
        homeRecent,
        awayRecent,
        homeId,
        awayId,
        homeName,
        awayName,
        tournamentId,
        seasonId,
        event.id
      );
      if ((!h2h || !h2h.played) && fallbackPreviousLeg) {
        h2h = {
          played: 1,
          homeWins: 0,
          draws: 0,
          awayWins: 0,
          results: [fallbackPreviousLeg],
          status: "fallback",
        };
      } else if (fallbackPreviousLeg && !String(JSON.stringify(h2h?.results || [])).includes(String(fallbackPreviousLeg.score))) {
        h2h = {
          ...(h2h || {}),
          results: [...(h2h?.results || []), fallbackPreviousLeg],
          played: Number(h2h?.played || 0) + 1,
          status: h2h?.status || "loaded",
        };
      }
      const aggregate = buildAggregateInfo(event, eventDetails, h2h, fallbackPreviousLeg);
      const homeRestDays = calcRestDays(homeRecent?.lastMatchKickoff, kickoff);
      const awayRestDays = calcRestDays(awayRecent?.lastMatchKickoff, kickoff);
      const matchImportance = calcMatchImportance(homePos, awayPos, standing?.rows?.length || 20);
      const context = buildContext({
        standingMeta,
        homePos,
        awayPos,
        leagueType: leagueInfo.type,
        aggregate,
        homeTeamName: homeName,
        awayTeamName: awayName,
        homeCountry,
        awayCountry,
      });

      const homeClubElo = lookupClubElo(clubEloSnapshot, homeName);
      const awayClubElo = lookupClubElo(clubEloSnapshot, awayName);

      const minuteState = resolveMinuteState(event, eventDetails);

      const prediction = predict({
        homeRecent,
        awayRecent,
        homeSeasonStats: store.teamSeasonStats[homeId] || null,
        awaySeasonStats: store.teamSeasonStats[awayId] || null,
        homeInjuries: store.teamInjuries[homeId] || null,
        awayInjuries: store.teamInjuries[awayId] || null,
        homeRestDays,
        awayRestDays,
        weather,
        lineupSummary,
        h2h,
        homeClubElo,
        awayClubElo,
        context,
        matchImportance,
      });

      const matchId = `ss-${event.id}`;
      const score =
        event.homeScore?.current != null && event.awayScore?.current != null
          ? `${event.homeScore.current}-${event.awayScore.current}`
          : null;
      const match = {
        id: matchId,
        sofaId: event.id,
        date,
        kickoff,
        league: leagueInfo.label,
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeTeamName: homeName,
        awayTeamName: awayName,
        homeLogo: homeId ? `https://api.sofascore.app/api/v1/team/${homeId}/image` : "",
        awayLogo: awayId ? `https://api.sofascore.app/api/v1/team/${awayId}/image` : "",
        status: event.status?.type === "inprogress" ? "LIVE" : event.status?.type === "finished" ? "FT" : "NS",
        score,
        minute: minuteState.minute,
        minuteValue: minuteState.minuteValue,
        extraTime: minuteState.extraTime,
        period: minuteState.period,
        liveUpdatedAt: event.status?.type === "inprogress" ? now : null,
        homeForm: homeRecent?.form || "",
        awayForm: awayRecent?.form || "",
        homeRecent,
        awayRecent,
        homeSeasonStats: store.teamSeasonStats[homeId] || null,
        awaySeasonStats: store.teamSeasonStats[awayId] || null,
        homeInjuries: store.teamInjuries[homeId] || null,
        awayInjuries: store.teamInjuries[awayId] || null,
        homeRestDays,
        awayRestDays,
        weather,
        lineupSummary,
        h2h,
        h2hStatus: h2h?.status || "empty",
        aggregate,
        homeClubElo,
        awayClubElo,
        homePos,
        awayPos,
        matchImportance,
        roundLabel: extractRoundLabel(eventDetails),
        context,
        modelEdges: prediction.modelEdges,
      };

      dayMatches.push(match);
      dayPredictions.push({
        matchId,
        homeTeam: homeName,
        awayTeam: awayName,
        league: leagueInfo.label,
        homeForm: homeRecent?.form || "",
        awayForm: awayRecent?.form || "",
        homeRestDays,
        awayRestDays,
        weather,
        lineupSummary,
        h2h,
        h2hStatus: h2h?.status || "empty",
        aggregate,
        context,
        homeClubElo,
        awayClubElo,
        matchImportance,
        ...prediction,
      });

      if (leagueInfo.type === "cup" || aggregate?.active || context.summary?.includes("play-off")) {
        const knockoutItem = {
          league: leagueInfo.label,
          roundLabel: extractRoundLabel(eventDetails),
          stakes: context.stakes,
          matchId,
          kickoff,
          homeTeamName: homeName,
          awayTeamName: awayName,
          aggregate,
          score,
          status: event.status?.type === "inprogress" ? "LIVE" : event.status?.type === "finished" ? "FT" : "NS",
        };

        store.knockoutOverview[date].push(knockoutItem);

        if (!store.cupSheets[leagueInfo.label]) {
          store.cupSheets[leagueInfo.label] = {
            league: leagueInfo.label,
            rounds: {},
          };
        }
        const roundKey = String(extractRoundLabel(eventDetails) || "Knock-out");
        if (!store.cupSheets[leagueInfo.label].rounds[roundKey]) {
          store.cupSheets[leagueInfo.label].rounds[roundKey] = [];
        }
        store.cupSheets[leagueInfo.label].rounds[roundKey].push(knockoutItem);
      }

      await sleep(40);
    }

    store.matches[date] = dayMatches;
    store.predictions[date] = dayPredictions;
  }

  const liveJson = await safeFetch(`${SOFA}/sport/football/events/live`);
  for (const live of liveJson?.events || []) {
    const matchId = `ss-${live.id}`;
    const match = (store.matches[today] || []).find((item) => item.id === matchId);
    if (!match) continue;

    let liveDetails = null;
    if (!live.time?.current) {
      liveDetails = store.eventCache?.[live.id] || null;
      if (!liveDetails || now - Number(store.eventCacheUpdated?.[live.id] || 0) > EVENT_TTL) {
        liveDetails = await fetchEventDetails(live.id);
        if (liveDetails) {
          store.eventCache[live.id] = liveDetails;
          store.eventCacheUpdated[live.id] = now;
        }
      }
    }

    const minuteState = resolveMinuteState(live, liveDetails);

    match.status = "LIVE";
    match.score =
      live.homeScore?.current != null && live.awayScore?.current != null
        ? `${live.homeScore.current}-${live.awayScore.current}`
        : match.score;
    match.minute = minuteState.minute || match.minute;
    match.minuteValue = minuteState.minuteValue || match.minuteValue || null;
    match.extraTime = minuteState.extraTime || null;
    match.period = minuteState.period || match.period || null;
    match.liveUpdatedAt = Date.now();
    match.liveStats = await fetchLiveStats(live.id);

    if (match.aggregate?.active) {
      const [homeGoals, awayGoals] = String(match.score || "0-0").split("-").map(Number);
      if (!Number.isNaN(homeGoals) && !Number.isNaN(awayGoals)) {
        match.aggregate.homeAggregate =
          Number(match.aggregate.homeAggregate || 0) - Number(match.aggregate.currentHomeGoals || 0) + homeGoals;
        match.aggregate.awayAggregate =
          Number(match.aggregate.awayAggregate || 0) - Number(match.aggregate.currentAwayGoals || 0) + awayGoals;
        match.aggregate.currentHomeGoals = homeGoals;
        match.aggregate.currentAwayGoals = awayGoals;
        match.aggregate.aggregateScore = `${match.aggregate.homeAggregate}-${match.aggregate.awayAggregate}`;
        match.aggregate.leader =
          match.aggregate.homeAggregate === match.aggregate.awayAggregate
            ? null
            : match.aggregate.homeAggregate > match.aggregate.awayAggregate
              ? match.homeTeamName
              : match.awayTeamName;
      }
    }

    await sleep(30);
  }

  store.lastRun = Date.now();
  store.workerVersion = "v3-rich";
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  console.log("[worker] klaar");
}

main();
