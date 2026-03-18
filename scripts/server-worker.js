#!/usr/bin/env node

import fs from "fs";
import path from "path";

const SOFA = "https://api.sofascore.com/api/v1";
const DATA_FILE = path.resolve(process.cwd(), "server_data.json");

const ALLOWED_LEAGUES = [
  { country: "netherlands", name: "eredivisie", label: "Netherlands - Eredivisie" },
  { country: "netherlands", name: "eerste divisie", label: "Netherlands - Eerste Divisie" },
  { country: "netherlands", name: "knvb beker", label: "Netherlands - KNVB Beker" },
  { country: "england", name: "premier league", label: "England - Premier League" },
  { country: "england", name: "championship", label: "England - Championship" },
  { country: "germany", name: "bundesliga", label: "Germany - Bundesliga" },
  { country: "germany", name: "2. bundesliga", label: "Germany - 2. Bundesliga" },
  { country: "spain", name: "laliga", label: "Spain - LaLiga" },
  { country: "spain", name: "la liga", label: "Spain - LaLiga" },
  { country: "spain", name: "laliga2", label: "Spain - LaLiga 2" },
  { country: "spain", name: "segunda", label: "Spain - LaLiga 2" },
  { country: "italy", name: "serie a", label: "Italy - Serie A" },
  { country: "italy", name: "serie b", label: "Italy - Serie B" },
  { country: "france", name: "ligue 1", label: "France - Ligue 1" },
  { country: "france", name: "ligue 2", label: "France - Ligue 2" },
  { country: "portugal", name: "liga portugal", label: "Portugal - Liga Portugal" },
  { country: "portugal", name: "liga portugal 2", label: "Portugal - Liga Portugal 2" },
  { country: "belgium", name: "pro league", label: "Belgium - Pro League" },
  { country: "belgium", name: "challenger pro league", label: "Belgium - Challenger Pro League" },
  { country: "", name: "champions league", label: "Europe - Champions League" },
  { country: "", name: "europa league", label: "Europe - Europa League" },
  { country: "", name: "conference league", label: "Europe - Conference League" },
];

process.on("unhandledRejection", (err) => {
  console.error("[worker] unhandledRejection:", err?.message || err);
});

process.on("uncaughtException", (err) => {
  console.error("[worker] uncaughtException:", err?.message || err);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

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

function getAllowedLeague(event) {
  const tournamentName = String(event?.tournament?.name || "").toLowerCase().trim();
  const categoryName = String(event?.tournament?.category?.name || "").toLowerCase().trim();

  for (const league of ALLOWED_LEAGUES) {
    const countryOk = !league.country || categoryName.includes(league.country);
    const nameOk = tournamentName === league.name || tournamentName.includes(league.name);
    if (countryOk && nameOk) return league;
  }

  return null;
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

function pairKey(homeId, awayId) {
  const a = String(homeId || "");
  const b = String(awayId || "");
  return [a, b].sort().join("__");
}

function extractMinuteValue(rawMinute) {
  if (typeof rawMinute === "number" && Number.isFinite(rawMinute)) return rawMinute;
  if (typeof rawMinute !== "string") return null;

  const plusMatch = rawMinute.match(/(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) return Number(plusMatch[1]) + Number(plusMatch[2]);

  const plainMatch = rawMinute.match(/(\d+)/);
  if (plainMatch) return Number(plainMatch[1]);

  if (rawMinute.toUpperCase() === "HT") return 45;
  return null;
}

function formatMinuteDisplay(minuteValue, extraTime, period) {
  const text = String(period || "").toLowerCase();

  if (text.includes("half time") || text.includes("halftime") || text.includes("break")) {
    return "HT";
  }

  if (!minuteValue || minuteValue <= 0) return null;

  const extra = Number(extraTime || 0);
  if (extra > 0) return `${minuteValue}+${extra}'`;

  return `${minuteValue}'`;
}

async function fetchInjuries(teamId) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/players`);
  if (!json?.players) {
    return { injuredCount: 0, injuredRating: 0, keyPlayersMissing: [] };
  }

  const injuredPlayers = json.players.filter(
    (player) =>
      player.player?.injured === true ||
      player.status === "injured" ||
      player.status === "doubtful"
  );

  let injuredRating = 0;
  const keyPlayersMissing = [];

  for (const player of injuredPlayers) {
    const rating = Number(player.player?.rating || 6.0);
    injuredRating += Math.max(0, rating - 6.0);
    if (rating >= 7.5) keyPlayersMissing.push(player.player?.name || "?");
  }

  return {
    injuredCount: injuredPlayers.length,
    injuredRating: Number(injuredRating.toFixed(2)),
    keyPlayersMissing: keyPlayersMissing.slice(0, 3),
  };
}

async function fetchTeamSeasonStats(teamId, tournamentId, seasonId) {
  if (!tournamentId || !seasonId) return null;

  const json = await safeFetch(
    `${SOFA}/team/${teamId}/unique-tournament/${tournamentId}/season/${seasonId}/statistics/overall`
  );

  if (!json?.statistics) return null;

  const stats = json.statistics;
  return {
    avgShotsOn: stats.averageShotsOnTarget || null,
    avgShots: stats.averageShots || null,
    avgPossession: stats.averageBallPossession || null,
    avgCorners: stats.averageCorners || null,
    cleanSheets: stats.cleanSheets || null,
    games: stats.matches || null,
  };
}

async function fetchTeamForm(teamId, limit = 10) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/events/last/0`);
  if (!json?.events) {
    return {
      form: "",
      avgScored: 1.35,
      avgConceded: 1.35,
      bttsRate: 0.5,
      gamesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
    };
  }

  const finishedEvents = json.events
    .filter((event) => event.status?.type === "finished")
    .slice(-limit);

  if (!finishedEvents.length) {
    return {
      form: "",
      avgScored: 1.35,
      avgConceded: 1.35,
      bttsRate: 0.5,
      gamesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
    };
  }

  let form = "";
  let weightedScored = 0;
  let weightedConceded = 0;
  let totalWeight = 0;
  let bttsMatches = 0;

  for (let i = 0; i < finishedEvents.length; i += 1) {
    const event = finishedEvents[i];
    const isHome = String(event.homeTeam?.id) === String(teamId);
    const scored = isHome ? event.homeScore?.current : event.awayScore?.current;
    const conceded = isHome ? event.awayScore?.current : event.homeScore?.current;

    if (scored == null || conceded == null) continue;

    const weight = Math.pow(0.85, finishedEvents.length - 1 - i);
    weightedScored += scored * weight;
    weightedConceded += conceded * weight;
    totalWeight += weight;

    if (scored > 0 && conceded > 0) bttsMatches += 1;
    form += scored > conceded ? "W" : scored === conceded ? "D" : "L";
  }

  const played = finishedEvents.length;
  return {
    form: form.slice(-5),
    avgScored: totalWeight > 0 ? weightedScored / totalWeight : 1.35,
    avgConceded: totalWeight > 0 ? weightedConceded / totalWeight : 1.35,
    bttsRate: played > 0 ? bttsMatches / played : 0.5,
    gamesPlayed: played,
    wins: (form.match(/W/g) || []).length,
    draws: (form.match(/D/g) || []).length,
    losses: (form.match(/L/g) || []).length,
  };
}

async function fetchGoalTiming(teamId) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/events/last/0`);
  if (!json?.events) return null;

  const finishedEvents = json.events
    .filter((event) => event.status?.type === "finished")
    .slice(-20);

  if (finishedEvents.length < 3) return null;

  const scored = { q1: 0, q2: 0, q3: 0, q4: 0 };
  const conceded = { q1: 0, q2: 0, q3: 0, q4: 0 };
  let totalScored = 0;
  let totalConceded = 0;

  for (const event of finishedEvents) {
    const isHome = String(event.homeTeam?.id) === String(teamId);

    for (const incident of event.incidents || []) {
      if (!["goal", "Goal"].includes(incident.incidentType)) continue;
      if (incident.incidentClass === "ownGoal") continue;

      const minute = Number(incident.time || incident.minute || 0);
      const key = minute <= 22 ? "q1" : minute <= 45 ? "q2" : minute <= 67 ? "q3" : "q4";
      const byTeam = isHome ? incident.isHome !== false : incident.isHome === false;

      if (byTeam) {
        scored[key] += 1;
        totalScored += 1;
      } else {
        conceded[key] += 1;
        totalConceded += 1;
      }
    }
  }

  if (totalScored === 0 && totalConceded === 0) return null;

  const pct = (value, total) => (total > 0 ? Math.round((value / total) * 100) : 0);
  return {
    scored: {
      ...scored,
      total: totalScored,
      q1pct: pct(scored.q1, totalScored),
      q2pct: pct(scored.q2, totalScored),
      q3pct: pct(scored.q3, totalScored),
      q4pct: pct(scored.q4, totalScored),
      peak:
        Object.entries(scored)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || "q3",
    },
    conceded: {
      ...conceded,
      total: totalConceded,
      q1pct: pct(conceded.q1, totalConceded),
      q2pct: pct(conceded.q2, totalConceded),
      q3pct: pct(conceded.q3, totalConceded),
      q4pct: pct(conceded.q4, totalConceded),
      peak:
        Object.entries(conceded)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || "q3",
    },
    games: finishedEvents.length,
  };
}

async function fetchH2H(eventId, currentHomeId, currentAwayId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/h2h`);
  if (!json?.events?.length) return null;

  const finishedEvents = json.events
    .filter((event) => event.status?.type === "finished")
    .slice(-10);

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  const results = [];

  for (const event of finishedEvents) {
    const homeScore = event.homeScore?.current;
    const awayScore = event.awayScore?.current;
    if (homeScore == null || awayScore == null) continue;

    const historicalHomeId = String(event.homeTeam?.id || "");
    const historicalAwayId = String(event.awayTeam?.id || "");

    if (homeScore === awayScore) {
      draws += 1;
    } else {
      const winnerId = homeScore > awayScore ? historicalHomeId : historicalAwayId;
      if (winnerId === String(currentHomeId || "")) homeWins += 1;
      if (winnerId === String(currentAwayId || "")) awayWins += 1;
    }

    results.push({
      home: event.homeTeam?.name || "Home",
      away: event.awayTeam?.name || "Away",
      score: `${homeScore}-${awayScore}`,
      date: event.startTimestamp
        ? new Date(event.startTimestamp * 1000).toISOString().split("T")[0]
        : null,
    });
  }

  return {
    played: results.length,
    homeWins,
    draws,
    awayWins,
    results,
  };
}

async function fetchStandings(tournamentId, seasonId) {
  if (!tournamentId || !seasonId) return null;

  const json = await safeFetch(
    `${SOFA}/unique-tournament/${tournamentId}/season/${seasonId}/standings/total`
  );

  if (!json?.standings?.[0]?.rows) return null;

  return json.standings[0].rows.map((row) => ({
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
}

async function fetchLiveStats(eventId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/statistics`);
  if (!json?.statistics) return null;

  const stats = {};

  for (const block of json.statistics) {
    for (const group of block.groups || []) {
      for (const item of group.statisticsItems || []) {
        const key = String(item.name || "")
          .toLowerCase()
          .replace(/\s+/g, "_");

        if (!key) continue;
        stats[key] = { home: item.home, away: item.away };
      }
    }
  }

  return {
    shots_on_target: stats.shots_on_target || stats.on_target || null,
    shots_total: stats.shots_total || stats.total_shots || null,
    possession: stats.ball_possession || null,
    corners: stats.corner_kicks || null,
    xg: stats.expected_goals || null,
  };
}

function calcMatchImportance(homePos, awayPos, totalTeams) {
  if (!homePos || !awayPos || !totalTeams) return 1.0;

  const relegationStart = Math.max(totalTeams - 2, 1);
  const titleZone = 3;
  const europeZone = 6;

  const homePressure =
    homePos <= titleZone || homePos >= relegationStart
      ? 1.15
      : homePos <= europeZone
        ? 1.05
        : 1.0;

  const awayPressure =
    awayPos <= titleZone || awayPos >= relegationStart
      ? 1.15
      : awayPos <= europeZone
        ? 1.05
        : 1.0;

  return Math.max(homePressure, awayPressure);
}

function bayesianEloUpdate(homeTeam, awayTeam, score, homeGamesPlayed, awayGamesPlayed) {
  if (!score?.includes("-")) return;

  const [homeGoals, awayGoals] = score.split("-").map(Number);
  if (Number.isNaN(homeGoals) || Number.isNaN(awayGoals)) return;

  const kHome = homeGamesPlayed < 5 ? 32 : homeGamesPlayed < 15 ? 24 : 18;
  const kAway = awayGamesPlayed < 5 ? 32 : awayGamesPlayed < 15 ? 24 : 18;
  const expectedHome = 1 / (1 + Math.pow(10, (awayTeam.elo - homeTeam.elo) / 400));
  const actualHome = homeGoals > awayGoals ? 1 : homeGoals === awayGoals ? 0.5 : 0;

  homeTeam.elo = clamp(homeTeam.elo + kHome * (actualHome - expectedHome), 900, 2300);
  awayTeam.elo = clamp(awayTeam.elo + kAway * ((1 - actualHome) - (1 - expectedHome)), 900, 2300);
}

function calcInjuryFactor(injuryData) {
  if (!injuryData) {
    return { attackFactor: 1.0, defenseFactor: 1.0 };
  }

  const ratingImpact = Math.min(0.2, Number(injuryData.injuredRating || 0) * 0.04);
  const keyImpact = (injuryData.keyPlayersMissing || []).length * 0.03;
  const totalImpact = Math.min(0.25, ratingImpact + keyImpact);

  return {
    attackFactor: Number((1 - totalImpact).toFixed(3)),
    defenseFactor: Number((1 + totalImpact * 0.5).toFixed(3)),
  };
}

function dixonColesPredict(
  homeStats,
  awayStats,
  homeSeasonStats,
  awaySeasonStats,
  homeElo,
  awayElo,
  h2h,
  homeInjuries,
  awayInjuries,
  homePos,
  awayPos,
  totalTeams
) {
  const avgLeagueGoals = 1.35;
  const homeAdvantage = 1.1;

  let homeAttack = clamp((homeStats.avgScored || avgLeagueGoals) / avgLeagueGoals, 0.35, 3.2);
  let homeDefense = clamp((homeStats.avgConceded || avgLeagueGoals) / avgLeagueGoals, 0.35, 3.2);
  let awayAttack = clamp((awayStats.avgScored || avgLeagueGoals) / avgLeagueGoals, 0.35, 3.2);
  let awayDefense = clamp((awayStats.avgConceded || avgLeagueGoals) / avgLeagueGoals, 0.35, 3.2);

  if (homeSeasonStats?.avgShotsOn && awaySeasonStats?.avgShotsOn) {
    const shotAverage = (homeSeasonStats.avgShotsOn + awaySeasonStats.avgShotsOn) / 2;
    if (shotAverage > 0) {
      homeAttack = homeAttack * 0.7 + (homeSeasonStats.avgShotsOn / shotAverage) * 0.3;
      awayAttack = awayAttack * 0.7 + (awaySeasonStats.avgShotsOn / shotAverage) * 0.3;
    }
  }

  const homeInjuryFactor = calcInjuryFactor(homeInjuries);
  const awayInjuryFactor = calcInjuryFactor(awayInjuries);

  homeAttack *= homeInjuryFactor.attackFactor;
  homeDefense *= homeInjuryFactor.defenseFactor;
  awayAttack *= awayInjuryFactor.attackFactor;
  awayDefense *= awayInjuryFactor.defenseFactor;

  const eloHomeBoost = clamp(1 + (homeElo - awayElo) / 1200, 0.82, 1.18);
  const eloAwayBoost = clamp(1 + (awayElo - homeElo) / 1200, 0.82, 1.18);
  const importance = calcMatchImportance(homePos, awayPos, totalTeams);

  let homeXG = avgLeagueGoals * homeAttack * awayDefense * homeAdvantage * eloHomeBoost * importance;
  let awayXG = avgLeagueGoals * awayAttack * homeDefense * eloAwayBoost;

  if (h2h?.played >= 4) {
    const balance = (h2h.homeWins - h2h.awayWins) / Math.max(h2h.played, 1);
    homeXG *= 1 + balance * 0.05;
    awayXG *= 1 - balance * 0.05;
  }

  homeXG = clamp(homeXG, 0.2, 3.8);
  awayXG = clamp(awayXG, 0.2, 3.8);

  let homeProb = 0;
  let drawProb = 0;
  let awayProb = 0;
  let over05 = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let btts = 0;
  let bestScore = "1-1";
  let bestProb = 0;
  const scoreMatrix = {};

  for (let homeGoals = 0; homeGoals <= 7; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 7; awayGoals += 1) {
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
      if (totalGoals > 0.5) over05 += probability;
      if (totalGoals > 1.5) over15 += probability;
      if (totalGoals > 2.5) over25 += probability;
      if (totalGoals > 3.5) over35 += probability;
      if (homeGoals > 0 && awayGoals > 0) btts += probability;
      if (probability > 0.008) scoreMatrix[`${homeGoals}-${awayGoals}`] = Number(
        probability.toFixed(4)
      );
    }
  }

  const totalProb = homeProb + drawProb + awayProb;
  homeProb /= totalProb;
  drawProb /= totalProb;
  awayProb /= totalProb;

  const homeWinRate = (homeStats.wins || 0) / Math.max(homeStats.gamesPlayed || 1, 1);
  const awayWinRate = (awayStats.wins || 0) / Math.max(awayStats.gamesPlayed || 1, 1);
  const homeXGRate = (homeStats.avgScored || avgLeagueGoals) / avgLeagueGoals;
  const awayXGRate = (awayStats.avgScored || avgLeagueGoals) / avgLeagueGoals;

  const homeFalsePositive = homeWinRate > homeXGRate + 0.25;
  const awayFalsePositive = awayWinRate > awayXGRate + 0.25;
  const falsePositivePenalty = (homeFalsePositive ? 0.04 : 0) + (awayFalsePositive ? 0.03 : 0);

  const dataConfidence = Math.min(
    1,
    ((homeStats.gamesPlayed || 0) / 10) * 0.5 + ((awayStats.gamesPlayed || 0) / 10) * 0.5
  );

  const confidence = Math.min(
    0.93,
    bestProb * 3.5 +
      Math.min(0.12, Math.abs(homeElo - awayElo) / 1200) +
      (h2h?.played >= 6 ? 0.03 : 0) +
      dataConfidence * 0.2 -
      falsePositivePenalty
  );

  const [predHomeGoals, predAwayGoals] = bestScore.split("-").map(Number);
  const sortedMatrix = Object.fromEntries(
    Object.entries(scoreMatrix)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
  );

  return {
    homeProb: Number(homeProb.toFixed(4)),
    drawProb: Number(drawProb.toFixed(4)),
    awayProb: Number(awayProb.toFixed(4)),
    homeXG: Number(homeXG.toFixed(2)),
    awayXG: Number(awayXG.toFixed(2)),
    predHomeGoals,
    predAwayGoals,
    exactProb: Number(bestProb.toFixed(4)),
    confidence: Number(confidence.toFixed(3)),
    over05: Number(over05.toFixed(3)),
    over15: Number(over15.toFixed(3)),
    over25: Number(over25.toFixed(3)),
    over35: Number(over35.toFixed(3)),
    btts: Number(btts.toFixed(3)),
    scoreMatrix: sortedMatrix,
    matchImportance: Number(importance.toFixed(2)),
    homeFalsePositive,
    awayFalsePositive,
  };
}

function getTeam(storeTeams, id, name) {
  const key = id ? `id:${id}` : `name:${String(name || "").toLowerCase()}`;
  if (!storeTeams[key]) {
    storeTeams[key] = { id: id || "", name: name || "Unknown", elo: 1500 };
  }
  storeTeams[key].name = name || storeTeams[key].name;
  if (id) storeTeams[key].id = id;
  return storeTeams[key];
}

async function main() {
  console.log("[worker] start:", new Date().toISOString());

  let store = {
    teams: {},
    predictions: {},
    matches: {},
    standings: {},
    teamStats: {},
    teamSeasonStats: {},
    teamInjuries: {},
    teamStatsUpdated: {},
    teamSeasonStatsUpdated: {},
    teamInjuriesUpdated: {},
    h2hCache: {},
    lastRun: null,
    workerVersion: "v7",
  };

  if (fs.existsSync(DATA_FILE)) {
    try {
      store = {
        ...store,
        ...JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")),
      };
    } catch {
      console.warn("[worker] bestaande server_data.json kon niet worden gelezen, ga verder met lege store");
    }
  }

  for (const key of [
    "matches",
    "predictions",
    "standings",
    "teamStats",
    "teamSeasonStats",
    "teamInjuries",
    "teamStatsUpdated",
    "teamSeasonStatsUpdated",
    "teamInjuriesUpdated",
    "h2hCache",
  ]) {
    if (!store[key]) store[key] = {};
  }

  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  const dates = [yesterday, today, tomorrow];

  const now = Date.now();
  const SIX_HOURS = 6 * 3600 * 1000;
  const FOUR_HOURS = 4 * 3600 * 1000;
  const TWELVE_HOURS = 12 * 3600 * 1000;
  const H2H_TTL = 7 * 86400 * 1000;

  const allEventsByDate = {};
  const teamIdsNeeded = new Set();
  const tournamentsMap = new Map();
  const teamTournamentMap = new Map();

  for (const date of dates) {
    const json = await safeFetch(`${SOFA}/sport/football/scheduled-events/${date}`);
    const events = (json?.events || []).filter((event) => getAllowedLeague(event));
    allEventsByDate[date] = events;

    for (const event of events) {
      const homeId = event.homeTeam?.id ? String(event.homeTeam.id) : "";
      const awayId = event.awayTeam?.id ? String(event.awayTeam.id) : "";
      if (homeId) teamIdsNeeded.add(homeId);
      if (awayId) teamIdsNeeded.add(awayId);

      const tournamentId = event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id;
      const seasonId = event.season?.id;
      const allowed = getAllowedLeague(event);

      if (tournamentId && seasonId && allowed) {
        tournamentsMap.set(`${tournamentId}_${seasonId}`, {
          tournamentId,
          seasonId,
          label: allowed.label,
        });
      }

      if (homeId && tournamentId && seasonId) {
        teamTournamentMap.set(homeId, { tournamentId, seasonId });
      }

      if (awayId && tournamentId && seasonId) {
        teamTournamentMap.set(awayId, { tournamentId, seasonId });
      }
    }

    await sleep(300);
  }

  console.log(`[worker] events loaded: ${teamIdsNeeded.size} teams`);

  let formUpdated = 0;
  for (const teamId of teamIdsNeeded) {
    if (now - (store.teamStatsUpdated[teamId] || 0) < SIX_HOURS) continue;

    const stats = await fetchTeamForm(teamId, 10);
    const goalTiming = await fetchGoalTiming(teamId);

    store.teamStats[teamId] = {
      ...stats,
      goalTiming: goalTiming || null,
    };
    store.teamStatsUpdated[teamId] = now;
    formUpdated += 1;

    await sleep(200);
  }
  console.log(`[worker] team form updated: ${formUpdated}`);

  let seasonUpdated = 0;
  for (const teamId of teamIdsNeeded) {
    if (now - (store.teamSeasonStatsUpdated[teamId] || 0) < TWELVE_HOURS) continue;

    const tournamentInfo = teamTournamentMap.get(teamId);
    if (!tournamentInfo) continue;

    const seasonStats = await fetchTeamSeasonStats(
      teamId,
      tournamentInfo.tournamentId,
      tournamentInfo.seasonId
    );

    if (seasonStats) {
      store.teamSeasonStats[teamId] = seasonStats;
      store.teamSeasonStatsUpdated[teamId] = now;
      seasonUpdated += 1;
    }

    await sleep(180);
  }
  console.log(`[worker] season stats updated: ${seasonUpdated}`);

  const injuryTeamIds = new Set();
  for (const date of [today, tomorrow]) {
    for (const event of allEventsByDate[date] || []) {
      if (event.homeTeam?.id) injuryTeamIds.add(String(event.homeTeam.id));
      if (event.awayTeam?.id) injuryTeamIds.add(String(event.awayTeam.id));
    }
  }

  let injuriesUpdated = 0;
  for (const teamId of injuryTeamIds) {
    if (now - (store.teamInjuriesUpdated[teamId] || 0) < FOUR_HOURS) continue;

    const injuries = await fetchInjuries(teamId);
    store.teamInjuries[teamId] = injuries;
    store.teamInjuriesUpdated[teamId] = now;
    injuriesUpdated += 1;

    await sleep(200);
  }
  console.log(`[worker] injuries updated: ${injuriesUpdated}`);

  const standingsLookup = {};
  let standingsUpdated = 0;

  for (const [key, info] of tournamentsMap.entries()) {
    if (store.standings[key] && now - (store.standings[key].updated || 0) < SIX_HOURS) {
      standingsLookup[key] = {};
      for (const row of store.standings[key].rows || []) {
        standingsLookup[key][row.teamId] = row.pos;
      }
      continue;
    }

    const rows = await fetchStandings(info.tournamentId, info.seasonId);
    if (rows) {
      store.standings[key] = {
        label: info.label,
        rows,
        updated: now,
      };
      standingsLookup[key] = {};
      for (const row of rows) standingsLookup[key][row.teamId] = row.pos;
      standingsUpdated += 1;
    }

    await sleep(200);
  }
  console.log(`[worker] standings updated: ${standingsUpdated}`);

  for (const date of dates) {
    const events = allEventsByDate[date] || [];
    const dayMatches = [];
    const dayPredictions = [];

    for (const event of events) {
      const allowed = getAllowedLeague(event);
      if (!allowed) continue;

      const homeName = event.homeTeam?.name || "Home";
      const awayName = event.awayTeam?.name || "Away";
      const homeId = event.homeTeam?.id ? String(event.homeTeam.id) : "";
      const awayId = event.awayTeam?.id ? String(event.awayTeam.id) : "";

      const homeTeam = getTeam(store.teams, homeId, homeName);
      const awayTeam = getTeam(store.teams, awayId, awayName);

      const statusType = event.status?.type || "notstarted";
      const homeGoals = event.homeScore?.current;
      const awayGoals = event.awayScore?.current;
      const score =
        homeGoals != null && awayGoals != null ? `${homeGoals}-${awayGoals}` : null;

      const homeFormData = store.teamStats[homeId] || { gamesPlayed: 0, avgScored: 1.35, avgConceded: 1.35 };
      const awayFormData = store.teamStats[awayId] || { gamesPlayed: 0, avgScored: 1.35, avgConceded: 1.35 };

      if (statusType === "finished" && score) {
        bayesianEloUpdate(
          homeTeam,
          awayTeam,
          score,
          homeFormData.gamesPlayed || 5,
          awayFormData.gamesPlayed || 5
        );
      }

      const tournamentId = event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id;
      const seasonId = event.season?.id;
      const standingsKey = `${tournamentId}_${seasonId}`;
      const leaguePositions = standingsLookup[standingsKey] || {};
      const homePos = homeId ? leaguePositions[homeId] || null : null;
      const awayPos = awayId ? leaguePositions[awayId] || null : null;
      const totalTeams = store.standings[standingsKey]?.rows?.length || 20;

      const minuteValue = Number(event.time?.current || 0) || null;
      const extraTime = Number(event.time?.extra || 0) || null;
      const period = event.status?.description || null;

      const prediction = dixonColesPredict(
        homeFormData,
        awayFormData,
        store.teamSeasonStats[homeId] || null,
        store.teamSeasonStats[awayId] || null,
        homeTeam.elo,
        awayTeam.elo,
        null,
        store.teamInjuries[homeId] || null,
        store.teamInjuries[awayId] || null,
        homePos,
        awayPos,
        totalTeams
      );

      const matchId = `ss-${event.id}`;

      dayMatches.push({
        id: matchId,
        sofaId: event.id,
        date,
        kickoff: event.startTimestamp ? new Date(event.startTimestamp * 1000).toISOString() : null,
        league: allowed.label,
        homeTeamName: homeName,
        awayTeamName: awayName,
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeLogo: homeId ? `https://api.sofascore.app/api/v1/team/${homeId}/image` : "",
        awayLogo: awayId ? `https://api.sofascore.app/api/v1/team/${awayId}/image` : "",
        status: statusType === "finished" ? "FT" : statusType === "inprogress" ? "LIVE" : "NS",
        score,
        minute: formatMinuteDisplay(minuteValue, extraTime, period),
        minuteValue,
        extraTime,
        period,
        liveUpdatedAt: statusType === "inprogress" ? now : null,
        homeForm: homeFormData.form || "",
        awayForm: awayFormData.form || "",
        homeElo: Math.round(homeTeam.elo),
        awayElo: Math.round(awayTeam.elo),
        homePos,
        awayPos,
        matchImportance: prediction.matchImportance,
        homeInjuries: store.teamInjuries[homeId] || null,
        awayInjuries: store.teamInjuries[awayId] || null,
        homeGoalTiming: store.teamStats[homeId]?.goalTiming || null,
        awayGoalTiming: store.teamStats[awayId]?.goalTiming || null,
        homeSeasonStats: store.teamSeasonStats[homeId] || null,
        awaySeasonStats: store.teamSeasonStats[awayId] || null,
      });

      dayPredictions.push({
        matchId,
        homeTeam: homeName,
        awayTeam: awayName,
        league: allowed.label,
        homeForm: homeFormData.form || "",
        awayForm: awayFormData.form || "",
        homeElo: Math.round(homeTeam.elo),
        awayElo: Math.round(awayTeam.elo),
        ...prediction,
      });
    }

    store.matches[date] = dayMatches;
    store.predictions[date] = dayPredictions;
    console.log(`[worker] ${date}: ${dayMatches.length} matches`);
  }

  let h2hFetched = 0;

  for (const date of [today, tomorrow]) {
    for (const match of store.matches[date] || []) {
      const key = pairKey(match.homeTeamId, match.awayTeamId) || match.id;
      const cachedEntry = store.h2hCache[key];

      if (cachedEntry && now - (cachedEntry.fetched || 0) < H2H_TTL) {
        match.h2h = cachedEntry.data;
      } else {
        const h2h = await fetchH2H(match.sofaId, match.homeTeamId, match.awayTeamId);
        if (h2h) {
          match.h2h = h2h;
          store.h2hCache[key] = {
            fetched: now,
            data: h2h,
          };
          h2hFetched += 1;
        }
        await sleep(250);
      }

      const predIndex = (store.predictions[date] || []).findIndex(
        (prediction) => prediction.matchId === match.id
      );

      if (predIndex >= 0 && match.h2h) {
        const existingPrediction = store.predictions[date][predIndex];
        const homeFormData = store.teamStats[match.homeTeamId] || {
          gamesPlayed: 0,
          avgScored: 1.35,
          avgConceded: 1.35,
        };
        const awayFormData = store.teamStats[match.awayTeamId] || {
          gamesPlayed: 0,
          avgScored: 1.35,
          avgConceded: 1.35,
        };

        const updatedPrediction = dixonColesPredict(
          homeFormData,
          awayFormData,
          store.teamSeasonStats[match.homeTeamId] || null,
          store.teamSeasonStats[match.awayTeamId] || null,
          match.homeElo || 1500,
          match.awayElo || 1500,
          match.h2h,
          store.teamInjuries[match.homeTeamId] || null,
          store.teamInjuries[match.awayTeamId] || null,
          match.homePos,
          match.awayPos,
          20
        );

        store.predictions[date][predIndex] = {
          ...existingPrediction,
          ...updatedPrediction,
          h2h: match.h2h,
        };
      }
    }
  }

  console.log(`[worker] h2h fetched: ${h2hFetched}`);

  const liveJson = await safeFetch(`${SOFA}/sport/football/events/live`);
  if (liveJson?.events) {
    if (!store.matches[today]) store.matches[today] = [];

    let liveMerged = 0;

    for (const liveEvent of liveJson.events) {
      const allowed = getAllowedLeague(liveEvent);
      if (!allowed) continue;

      const matchId = `ss-${liveEvent.id}`;
      const index = store.matches[today].findIndex((match) => match.id === matchId);

      const homeGoals = liveEvent.homeScore?.current;
      const awayGoals = liveEvent.awayScore?.current;
      const minuteValue = Number(liveEvent.time?.current || 0) || null;
      const extraTime = Number(liveEvent.time?.extra || 0) || null;
      const period = liveEvent.status?.description || null;
      const liveData = {
        status: "LIVE",
        score:
          homeGoals != null && awayGoals != null ? `${homeGoals}-${awayGoals}` : null,
        minute: formatMinuteDisplay(minuteValue, extraTime, period),
        minuteValue,
        extraTime,
        period,
        liveUpdatedAt: now,
      };

      if (index >= 0) {
        Object.assign(store.matches[today][index], liveData);
        const liveStats = await fetchLiveStats(liveEvent.id);
        if (liveStats) {
          store.matches[today][index].liveStats = liveStats;
        }
      } else {
        const homeId = liveEvent.homeTeam?.id ? String(liveEvent.homeTeam.id) : "";
        const awayId = liveEvent.awayTeam?.id ? String(liveEvent.awayTeam.id) : "";

        store.matches[today].push({
          id: matchId,
          sofaId: liveEvent.id,
          date: today,
          kickoff: liveEvent.startTimestamp
            ? new Date(liveEvent.startTimestamp * 1000).toISOString()
            : null,
          league: allowed.label,
          homeTeamName: liveEvent.homeTeam?.name || "Home",
          awayTeamName: liveEvent.awayTeam?.name || "Away",
          homeTeamId: homeId,
          awayTeamId: awayId,
          homeLogo: homeId ? `https://api.sofascore.app/api/v1/team/${homeId}/image` : "",
          awayLogo: awayId ? `https://api.sofascore.app/api/v1/team/${awayId}/image` : "",
          ...liveData,
          liveStats: (await fetchLiveStats(liveEvent.id)) || null,
        });
      }

      liveMerged += 1;
      await sleep(150);
    }

    console.log(`[worker] live merged: ${liveMerged}`);
  }

  store.lastRun = now;
  store.workerVersion = "v7";

  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  for (const date of Object.keys(store.matches)) {
    if (date < cutoff) delete store.matches[date];
  }
  for (const date of Object.keys(store.predictions)) {
    if (date < cutoff) delete store.predictions[date];
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  console.log("[worker] done");
}

main();
