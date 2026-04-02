#!/usr/bin/env node

import fs from "fs";
import path from "path";

const SOFA = "https://api.sofascore.com/api/v1";
const DATA_FILE = path.resolve(process.cwd(), "server_data.json");
const TRAINING_SNAPSHOT_FILE = path.resolve(process.cwd(), "training", "training-snapshot.json");

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

function toAmsterdamDateKey(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysToDateKey(dateKey, offset) {
  const base = new Date(`${dateKey}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}

function buildRetainedDateSet(baseDateKey) {
  const retain = new Set();
  for (let offset = -HISTORY_KEEP_DAYS_BACK; offset <= HISTORY_KEEP_DAYS_FORWARD; offset += 1) {
    retain.add(addDaysToDateKey(baseDateKey, offset));
  }
  return retain;
}

function trimScoreMatrix(scoreMatrix, limit = MAX_SCORE_MATRIX_ENTRIES) {
  return Object.fromEntries(
    Object.entries(scoreMatrix || {})
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .slice(0, limit)
  );
}

function compactPredictionEntry(prediction, historical = false) {
  if (!prediction || typeof prediction !== "object") return prediction;
  const compact = {
    ...prediction,
    scoreMatrix: trimScoreMatrix(prediction.scoreMatrix),
  };

  if (historical) {
    delete compact.featureVector;
    delete compact.analysis;
    if (compact.ensembleMeta) {
      compact.ensembleMeta = {
        active: !!compact.ensembleMeta.active,
        baseModel: compact.ensembleMeta.baseModel,
        blendModel: compact.ensembleMeta.blendModel,
        blendWeightBase: compact.ensembleMeta.blendWeightBase,
        blendWeightHeuristic: compact.ensembleMeta.blendWeightHeuristic,
        agreement: compact.ensembleMeta.agreement,
        baseProbabilities: compact.ensembleMeta.baseProbabilities,
        heuristicProbabilities: compact.ensembleMeta.heuristicProbabilities,
      };
    }
  }

  return compact;
}

function pruneUpdatedMap(store, valueKey, updatedKey, ttl, now, maxEntries = null) {
  const values = store[valueKey] || {};
  const updated = store[updatedKey] || {};
  for (const key of Object.keys(updated)) {
    if (now - Number(updated[key] || 0) > ttl) {
      delete updated[key];
      delete values[key];
    }
  }

  if (maxEntries && Object.keys(updated).length > maxEntries) {
    const keep = new Set(
      Object.entries(updated)
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
        .slice(0, maxEntries)
        .map(([key]) => key)
    );
    for (const key of Object.keys(updated)) {
      if (!keep.has(key)) {
        delete updated[key];
        delete values[key];
      }
    }
  }

  store[valueKey] = values;
  store[updatedKey] = updated;
}

function pruneEmbeddedUpdatedMap(store, valueKey, ttl, now, maxEntries = null) {
  const values = store[valueKey] || {};
  for (const key of Object.keys(values)) {
    if (now - Number(values[key]?.updated || 0) > ttl) delete values[key];
  }

  if (maxEntries && Object.keys(values).length > maxEntries) {
    const keep = new Set(
      Object.entries(values)
        .sort((a, b) => Number(b[1]?.updated || 0) - Number(a[1]?.updated || 0))
        .slice(0, maxEntries)
        .map(([key]) => key)
    );
    for (const key of Object.keys(values)) {
      if (!keep.has(key)) delete values[key];
    }
  }

  store[valueKey] = values;
}

const FORM_TTL = 6 * 60 * 60 * 1000;
const INJURY_TTL = 4 * 60 * 60 * 1000;
const SEASON_TTL = 12 * 60 * 60 * 1000;
const H2H_TTL = 3 * 24 * 60 * 60 * 1000;
const WEATHER_TTL = 6 * 60 * 60 * 1000;
const EVENT_TTL = 12 * 60 * 60 * 1000;
const CLUB_ELO_TTL = 12 * 60 * 60 * 1000;
const MARKET_TTL = 24 * 60 * 60 * 1000;
const HISTORY_KEEP_DAYS_BACK = 12;
const HISTORY_KEEP_DAYS_FORWARD = 4;
const MAX_REVIEWS = 1200;
const MAX_SCORE_MATRIX_ENTRIES = 10;
const MAX_EVENT_CACHE = 300;
const MAX_H2H_CACHE = 500;
const MAX_WEATHER_CACHE = 220;
const MAX_MARKET_PROFILES = 64;

const MARKET_LEAGUE_CODES = {
  "England - Premier League": "E0",
  "England - Championship": "E1",
  "Netherlands - Eredivisie": "N1",
  "Netherlands - Eerste Divisie": "N2",
  "Germany - Bundesliga": "D1",
  "Germany - 2. Bundesliga": "D2",
  "Spain - LaLiga": "SP1",
  "Spain - LaLiga2": "SP2",
  "Italy - Serie A": "I1",
  "Italy - Serie B": "I2",
  "France - Ligue 1": "F1",
  "France - Ligue 2": "F2",
  "Portugal - Liga Portugal": "P1",
  "Belgium - Pro League": "B1",
};

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

function isWomenContext(...values) {
  const text = values
    .flatMap((value) => (value == null ? [] : [String(value)]))
    .join(" ")
    .toLowerCase();

  return (
    text.includes("women") ||
    text.includes("woman") ||
    text.includes("femminile") ||
    text.includes("feminine") ||
    text.includes("feminin") ||
    text.includes("frauen") ||
    text.includes("dames") ||
    text.includes("ladies") ||
    text.includes("vrouw")
  );
}

function isYouthContext(...values) {
  const text = values
    .flatMap((value) => (value == null ? [] : [String(value)]))
    .join(" ")
    .toLowerCase();

  return (
    text.includes("u17") ||
    text.includes("u18") ||
    text.includes("u19") ||
    text.includes("u20") ||
    text.includes("u21") ||
    text.includes("u23") ||
    text.includes("under 17") ||
    text.includes("under 18") ||
    text.includes("under 19") ||
    text.includes("under 20") ||
    text.includes("under 21") ||
    text.includes("under 23") ||
    text.includes("youth") ||
    text.includes("junior")
  );
}

function getCompetitionSegment(...values) {
  return isYouthContext(...values) ? "youth" : "senior";
}

const EUROPEAN_COUNTRIES = new Set(
  [
    "albania",
    "andorra",
    "armenia",
    "austria",
    "azerbaijan",
    "belarus",
    "belgium",
    "bosnia and herzegovina",
    "bosnia herzegovina",
    "bulgaria",
    "croatia",
    "cyprus",
    "czech republic",
    "czechia",
    "denmark",
    "england",
    "estonia",
    "faroe islands",
    "finland",
    "france",
    "georgia",
    "germany",
    "gibraltar",
    "greece",
    "hungary",
    "iceland",
    "ireland",
    "israel",
    "italy",
    "kazakhstan",
    "kosovo",
    "latvia",
    "liechtenstein",
    "lithuania",
    "luxembourg",
    "malta",
    "moldova",
    "montenegro",
    "netherlands",
    "north macedonia",
    "norway",
    "poland",
    "portugal",
    "romania",
    "san marino",
    "scotland",
    "serbia",
    "slovakia",
    "slovenia",
    "spain",
    "sweden",
    "switzerland",
    "turkey",
    "ukraine",
    "wales",
  ].map((entry) => normalizeName(entry))
);

function isEuropeanCountryName(name) {
  return EUROPEAN_COUNTRIES.has(normalizeName(name));
}

function isSeniorInternationalTournament(tournamentName) {
  const value = normalizeName(tournamentName);
  if (!value) return false;
  const blocked = ["u17", "u18", "u19", "u20", "u21", "u23", "women", "femin", "vrouw", "futsal"];
  return !blocked.some((token) => value.includes(token));
}

function shouldExcludeEvent(event) {
  return isWomenContext(
    event?.uniqueTournament?.name,
    event?.tournament?.name,
    event?.tournament?.category?.name,
    event?.homeTeam?.name,
    event?.awayTeam?.name,
    event?.homeTeam?.teamType,
    event?.awayTeam?.teamType
  ) || isYouthContext(
    event?.uniqueTournament?.name,
    event?.tournament?.name,
    event?.tournament?.category?.name,
    event?.homeTeam?.name,
    event?.awayTeam?.name,
    event?.homeTeam?.teamType,
    event?.awayTeam?.teamType
  );
}

function getInternationalLeagueInfo(event) {
  if (shouldExcludeEvent(event)) return null;
  const tournament = String(
    event?.uniqueTournament?.name || event?.tournament?.name || ""
  );
  const tournamentNorm = normalizeName(tournament);
  const categoryNorm = normalizeName(event?.tournament?.category?.name || "");
  const homeCountryNorm = normalizeName(event?.homeTeam?.country?.name || "");
  const awayCountryNorm = normalizeName(event?.awayTeam?.country?.name || "");
  const hasEuropeanTeam =
    isEuropeanCountryName(homeCountryNorm) || isEuropeanCountryName(awayCountryNorm);
  const europeanPair =
    isEuropeanCountryName(homeCountryNorm) && isEuropeanCountryName(awayCountryNorm);

  if (!isSeniorInternationalTournament(tournamentNorm)) return null;

  if (
    tournamentNorm.includes("world championship qualification") ||
    tournamentNorm.includes("world championship qual") ||
    tournamentNorm.includes("world cup qual") ||
    tournamentNorm.includes("world cup qualification") ||
    tournamentNorm.includes("fifa world cup qualification")
  ) {
    if (categoryNorm.includes("europe") || hasEuropeanTeam || tournamentNorm.includes("uefa")) {
      return {
        country: "",
        name: tournamentNorm,
        label: "Europe - World Cup Qualification",
        type: "league",
      };
    }
  }

  if (
    (tournamentNorm.includes("european championship") && tournamentNorm.includes("qualification")) ||
    tournamentNorm.includes("euro qualification") ||
    tournamentNorm.includes("uefa euro qualification")
  ) {
    if (categoryNorm.includes("europe") || hasEuropeanTeam) {
      return {
        country: "",
        name: tournamentNorm,
        label: "Europe - Euro Qualification",
        type: "league",
      };
    }
  }

  if (tournamentNorm.includes("uefa nations league")) {
    return {
      country: "",
      name: tournamentNorm,
      label: "Europe - UEFA Nations League",
      type: "league",
    };
  }

  if (
    tournamentNorm.includes("european championship") &&
    !tournamentNorm.includes("qualification")
  ) {
    if (categoryNorm.includes("europe") || hasEuropeanTeam) {
      return {
        country: "",
        name: tournamentNorm,
        label: "Europe - European Championship",
        type: "cup",
      };
    }
  }

  if (
    (tournamentNorm.includes("friendly games") || tournamentNorm.includes("international friendly")) &&
    !tournamentNorm.includes("club")
  ) {
    if (hasEuropeanTeam) {
      return {
        country: "",
        name: tournamentNorm,
        label: "Europe - International Friendly",
        type: "league",
      };
    }
  }

  return null;
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
    over15Rate: 0.5,
    over25Rate: 0.45,
    cleanSheetRate: 0.2,
    failToScoreRate: 0.25,
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
    over15Rate: Number((split.over15 / split.games).toFixed(2)),
    over25Rate: Number((split.over25 / split.games).toFixed(2)),
    cleanSheetRate: Number((split.cleanSheets / split.games).toFixed(2)),
    failToScoreRate: Number((split.failToScore / split.games).toFixed(2)),
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

function toPointsPerGame(wins, draws, games) {
  if (!games) return 0;
  return Number((((wins || 0) * 3 + (draws || 0)) / games).toFixed(2));
}

function buildTeamProfile({ teamName, recent, seasonStats, injuries, clubElo, standingPos }) {
  const homeSplit = recent?.splits?.home || emptySplit();
  const awaySplit = recent?.splits?.away || emptySplit();
  const strongestSide = recent?.strongestSide || "balanced";
  const attackTrend = Number(((recent?.avgScored || 1.35) - (recent?.avgConceded || 1.35)).toFixed(2));
  const consistency =
    recent?.gamesPlayed
      ? Number(
          (
            (Number(recent.wins || 0) + Number(recent.draws || 0) * 0.5) /
            Math.max(Number(recent.gamesPlayed || 1), 1)
          ).toFixed(2)
        )
      : 0.5;
  const setPieceScore = Number(
    (
      Number(seasonStats?.avgCorners || 4.5) * 0.45 +
      Number(seasonStats?.avgShotsOn || 4) * 0.35 +
      Math.max(0, attackTrend) * 0.2
    ).toFixed(2)
  );

  return {
    teamName,
    standingPos: standingPos ?? null,
    clubElo: clubElo ?? null,
    strongestSide,
    pointsPerGame: toPointsPerGame(recent?.wins, recent?.draws, recent?.gamesPlayed),
    attackTrend,
    consistency,
    setPieceScore,
    cornersTrend: Number(seasonStats?.avgCorners || 0),
    disciplineIndex: Number(
      (
        Number(recent?.yellowCardRate || 0) +
        Number(recent?.redCardRate || 0) * 1.7
      ).toFixed(2)
    ),
    fatigueIndex: Number(
      (
        Math.max(0, 5 - Number(recent?.gamesPlayed || 0) * 0.1) +
        Math.max(0, Number(injuries?.injuredCount || 0) * 0.12)
      ).toFixed(2)
    ),
    homeSplit: {
      avgScored: homeSplit.avgScored,
      avgConceded: homeSplit.avgConceded,
      over25Rate: homeSplit.over25Rate,
      cleanSheetRate: homeSplit.cleanSheetRate,
    },
    awaySplit: {
      avgScored: awaySplit.avgScored,
      avgConceded: awaySplit.avgConceded,
      over25Rate: awaySplit.over25Rate,
      cleanSheetRate: awaySplit.cleanSheetRate,
    },
    season: seasonStats
      ? {
          avgShotsOn: seasonStats.avgShotsOn ?? null,
          avgShots: seasonStats.avgShots ?? null,
          avgPossession: seasonStats.avgPossession ?? null,
          avgCorners: seasonStats.avgCorners ?? null,
          cleanSheets: seasonStats.cleanSheets ?? null,
        }
      : null,
    injuries: {
      count: Number(injuries?.injuredCount || 0),
      ratingImpact: Number(injuries?.injuredRating || 0),
      keyPlayersMissing: injuries?.keyPlayersMissing || [],
    },
    discipline: {
      yellowRate: Number(recent?.yellowCardRate || 0),
      redRate: Number(recent?.redCardRate || 0),
    },
  };
}

function calcLineupContinuity(lineupSide, injuries) {
  const starters = Number(lineupSide?.starters || 0);
  const avgRating = Number(lineupSide?.avgRating || 6.8);
  const injuryPenalty = Number(injuries?.injuredCount || 0) * 0.07;
  const starterScore = starters ? Math.min(1, starters / 11) : 0.55;
  const ratingScore = Math.max(0, Math.min(1, (avgRating - 6) / 2));
  return Number(Math.max(0, starterScore * 0.6 + ratingScore * 0.4 - injuryPenalty).toFixed(2));
}

function calcTravelPenalty({ homeCountry, awayCountry, leagueType }) {
  const home = normalizeName(homeCountry);
  const away = normalizeName(awayCountry);
  if (!home || !away) return 0;
  if (home === away) return 0;
  if (leagueType === "cup") return 0.22;
  return 0.1;
}

function calcKeeperEdge(lineupSummary) {
  const homeKeeper = Number(lineupSummary?.home?.keeperRating || 0);
  const awayKeeper = Number(lineupSummary?.away?.keeperRating || 0);
  if (!homeKeeper && !awayKeeper) return 0;
  return Number((homeKeeper - awayKeeper).toFixed(2));
}

function calculateRecentH2HBalance(h2h, currentHomeId, currentAwayId) {
  if (!h2h?.results || h2h.results.length === 0) return 0;
  if (!currentHomeId || !currentAwayId) return 0;
  
  // Pak de laatste 5 wedstrijden (of minder als er niet genoeg zijn)
  const recent = h2h.results.slice(-5);
  
  // Bereken gewogen balance - recentere wedstrijden wegen zwaarder
  // Gewichten: laatste = 1.0, voorlaatste = 0.9, etc.
  let weightedScore = 0;
  let totalWeight = 0;
  
  recent.forEach((result, index) => {
    const weight = 0.6 + (index * 0.1); // 0.6, 0.7, 0.8, 0.9, 1.0
    
    // Score: +1 als huidige home team won, -1 als huidige away team won, 0 voor draw
    let score = 0;
    if (result.winnerId) {
      const currentHomeIdStr = String(currentHomeId);
      const currentAwayIdStr = String(currentAwayId);
      
      if (result.winnerId === currentHomeIdStr) {
        score = 1;
      } else if (result.winnerId === currentAwayIdStr) {
        score = -1;
      }
    }
    
    weightedScore += score * weight;
    totalWeight += weight;
  });
  
  return totalWeight > 0 ? Number((weightedScore / totalWeight).toFixed(2)) : 0;
}

function buildFeatureVector(input) {
  const homeSplit = pickHomeStrength(input.homeRecent);
  const awaySplit = pickAwayStrength(input.awayRecent);
  const homePpg = toPointsPerGame(input.homeRecent?.wins, input.homeRecent?.draws, input.homeRecent?.gamesPlayed);
  const awayPpg = toPointsPerGame(input.awayRecent?.wins, input.awayRecent?.draws, input.awayRecent?.gamesPlayed);
  const lineupRatingDiff = Number(
    (
      Number(input.lineupSummary?.home?.avgRating || 0) -
      Number(input.lineupSummary?.away?.avgRating || 0)
    ).toFixed(2)
  );
  const homeContinuity = calcLineupContinuity(input.lineupSummary?.home, input.homeInjuries);
  const awayContinuity = calcLineupContinuity(input.lineupSummary?.away, input.awayInjuries);
  const awayTravelPenalty = calcTravelPenalty(input);
  const keeperRatingDiff = calcKeeperEdge(input.lineupSummary);
  const homeLearning = input.homeLearning || {};
  const awayLearning = input.awayLearning || {};
  const homeMarket = input.homeMarketProfile || {};
  const awayMarket = input.awayMarketProfile || {};
  const leagueReliability = input.leagueReliability || {};
  const refereeProfile = input.refereeProfile || {};

  return {
    home_avg_scored: Number(input.homeRecent?.avgScored || 1.35),
    away_avg_scored: Number(input.awayRecent?.avgScored || 1.35),
    home_avg_conceded: Number(input.homeRecent?.avgConceded || 1.35),
    away_avg_conceded: Number(input.awayRecent?.avgConceded || 1.35),
    home_home_split_scored: Number(homeSplit.avgScored || 1.35),
    home_home_split_conceded: Number(homeSplit.avgConceded || 1.35),
    away_away_split_scored: Number(awaySplit.avgScored || 1.35),
    away_away_split_conceded: Number(awaySplit.avgConceded || 1.35),
    home_ppg: homePpg,
    away_ppg: awayPpg,
    ppg_diff: Number((homePpg - awayPpg).toFixed(2)),
    home_rest_days: Number(input.homeRestDays ?? 0),
    away_rest_days: Number(input.awayRestDays ?? 0),
    rest_diff: Number((Number(input.homeRestDays ?? 0) - Number(input.awayRestDays ?? 0)).toFixed(2)),
    club_elo_diff: Number((Number(input.homeClubElo || 0) - Number(input.awayClubElo || 0)).toFixed(0)),
    home_injuries: Number(input.homeInjuries?.injuredCount || 0),
    away_injuries: Number(input.awayInjuries?.injuredCount || 0),
    weather_risk:
      input.weather?.riskLevel === "high" ? 2 : input.weather?.riskLevel === "medium" ? 1 : 0,
    lineups_confirmed: input.lineupSummary?.confirmed ? 1 : 0,
    h2h_balance:
      input.h2h?.played >= 1
        ? Number(
            (
              (Number(input.h2h.homeWins || 0) - Number(input.h2h.awayWins || 0)) /
              Math.max(Number(input.h2h.played || 1), 1)
            ).toFixed(2)
          )
        : 0,
    h2h_recent_5_balance: calculateRecentH2HBalance(input.h2h, input.homeTeamId, input.awayTeamId),
    recent_h2h_balance:
      input.h2h?.results?.length >= 1
        ? Number(
            (() => {
              const recent5 = (input.h2h.results || []).slice(-5);
              let homeWins = 0;
              let awayWins = 0;
              recent5.forEach(r => {
                if (r.winnerId === input.homeTeamId) homeWins++;
                else if (r.winnerId === input.awayTeamId) awayWins++;
              });
              return ((homeWins - awayWins) / Math.max(recent5.length, 1)).toFixed(2);
            })()
          )
        : 0,
    match_importance: Number(input.matchImportance || 1),
    home_btts_rate: Number(input.homeRecent?.bttsRate || 0.5),
    away_btts_rate: Number(input.awayRecent?.bttsRate || 0.5),
    home_over25_home: Number(homeSplit.over25Rate || 0.45),
    away_over25_away: Number(awaySplit.over25Rate || 0.45),
    home_yellow_rate: Number(input.homeRecent?.yellowCardRate || 0),
    away_yellow_rate: Number(input.awayRecent?.yellowCardRate || 0),
    home_cards_rate: Number(
      (
        Number(input.homeRecent?.yellowCardRate || 0) +
        Number(input.homeRecent?.redCardRate || 0) * 1.8
      ).toFixed(2)
    ),
    away_cards_rate: Number(
      (
        Number(input.awayRecent?.yellowCardRate || 0) +
        Number(input.awayRecent?.redCardRate || 0) * 1.8
      ).toFixed(2)
    ),
    home_avg_corners: Number(input.homeSeasonStats?.avgCorners || 0),
    away_avg_corners: Number(input.awaySeasonStats?.avgCorners || 0),
    set_piece_diff: Number(
      (
        Number(input.homeTeamProfile?.setPieceScore || 0) -
        Number(input.awayTeamProfile?.setPieceScore || 0)
      ).toFixed(2)
    ),
    home_learning_outcome_hit: Number(homeLearning.outcomeHitRate || 0.5),
    away_learning_outcome_hit: Number(awayLearning.outcomeHitRate || 0.5),
    home_learning_goal_bias: Number(homeLearning.homeGoalBias || 0),
    away_learning_goal_bias: Number(awayLearning.awayGoalBias || 0),
    learning_outcome_bias_diff: Number(
      (
        Number(homeLearning.homeOutcomeBias || 0) -
        Number(awayLearning.awayOutcomeBias || 0)
      ).toFixed(2)
    ),
    home_market_implied_ppg: Number(homeMarket.homeImpliedPpg || homeMarket.homeActualPpg || 1.25),
    away_market_implied_ppg: Number(awayMarket.awayImpliedPpg || awayMarket.awayActualPpg || 1.25),
    market_overperformance_diff: Number(
      (
        Number(homeMarket.homeOverperformance || 0) -
        Number(awayMarket.awayOverperformance || 0)
      ).toFixed(2)
    ),
    market_strength: Number(input.marketCalibration?.strength || 0),
    league_reliability: Number(leagueReliability.reliabilityScore || 0.5),
    league_avg_goal_error: Number(leagueReliability.avgGoalError || 2),
    referee_cards_trend: Number(refereeProfile.cardsTrend || 0),
    referee_penalty_rate: Number(refereeProfile.estimatedPenaltyRate || 0),
    lineups_avg_rating_diff: lineupRatingDiff,
    home_lineup_continuity: homeContinuity,
    away_lineup_continuity: awayContinuity,
    keeper_rating_diff: keeperRatingDiff,
    away_travel_penalty: awayTravelPenalty,
  };
}

function buildHeuristicEnsemble(featureVector) {
  let homeScore = 0;
  let drawScore = 0;
  let awayScore = 0;

  homeScore += featureVector.ppg_diff * 0.22;
  awayScore -= featureVector.ppg_diff * 0.22;
  homeScore += featureVector.club_elo_diff / 180 * 0.18;
  awayScore -= featureVector.club_elo_diff / 180 * 0.18;
  homeScore += featureVector.rest_diff * 0.08;
  awayScore -= featureVector.rest_diff * 0.08;
  homeScore += (featureVector.home_home_split_scored - featureVector.away_away_split_conceded) * 0.16;
  awayScore += (featureVector.away_away_split_scored - featureVector.home_home_split_conceded) * 0.16;
  homeScore += featureVector.set_piece_diff * 0.04;
  awayScore -= featureVector.set_piece_diff * 0.04;
  homeScore += (featureVector.home_avg_corners - featureVector.away_avg_corners) * 0.015;
  awayScore += (featureVector.away_avg_corners - featureVector.home_avg_corners) * 0.015;
  homeScore += featureVector.lineups_avg_rating_diff * 0.05;
  awayScore -= featureVector.lineups_avg_rating_diff * 0.05;
  homeScore += featureVector.keeper_rating_diff * 0.035;
  awayScore -= featureVector.keeper_rating_diff * 0.035;
  homeScore += (featureVector.home_lineup_continuity - featureVector.away_lineup_continuity) * 0.16;
  awayScore += (featureVector.away_lineup_continuity - featureVector.home_lineup_continuity) * 0.16;
  homeScore += featureVector.away_travel_penalty * 0.18;
  awayScore -= featureVector.away_travel_penalty * 0.18;
  homeScore += featureVector.market_overperformance_diff * 0.1 * Math.max(featureVector.market_strength, 0.35);
  awayScore -= featureVector.market_overperformance_diff * 0.1 * Math.max(featureVector.market_strength, 0.35);
  homeScore += (featureVector.league_reliability - 0.5) * 0.08;
  awayScore += (featureVector.league_reliability - 0.5) * 0.08;
  drawScore += Math.max(0, 0.12 - featureVector.referee_penalty_rate * 0.08);
  homeScore -= Math.max(0, featureVector.referee_cards_trend - 2.8) * 0.02;
  awayScore -= Math.max(0, featureVector.referee_cards_trend - 2.8) * 0.02;
  drawScore += Math.max(0, 0.25 - Math.abs(featureVector.ppg_diff) * 0.06);
  drawScore += Math.max(0, 0.18 - Math.abs(featureVector.club_elo_diff) / 1000);
  homeScore -= featureVector.home_injuries * 0.05;
  awayScore -= featureVector.away_injuries * 0.05;
  homeScore -= featureVector.home_cards_rate * 0.015;
  awayScore -= featureVector.away_cards_rate * 0.015;
  // H2H algemeen patroon (lichte weging)
  homeScore += featureVector.h2h_balance * 0.08;
  awayScore -= featureVector.h2h_balance * 0.08;
  // H2H laatste 5 wedstrijden (zware weging voor recente onderlinge vorm)
  homeScore += featureVector.h2h_recent_5_balance * 0.20;
  awayScore -= featureVector.h2h_recent_5_balance * 0.20;
  // Leermodel per team
  homeScore += featureVector.learning_outcome_bias_diff * 0.16;
  awayScore -= featureVector.learning_outcome_bias_diff * 0.16;
  homeScore += featureVector.home_learning_goal_bias * 0.05;
  awayScore += featureVector.away_learning_goal_bias * 0.05;
  // Historische marktprofilering uit gratis oddsdata
  homeScore += (featureVector.home_market_implied_ppg - featureVector.away_market_implied_ppg) * 0.12;
  awayScore += (featureVector.away_market_implied_ppg - featureVector.home_market_implied_ppg) * 0.12;
  homeScore += featureVector.market_overperformance_diff * 0.10;
  awayScore -= featureVector.market_overperformance_diff * 0.10;

  const homeRaw = Math.exp(homeScore);
  const drawRaw = Math.exp(drawScore);
  const awayRaw = Math.exp(awayScore);
  const total = homeRaw + drawRaw + awayRaw;

  return {
    homeProb: Number((homeRaw / total).toFixed(4)),
    drawProb: Number((drawRaw / total).toFixed(4)),
    awayProb: Number((awayRaw / total).toFixed(4)),
  };
}

function blendProbabilities(base, heuristic, weightBase = 0.78) {
  const weightHeuristic = 1 - weightBase;
  const homeProb = base.homeProb * weightBase + heuristic.homeProb * weightHeuristic;
  const drawProb = base.drawProb * weightBase + heuristic.drawProb * weightHeuristic;
  const awayProb = base.awayProb * weightBase + heuristic.awayProb * weightHeuristic;
  const total = homeProb + drawProb + awayProb;
  return {
    homeProb: Number((homeProb / total).toFixed(4)),
    drawProb: Number((drawProb / total).toFixed(4)),
    awayProb: Number((awayProb / total).toFixed(4)),
  };
}

function calcModelAgreement(base, heuristic) {
  const diffs = [
    Math.abs(Number(base.homeProb || 0) - Number(heuristic.homeProb || 0)),
    Math.abs(Number(base.drawProb || 0) - Number(heuristic.drawProb || 0)),
    Math.abs(Number(base.awayProb || 0) - Number(heuristic.awayProb || 0)),
  ];
  const avgDiff = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
  return Number(Math.max(0, 1 - avgDiff * 4).toFixed(3));
}

function buildLineupImpact(input) {
  const homeInjuries = Number(input.homeInjuries?.injuredCount || 0);
  const awayInjuries = Number(input.awayInjuries?.injuredCount || 0);
  const homeRating = Number(input.lineupSummary?.home?.avgRating || 6.8);
  const awayRating = Number(input.lineupSummary?.away?.avgRating || 6.8);
  const ratingDiff = Number((homeRating - awayRating).toFixed(2));
  const keeperDiff = calcKeeperEdge(input.lineupSummary);
  const homeContinuity = calcLineupContinuity(input.lineupSummary?.home, input.homeInjuries);
  const awayContinuity = calcLineupContinuity(input.lineupSummary?.away, input.awayInjuries);

  const homeImpact = Number((homeInjuries * 0.12 - Math.max(0, ratingDiff) * 0.08 - Math.max(0, keeperDiff) * 0.04).toFixed(2));
  const awayImpact = Number((awayInjuries * 0.12 + Math.min(0, ratingDiff) * -0.08 + Math.min(0, keeperDiff) * 0.04 * -1).toFixed(2));

  let summary = "neutraal";
  if (homeImpact + 0.12 < awayImpact) summary = "thuisvoordeel in opstelling";
  else if (awayImpact + 0.12 < homeImpact) summary = "uitvoordeel in opstelling";

  return {
    confirmed: !!input.lineupSummary?.confirmed,
    homeImpact,
    awayImpact,
    ratingDiff,
    keeperDiff,
    homeContinuity,
    awayContinuity,
    summary,
  };
}

function buildTacticalMismatch(input) {
  const homeSplit = pickHomeStrength(input.homeRecent);
  const awaySplit = pickAwayStrength(input.awayRecent);
  const homeScore = Number(((homeSplit.avgScored || 1.35) + (awaySplit.avgConceded || 1.35)).toFixed(2));
  const awayScore = Number(((awaySplit.avgScored || 1.35) + (homeSplit.avgConceded || 1.35)).toFixed(2));

  let summary = "gebalanceerd";
  if (homeScore > awayScore + 0.35) summary = "thuis aanvallende mismatch";
  else if (awayScore > homeScore + 0.35) summary = "uit aanvallende mismatch";

  return {
    homeScore,
    awayScore,
    summary,
  };
}

function buildFormShift(input) {
  const homeSplit = pickHomeStrength(input.homeRecent);
  const awaySplit = pickAwayStrength(input.awayRecent);
  const homeShift = Number(((Number(input.homeRecent?.avgScored || 1.35) - Number(homeSplit.avgScored || 1.35))).toFixed(2));
  const awayShift = Number(((Number(input.awayRecent?.avgScored || 1.35) - Number(awaySplit.avgScored || 1.35))).toFixed(2));

  return {
    homeShift,
    awayShift,
    summary:
      Math.abs(homeShift) < 0.15 && Math.abs(awayShift) < 0.15
        ? "stabiel"
        : homeShift > awayShift
          ? "thuis vorm stijgt sneller"
          : "uit vorm stijgt sneller",
  };
}

function buildTravelEdge(input, featureVector) {
  const penalty = Number(featureVector?.away_travel_penalty || 0);
  if (penalty <= 0) {
    return { penalty, summary: "geen noemenswaardige reisimpact" };
  }
  return {
    penalty,
    summary:
      input.leagueType === "cup"
        ? "uitploeg heeft extra Europese reislast"
        : "uitploeg heeft extra reislast",
  };
}

function buildKeeperEdge(input, featureVector) {
  const diff = Number(featureVector?.keeper_rating_diff || 0);
  if (Math.abs(diff) < 0.05) return { diff, summary: "keepers liggen dicht bij elkaar" };
  return {
    diff,
    summary: diff > 0 ? "thuiskeeper oogt sterker" : "uitkeeper oogt sterker",
  };
}

function buildRiskProfile({ confidence, agreement, weatherRisk, lineupConfirmed, injuriesTotal, awayTravelPenalty, keeperDiff }) {
  let score = 0;
  if (confidence < 0.48) score += 2;
  else if (confidence < 0.6) score += 1;

  if (agreement < 0.65) score += 2;
  else if (agreement < 0.78) score += 1;

  if (weatherRisk === "medium") score += 1;
  if (weatherRisk === "high") score += 2;
  if (!lineupConfirmed) score += 1;
  if (injuriesTotal >= 4) score += 1;
  if (awayTravelPenalty >= 0.2) score += 1;
  if (Math.abs(Number(keeperDiff || 0)) >= 0.35) score -= 1;

  if (score >= 5) return "hoog";
  if (score >= 3) return "middel";
  return "laag";
}

function buildTeamAiSummary(side, teamName, recent, profile, injuries) {
  const split = side === "home" ? recent?.splits?.home : recent?.splits?.away;
  const strengths = [];
  const risks = [];

  if ((profile?.pointsPerGame || 0) >= 1.9) strengths.push("hoog puntenritme");
  if ((profile?.pointsPerGame || 0) <= 1.1) risks.push("laag puntenritme");
  if ((profile?.attackTrend || 0) >= 0.45) strengths.push("positieve aanvalstrend");
  if ((profile?.attackTrend || 0) <= -0.2) risks.push("negatieve vormtrend");
  if ((split?.cleanSheetRate || 0) >= 0.35) strengths.push("sterke verdedigende split");
  if ((split?.failToScoreRate || recent?.failToScoreRate || 0) >= 0.35) risks.push("regelmatig moeite met scoren");
  if ((injuries?.injuredCount || injuries?.count || 0) >= 3) risks.push("meerdere afwezigen");
  if ((profile?.setPieceScore || 0) >= 3.8) strengths.push("sterk in standaardsituaties");
  if ((profile?.cornersTrend || 0) >= 5.2) strengths.push("hoog cornersvolume");
  if ((recent?.yellowCardRate || 0) >= 2.4) risks.push("hoog kaartenritme");
  if ((profile?.fatigueIndex || 0) >= 1.2) risks.push("vermoeidheidsrisico");

  return {
    teamName,
    strengths: strengths.slice(0, 3),
    risks: risks.slice(0, 3),
    summary:
      strengths.length || risks.length
        ? `${teamName}: ${[...strengths.slice(0, 2), ...risks.slice(0, 2)].join(", ")}`
        : `${teamName}: weinig afwijkende signalen`,
  };
}

function buildTrainingSnapshot(store) {
  const rows = [];
  for (const date of Object.keys(store.matches || {})) {
    const matches = store.matches?.[date] || [];
    const predictions = Object.fromEntries(
      (store.predictions?.[date] || []).map((prediction) => [prediction.matchId, prediction])
    );

    for (const match of matches) {
      const prediction = predictions[match.id] || {};
      rows.push({
        date,
        matchId: match.id,
        league: match.league,
        homeTeam: match.homeTeamName,
        awayTeam: match.awayTeamName,
        status: match.status || "NS",
        score: match.score || null,
        label:
          String(match.status || "").toUpperCase() === "FT" && match.score?.includes("-")
            ? (() => {
                const [homeGoals, awayGoals] = String(match.score).split("-").map(Number);
                if (homeGoals > awayGoals) return "H";
                if (homeGoals < awayGoals) return "A";
                return "D";
              })()
            : null,
        featureVector: prediction.featureVector || null,
        ensembleMeta: prediction.ensembleMeta || null,
        review: store.postMatchReviews?.[match.id] || null,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    version: "v7-ref-market-league",
    reviewCount: Object.keys(store.postMatchReviews || {}).length,
    rows,
  };
}

function buildLearningEdge(input) {
  const home = input.homeLearning || null;
  const away = input.awayLearning || null;
  const homeBias = Number(home?.homeOutcomeBias || 0);
  const awayBias = Number(away?.awayOutcomeBias || 0);
  const homeReliability = Number(home?.outcomeHitRate || 0);
  const awayReliability = Number(away?.outcomeHitRate || 0);
  const summary = home || away
    ? `${input.homeTeamProfile?.teamName || "Thuis"} ${homeBias >= 0 ? "licht onderschat" : "licht overschat"} (${Math.round(homeReliability * 100)}%) / ${input.awayTeamProfile?.teamName || "Uit"} ${awayBias >= 0 ? "licht onderschat" : "licht overschat"} (${Math.round(awayReliability * 100)}%)`
    : "nog geen reviewdata";

  return {
    summary,
    homeOutcomeHitRate: homeReliability,
    awayOutcomeHitRate: awayReliability,
    homeBias,
    awayBias,
    homeAvgGoalError: Number(home?.avgGoalError || 0),
    awayAvgGoalError: Number(away?.avgGoalError || 0),
    combinedReliability: Number(((homeReliability + awayReliability) / ((home || away) ? (home && away ? 2 : 1) : 1)).toFixed(2)),
    homeFragility:
      Number(home?.openLineupMisses || 0) +
      Number(home?.weatherMisses || 0) +
      Number(home?.h2hMisses || 0),
    awayFragility:
      Number(away?.openLineupMisses || 0) +
      Number(away?.weatherMisses || 0) +
      Number(away?.h2hMisses || 0),
  };
}

function buildMarketCalibration(input) {
  const home = input.homeMarketProfile || null;
  const away = input.awayMarketProfile || null;
  if (!home && !away) {
    return {
      summary: "geen historische marktdata gekoppeld",
      source: "football-data.co.uk",
      homeImpliedPpg: null,
      awayImpliedPpg: null,
      overperformanceDiff: 0,
      strength: 0,
      closingLean: "neutral",
    };
  }

  const homeImplied = Number(home?.homeImpliedPpg || home?.homeActualPpg || 0);
  const awayImplied = Number(away?.awayImpliedPpg || away?.awayActualPpg || 0);
  const diff = Number(
    (
      Number(home?.homeOverperformance || 0) -
      Number(away?.awayOverperformance || 0)
    ).toFixed(2)
  );
  const sampleGames = Number(home?.homeGames || 0) + Number(away?.awayGames || 0);
  const strength = Number(Math.min(sampleGames / 26, 1).toFixed(2));
  const closingLean = diff >= 0.35 ? "home" : diff <= -0.35 ? "away" : "neutral";

  return {
    summary: `closing-profiel ${input.homeTeamProfile?.teamName || "thuis"} ${homeImplied.toFixed(2)} PPG vs ${input.awayTeamProfile?.teamName || "uit"} ${awayImplied.toFixed(2)} PPG`,
    source: "football-data.co.uk",
    homeImpliedPpg: homeImplied,
    awayImpliedPpg: awayImplied,
    overperformanceDiff: diff,
    homeGames: Number(home?.homeGames || 0),
    awayGames: Number(away?.awayGames || 0),
    strength,
    closingLean,
  };
}

function getSeasonFolder(dateISO) {
  const base = dateISO ? new Date(`${dateISO}T12:00:00Z`) : new Date();
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const startYear = month >= 6 ? year : year - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}${String(endYear).slice(-2)}`;
}

async function fetchText(url) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/plain,text/csv,text/*;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function parseCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? "";
    });
    return row;
  });
}

function toNumber(value) {
  const numeric = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function pickOdds(row, keys) {
  for (const key of keys) {
    const value = toNumber(row?.[key]);
    if (value && value > 1.01) return value;
  }
  return null;
}

function outcomeFromGoals(homeGoals, awayGoals) {
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
  if (homeGoals > awayGoals) return "H";
  if (homeGoals < awayGoals) return "A";
  return "D";
}

function normalizeProbabilities(home, draw, away) {
  const sum = Number(home || 0) + Number(draw || 0) + Number(away || 0);
  if (!sum) {
    return { home: 0.33, draw: 0.34, away: 0.33 };
  }
  return {
    home: Number((home / sum).toFixed(4)),
    draw: Number((draw / sum).toFixed(4)),
    away: Number((away / sum).toFixed(4)),
  };
}

function buildMarketProfiles(rows) {
  const teams = {};

  for (const row of rows || []) {
    const homeTeam = String(row.HomeTeam || row.homeTeam || "").trim();
    const awayTeam = String(row.AwayTeam || row.awayTeam || "").trim();
    const homeGoals = toNumber(row.FTHG);
    const awayGoals = toNumber(row.FTAG);
    const result = String(row.FTR || outcomeFromGoals(homeGoals, awayGoals) || "");
    const homeOdds = pickOdds(row, ["B365H", "AvgH", "PSH", "MaxH"]);
    const drawOdds = pickOdds(row, ["B365D", "AvgD", "PSD", "MaxD"]);
    const awayOdds = pickOdds(row, ["B365A", "AvgA", "PSA", "MaxA"]);

    if (!homeTeam || !awayTeam || !homeOdds || !drawOdds || !awayOdds || !result) continue;

    const implied = normalizeProbabilities(1 / homeOdds, 1 / drawOdds, 1 / awayOdds);
    const actualHomePoints = result === "H" ? 3 : result === "D" ? 1 : 0;
    const actualAwayPoints = result === "A" ? 3 : result === "D" ? 1 : 0;
    const impliedHomePoints = implied.home * 3 + implied.draw;
    const impliedAwayPoints = implied.away * 3 + implied.draw;

    const homeKey = normalizeName(homeTeam);
    const awayKey = normalizeName(awayTeam);
    if (!teams[homeKey]) {
      teams[homeKey] = {
        teamName: homeTeam,
        homeGames: 0,
        awayGames: 0,
        totalGames: 0,
        homeActualPoints: 0,
        awayActualPoints: 0,
        homeImpliedPoints: 0,
        awayImpliedPoints: 0,
      };
    }
    if (!teams[awayKey]) {
      teams[awayKey] = {
        teamName: awayTeam,
        homeGames: 0,
        awayGames: 0,
        totalGames: 0,
        homeActualPoints: 0,
        awayActualPoints: 0,
        homeImpliedPoints: 0,
        awayImpliedPoints: 0,
      };
    }

    teams[homeKey].homeGames += 1;
    teams[homeKey].totalGames += 1;
    teams[homeKey].homeActualPoints += actualHomePoints;
    teams[homeKey].homeImpliedPoints += impliedHomePoints;

    teams[awayKey].awayGames += 1;
    teams[awayKey].totalGames += 1;
    teams[awayKey].awayActualPoints += actualAwayPoints;
    teams[awayKey].awayImpliedPoints += impliedAwayPoints;
  }

  const formattedTeams = {};
  for (const [key, value] of Object.entries(teams)) {
    const homeActualPpg = value.homeGames ? value.homeActualPoints / value.homeGames : 0;
    const awayActualPpg = value.awayGames ? value.awayActualPoints / value.awayGames : 0;
    const homeImpliedPpg = value.homeGames ? value.homeImpliedPoints / value.homeGames : 0;
    const awayImpliedPpg = value.awayGames ? value.awayImpliedPoints / value.awayGames : 0;
    formattedTeams[key] = {
      teamName: value.teamName,
      totalGames: value.totalGames,
      homeGames: value.homeGames,
      awayGames: value.awayGames,
      homeActualPpg: Number(homeActualPpg.toFixed(2)),
      awayActualPpg: Number(awayActualPpg.toFixed(2)),
      homeImpliedPpg: Number(homeImpliedPpg.toFixed(2)),
      awayImpliedPpg: Number(awayImpliedPpg.toFixed(2)),
      homeOverperformance: Number((homeActualPpg - homeImpliedPpg).toFixed(2)),
      awayOverperformance: Number((awayActualPpg - awayImpliedPpg).toFixed(2)),
    };
  }

  return {
    updatedAt: Date.now(),
    sampleSize: rows.length,
    teams: formattedTeams,
  };
}

async function fetchHistoricalMarketProfile(leagueLabel, dateISO) {
  const code = MARKET_LEAGUE_CODES[leagueLabel];
  if (!code) return null;

  const seasonFolder = getSeasonFolder(dateISO);
  const url = `https://www.football-data.co.uk/mmz4281/${seasonFolder}/${code}.csv`;
  const csvText = await fetchText(url);
  if (!csvText) return null;
  const rows = parseCsv(csvText);
  if (!rows.length) return null;
  return buildMarketProfiles(rows);
}

function lookupMarketTeamProfile(leagueMarketProfile, teamName) {
  const teams = leagueMarketProfile?.teams || {};
  for (const variant of buildPossibleNames(teamName)) {
    if (teams[variant]) return teams[variant];
  }
  return null;
}

function getPredictedOutcome(prediction) {
  const homeProb = Number(prediction?.homeProb || 0);
  const drawProb = Number(prediction?.drawProb || 0);
  const awayProb = Number(prediction?.awayProb || 0);
  if (homeProb >= drawProb && homeProb >= awayProb) return "H";
  if (awayProb >= drawProb && awayProb >= homeProb) return "A";
  return "D";
}

function buildPostMatchReview(match, prediction) {
  if (String(match?.status || "").toUpperCase() !== "FT" || !String(match?.score || "").includes("-")) return null;
  if (!prediction) return null;

  const [actualHomeGoals, actualAwayGoals] = String(match.score).split("-").map(Number);
  if (!Number.isFinite(actualHomeGoals) || !Number.isFinite(actualAwayGoals)) return null;

  const predHomeGoals = Number(prediction.predHomeGoals || 0);
  const predAwayGoals = Number(prediction.predAwayGoals || 0);
  const predictedOutcome = outcomeFromGoals(predHomeGoals, predAwayGoals);
  const probabilityOutcome = getPredictedOutcome(prediction);
  const actualOutcome = outcomeFromGoals(actualHomeGoals, actualAwayGoals);
  const totalGoalError = Math.abs(predHomeGoals - actualHomeGoals) + Math.abs(predAwayGoals - actualAwayGoals);
  const totalGoalBias = Number(
    ((actualHomeGoals + actualAwayGoals) - (predHomeGoals + predAwayGoals)).toFixed(2)
  );

  const failureSignals = [];
  if (predictedOutcome !== actualOutcome) {
    if (Math.abs(Number(prediction?.modelEdges?.clubEloDiff || 0)) >= 80) failureSignals.push("clubelo_misread");
    if (!prediction?.modelEdges?.lineupConfirmed) failureSignals.push("open_lineups");
    if (prediction?.weatherRisk === "high" || prediction?.modelEdges?.weatherRisk === "high") failureSignals.push("weather_risk");
    if (Math.abs(Number(prediction?.modelEdges?.rest || 0)) >= 2) failureSignals.push("rest_gap");
    if (match?.h2h?.results?.length >= 3) failureSignals.push("h2h_signal");
    if (Math.abs(Number(prediction?.modelEdges?.marketCalibration?.overperformanceDiff || 0)) >= 0.45) failureSignals.push("market_misread");
    if (Number(prediction?.modelEdges?.modelAgreement || 0) < 0.45) failureSignals.push("low_model_agreement");
  }

  return {
    matchId: match.id,
    date: match.date,
    league: match.league,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    homeTeamName: match.homeTeamName,
    awayTeamName: match.awayTeamName,
    predictedScore: `${predHomeGoals}-${predAwayGoals}`,
    actualScore: match.score,
    predictedOutcome,
    probabilityOutcome,
    actualOutcome,
    confidence: Number(prediction.confidence || 0),
    outcomeHit: predictedOutcome === actualOutcome,
    probabilityOutcomeHit: probabilityOutcome === actualOutcome,
    exactHit: predHomeGoals === actualHomeGoals && predAwayGoals === actualAwayGoals,
    totalGoalError,
    totalGoalBias,
    homeGoalBias: Number((actualHomeGoals - predHomeGoals).toFixed(2)),
    awayGoalBias: Number((actualAwayGoals - predAwayGoals).toFixed(2)),
    failureSignals,
    createdAt: Date.now(),
  };
}

function buildTeamLearningFromReviews(reviews) {
  const learning = {};

  function ensureTeam(teamId, teamName) {
    const key = teamId ? `id:${teamId}` : `name:${normalizeName(teamName)}`;
    if (!learning[key]) {
      learning[key] = {
        teamId: teamId || "",
        teamName: teamName || "Unknown",
        reviewedMatches: 0,
        outcomeHits: 0,
        exactHits: 0,
        totalGoalError: 0,
        homeGoalBias: 0,
        awayGoalBias: 0,
        overvaluedHome: 0,
        overvaluedAway: 0,
        undervaluedHome: 0,
        undervaluedAway: 0,
        openLineupMisses: 0,
        weatherMisses: 0,
        h2hMisses: 0,
      };
    }
    return learning[key];
  }

  for (const review of Object.values(reviews || {})) {
    const home = ensureTeam(review.homeTeamId, review.homeTeamName);
    const away = ensureTeam(review.awayTeamId, review.awayTeamName);

    for (const team of [home, away]) {
      team.reviewedMatches += 1;
      if (review.outcomeHit) team.outcomeHits += 1;
      if (review.exactHit) team.exactHits += 1;
      team.totalGoalError += Number(review.totalGoalError || 0);
    }

    home.homeGoalBias += Number(review.homeGoalBias || 0);
    away.awayGoalBias += Number(review.awayGoalBias || 0);

    if (review.predictedOutcome === "H" && review.actualOutcome !== "H") home.overvaluedHome += 1;
    if (review.predictedOutcome !== "H" && review.actualOutcome === "H") home.undervaluedHome += 1;
    if (review.predictedOutcome === "A" && review.actualOutcome !== "A") away.overvaluedAway += 1;
    if (review.predictedOutcome !== "A" && review.actualOutcome === "A") away.undervaluedAway += 1;

    if ((review.failureSignals || []).includes("open_lineups")) {
      home.openLineupMisses += 1;
      away.openLineupMisses += 1;
    }
    if ((review.failureSignals || []).includes("weather_risk")) {
      home.weatherMisses += 1;
      away.weatherMisses += 1;
    }
    if ((review.failureSignals || []).includes("h2h_signal")) {
      home.h2hMisses += 1;
      away.h2hMisses += 1;
    }
  }

  for (const team of Object.values(learning)) {
    const games = Math.max(Number(team.reviewedMatches || 0), 1);
    team.outcomeHitRate = Number((team.outcomeHits / games).toFixed(2));
    team.exactHitRate = Number((team.exactHits / games).toFixed(2));
    team.avgGoalError = Number((team.totalGoalError / games).toFixed(2));
    team.homeGoalBias = Number((team.homeGoalBias / games).toFixed(2));
    team.awayGoalBias = Number((team.awayGoalBias / games).toFixed(2));
    team.homeOutcomeBias = Number(((team.undervaluedHome - team.overvaluedHome) / games).toFixed(2));
    team.awayOutcomeBias = Number(((team.undervaluedAway - team.overvaluedAway) / games).toFixed(2));
    team.summary =
      team.reviewedMatches >= 3
        ? `${team.teamName}: hitrate ${Math.round(team.outcomeHitRate * 100)}%, goal error ${team.avgGoalError}, home bias ${team.homeOutcomeBias}, away bias ${team.awayOutcomeBias}`
        : `${team.teamName}: nog te weinig reviewdata`;
  }

  return learning;
}

function rebuildReviewsAndLearning(store) {
  const reviews = {};

  for (const date of Object.keys(store.matches || {})) {
    const matches = store.matches?.[date] || [];
    const predictions = Object.fromEntries(
      (store.predictions?.[date] || []).map((prediction) => [prediction.matchId, prediction])
    );

    for (const match of matches) {
      const review = buildPostMatchReview(match, predictions[match.id]);
      if (review) reviews[match.id] = review;
    }
  }

  store.postMatchReviews = reviews;
  store.teamLearning = buildTeamLearningFromReviews(reviews);
  store.leagueReliability = buildLeagueReliabilityFromReviews(reviews);
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
  if (shouldExcludeEvent(event)) return null;
  const tournament = String(
    event?.uniqueTournament?.name || event?.tournament?.name || ""
  ).toLowerCase();
  const country = String(event?.tournament?.category?.name || "").toLowerCase();
  const international = getInternationalLeagueInfo(event);
  if (international) return international;
  return LEAGUES.find(
    (league) =>
      (!league.country || country.includes(league.country)) &&
      (tournament === league.name || tournament.includes(league.name))
  ) || null;
}

function purgeExcludedContent(store) {
  const excludedTeamIds = new Set();

  for (const [date, matches] of Object.entries(store.matches || {})) {
    const safeMatches = [];
    for (const match of matches || []) {
      const excluded =
        isWomenContext(match?.league, match?.homeTeamName, match?.awayTeamName) ||
        isYouthContext(match?.league, match?.homeTeamName, match?.awayTeamName);
      if (excluded) {
        if (match?.homeTeamId) excludedTeamIds.add(String(match.homeTeamId));
        if (match?.awayTeamId) excludedTeamIds.add(String(match.awayTeamId));
      } else {
        safeMatches.push(match);
      }
    }
    store.matches[date] = safeMatches;
    store.predictions[date] = (store.predictions?.[date] || []).filter(
      (prediction) =>
        !isWomenContext(prediction?.league, prediction?.homeTeamName, prediction?.awayTeamName) &&
        !isYouthContext(prediction?.league, prediction?.homeTeamName, prediction?.awayTeamName)
    );
  }

  for (const key of Object.keys(store.teams || {})) {
    const team = store.teams[key];
    if (excludedTeamIds.has(String(team?.id || "")) || isWomenContext(team?.league, team?.name) || isYouthContext(team?.league, team?.name)) {
      delete store.teams[key];
    }
  }

  const keyedMaps = [
    "teamStats",
    "teamStatsUpdated",
    "teamInjuries",
    "teamInjuriesUpdated",
    "teamSeasonStats",
    "teamSeasonStatsUpdated",
  ];

  for (const mapName of keyedMaps) {
    if (!store[mapName]) continue;
    for (const key of Object.keys(store[mapName])) {
      if (excludedTeamIds.has(String(key))) delete store[mapName][key];
    }
  }
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

async function fetchTeamForm(teamId, options = {}) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/events/last/0`);
  const targetSegment =
    options.segment ||
    getCompetitionSegment(options.teamName, options.tournamentName);
  const finished = (json?.events || [])
    .filter((event) => getCompetitionSegment(
      event?.homeTeam?.name,
      event?.awayTeam?.name,
      event?.tournament?.name,
      event?.uniqueTournament?.name
    ) === targetSegment)
    .filter((event) => event.status?.type === "finished")
    .sort((a, b) => Number(a.startTimestamp || 0) - Number(b.startTimestamp || 0));

  if (!finished.length) {
    return {
      form: "",
      avgScored: 1.35,
      avgConceded: 1.35,
      bttsRate: 0.5,
      over15Rate: 0.5,
      over25Rate: 0.45,
      cleanSheetRate: 0.2,
      failToScoreRate: 0.25,
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
  let yellowCards = 0;
  let redCards = 0;
  const splitState = {
    home: { games: 0, scored: 0, conceded: 0, btts: 0, over15: 0, over25: 0, cleanSheets: 0, failToScore: 0, wins: 0, draws: 0, losses: 0 },
    away: { games: 0, scored: 0, conceded: 0, btts: 0, over15: 0, over25: 0, cleanSheets: 0, failToScore: 0, wins: 0, draws: 0, losses: 0 },
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
    if (gf + ga > 1) target.over15 += 1;
    if (gf + ga > 2) target.over25 += 1;
    if (ga === 0) target.cleanSheets += 1;
    if (gf === 0) target.failToScore += 1;
    if (gf > ga) target.wins += 1;
    else if (gf === ga) target.draws += 1;
    else target.losses += 1;

    for (const incident of event.incidents || []) {
      const type = String(incident.incidentType || "").toLowerCase();
      const klass = String(incident.incidentClass || "").toLowerCase();
      const isCard = type.includes("card") || klass.includes("card") || klass.includes("yellow") || klass.includes("red");
      if (!isCard) continue;

      const byTeam = isHome ? incident.isHome !== false : incident.isHome === false;
      if (!byTeam) continue;

      if (klass.includes("red")) redCards += 1;
      else yellowCards += 1;
    }
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
    over15Rate: Number((sample.filter((event) => {
      const isHome = String(event.homeTeam?.id || "") === String(teamId);
      const gf = isHome ? event.homeScore?.current : event.awayScore?.current;
      const ga = isHome ? event.awayScore?.current : event.homeScore?.current;
      return gf != null && ga != null && gf + ga > 1;
    }).length / sample.length).toFixed(2)),
    over25Rate: Number((sample.filter((event) => {
      const isHome = String(event.homeTeam?.id || "") === String(teamId);
      const gf = isHome ? event.homeScore?.current : event.awayScore?.current;
      const ga = isHome ? event.awayScore?.current : event.homeScore?.current;
      return gf != null && ga != null && gf + ga > 2;
    }).length / sample.length).toFixed(2)),
    cleanSheetRate: Number((sample.filter((event) => {
      const isHome = String(event.homeTeam?.id || "") === String(teamId);
      const ga = isHome ? event.awayScore?.current : event.homeScore?.current;
      return ga === 0;
    }).length / sample.length).toFixed(2)),
    failToScoreRate: Number((sample.filter((event) => {
      const isHome = String(event.homeTeam?.id || "") === String(teamId);
      const gf = isHome ? event.homeScore?.current : event.awayScore?.current;
      return gf === 0;
    }).length / sample.length).toFixed(2)),
    yellowCardRate: Number((yellowCards / sample.length).toFixed(2)),
    redCardRate: Number((redCards / sample.length).toFixed(2)),
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

function extractReferee(eventDetails) {
  const referee =
    eventDetails?.referee ||
    eventDetails?.eventOfficials?.find?.((item) => String(item?.role || "").toLowerCase().includes("ref")) ||
    null;

  if (!referee) return null;

  return {
    id: referee.id ? String(referee.id) : "",
    name: referee.name || referee.fullName || "Onbekend",
    country: referee.country?.name || referee.nationality || null,
  };
}

function buildLeagueReliabilityFromReviews(reviews) {
  const leagues = {};

  for (const review of Object.values(reviews || {})) {
    const league = String(review?.league || "").trim();
    if (!league) continue;
    if (!leagues[league]) {
      leagues[league] = {
        league,
        matches: 0,
        outcomeHits: 0,
        exactHits: 0,
        totalGoalError: 0,
      };
    }
    leagues[league].matches += 1;
    leagues[league].outcomeHits += review.outcomeHit ? 1 : 0;
    leagues[league].exactHits += review.exactHit ? 1 : 0;
    leagues[league].totalGoalError += Number(review.totalGoalError || 0);
  }

  for (const value of Object.values(leagues)) {
    const matches = Math.max(Number(value.matches || 0), 1);
    const outcomeHitRate = Number((Number(value.outcomeHits || 0) / matches).toFixed(2));
    const exactHitRate = Number((Number(value.exactHits || 0) / matches).toFixed(2));
    const avgGoalError = Number((Number(value.totalGoalError || 0) / matches).toFixed(2));
    let reliability = Number((outcomeHitRate * 0.68 + exactHitRate * 0.22 + Math.max(0, 1 - avgGoalError / 4) * 0.1).toFixed(2));

    if (String(value.league || "").startsWith("Europe -")) {
      reliability = Number((reliability * 0.96).toFixed(2));
    }

    value.outcomeHitRate = outcomeHitRate;
    value.exactHitRate = exactHitRate;
    value.avgGoalError = avgGoalError;
    value.reliabilityScore = reliability;
    value.summary = `${value.league}: ${Math.round(reliability * 100)}% betrouwbaar op ${value.matches} reviews`;
  }

  return leagues;
}

function buildLeagueReliabilityEdge(input) {
  const reliability = input.leagueReliability || null;
  if (!reliability) {
    return {
      summary: "geen competitiereviewdata",
      reliabilityScore: null,
      outcomeHitRate: null,
      avgGoalError: null,
    };
  }

  return {
    summary: reliability.summary,
    reliabilityScore: Number(reliability.reliabilityScore || 0),
    outcomeHitRate: Number(reliability.outcomeHitRate || 0),
    exactHitRate: Number(reliability.exactHitRate || 0),
    avgGoalError: Number(reliability.avgGoalError || 0),
    matches: Number(reliability.matches || 0),
  };
}

function buildRefereeProfile(referee, homeRecent, awayRecent, marketCalibration) {
  if (!referee?.name) return null;
  const homeCards = Number(homeRecent?.yellowCardRate || 0) + Number(homeRecent?.redCardRate || 0) * 1.8;
  const awayCards = Number(awayRecent?.yellowCardRate || 0) + Number(awayRecent?.redCardRate || 0) * 1.8;
  const cardsTrend = Number(((homeCards + awayCards) / 2).toFixed(2));
  const penaltyBase = Number(
    (
      Number(homeRecent?.over25Rate || 0.45) * 0.12 +
      Number(awayRecent?.over25Rate || 0.45) * 0.12 +
      Math.max(0, Number(marketCalibration?.overperformanceDiff || 0)) * 0.04
    ).toFixed(2)
  );
  const strictness = cardsTrend >= 2.9 ? "streng" : cardsTrend >= 2.2 ? "gemiddeld" : "laat doorspelen";

  return {
    ...referee,
    cardsTrend,
    estimatedPenaltyRate: penaltyBase,
    strictness,
    summary: `${referee.name}: ${strictness}, kaartenritme ${cardsTrend}, penalty-kans ${Math.round(penaltyBase * 100)}%`,
  };
}

async function fetchLineupSummary(eventId) {
  const json = await safeFetch(`${SOFA}/event/${eventId}/lineups`);
  if (!json) return null;

  const convert = (lineupTeam) => {
    if (!lineupTeam) return null;
    const starters = (lineupTeam.players || []).filter((player) => player?.substitute === false);
    const bench = (lineupTeam.players || []).filter((player) => player?.substitute === true);
    const keeper =
      starters.find((player) => String(player?.player?.position || player?.position || "").toUpperCase().startsWith("G")) ||
      starters.find((player) => String(player?.position || "").toUpperCase().startsWith("G")) ||
      null;
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
      keeperName: keeper?.player?.name || keeper?.name || null,
      keeperRating: keeper ? Number(keeper.player?.rating || keeper.rating || 0) || null : null,
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

  const finishedAll = raw
    .filter((event) => event.status?.type === "finished")
    .sort((a, b) => Number(a.startTimestamp || 0) - Number(b.startTimestamp || 0));

  const finishedSameCompetition = finishedAll
    .filter((event) => {
      if (!tournamentId || !seasonId) return true;
      const eventTournamentId =
        event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id || event.tournament?.id;
      const eventSeasonId = event.season?.id;
      return eventTournamentId === tournamentId && eventSeasonId === seasonId;
    })
    .sort((a, b) => Number(a.startTimestamp || 0) - Number(b.startTimestamp || 0));

  const merged = [];
  const seenEventIds = new Set();
  for (const event of [...finishedSameCompetition, ...finishedAll]) {
    const eventKey = String(event.id || `${event.startTimestamp || ""}_${event.homeTeam?.id || ""}_${event.awayTeam?.id || ""}`);
    if (seenEventIds.has(eventKey)) continue;
    seenEventIds.add(eventKey);
    merged.push(event);
  }

  const finished = merged
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
    sameCompetitionPlayed: finishedSameCompetition.length,
    weightedRecentBalance: calculateRecentH2HBalance({ results }, currentHomeId, currentAwayId),
    results,
    status:
      results.length
        ? finishedSameCompetition.length
          ? "loaded"
          : "all-competitions"
        : "empty",
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

  const learningEdge = buildLearningEdge(input);
  const marketCalibration = buildMarketCalibration(input);
  const leagueReliability = buildLeagueReliabilityEdge(input);
  const refereeProfile = input.refereeProfile || null;

  if (learningEdge.combinedReliability) {
    const learningBiasShift = clamp((Number(learningEdge.homeBias || 0) - Number(learningEdge.awayBias || 0)) * 0.045, -0.08, 0.08);
    homeXG *= clamp(1 + learningBiasShift, 0.94, 1.08);
    awayXG *= clamp(1 - learningBiasShift, 0.94, 1.08);
  }

  if (Number(marketCalibration.overperformanceDiff || 0)) {
    const marketShift = clamp(
      Number(marketCalibration.overperformanceDiff || 0) * (marketCalibration.strength >= 0.7 ? 0.04 : 0.025),
      -0.08,
      0.08
    );
    homeXG *= clamp(1 + marketShift, 0.95, 1.06);
    awayXG *= clamp(1 - marketShift, 0.95, 1.06);
  }

  if (leagueReliability.reliabilityScore != null && leagueReliability.reliabilityScore < 0.45) {
    homeXG *= 0.98;
    awayXG *= 0.98;
  }

  if (refereeProfile?.estimatedPenaltyRate >= 0.12) {
    homeXG *= 1.02;
    awayXG *= 1.02;
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
  const featureVector = buildFeatureVector(input);
  const heuristicModel = buildHeuristicEnsemble(featureVector);
  const baseModel = { homeProb, drawProb, awayProb };
  const blended = blendProbabilities(
    baseModel,
    heuristicModel,
    0.78
  );
  const modelAgreement = calcModelAgreement(baseModel, heuristicModel);
  const lineupImpact = buildLineupImpact(input);
  const tacticalMismatch = buildTacticalMismatch(input);
  const formShift = buildFormShift(input);
  const travelEdge = buildTravelEdge(input, featureVector);
  const keeperEdge = buildKeeperEdge(input, featureVector);
  const baseConfidence = Math.min(0.93, bestProb * 3.5 + 0.24);
  const reliabilityPenalty =
    learningEdge.combinedReliability && learningEdge.combinedReliability < 0.44
      ? 0.07
      : learningEdge.combinedReliability && learningEdge.combinedReliability < 0.55
        ? 0.03
        : 0;
  const leaguePenalty =
    leagueReliability.reliabilityScore != null && leagueReliability.reliabilityScore < 0.4
      ? 0.05
      : leagueReliability.reliabilityScore != null && leagueReliability.reliabilityScore < 0.52
        ? 0.02
        : 0;
  const fragilityPenalty =
    (Number(learningEdge.homeFragility || 0) + Number(learningEdge.awayFragility || 0) >= 4 ? 0.02 : 0) +
    (!input.lineupSummary?.confirmed ? 0.015 : 0);
  const adjustedConfidence = clamp(baseConfidence - reliabilityPenalty - fragilityPenalty - leaguePenalty, 0.24, 0.93);
  const riskProfile = buildRiskProfile({
    confidence: adjustedConfidence,
    agreement: modelAgreement,
    weatherRisk: input.weather?.riskLevel || "low",
    lineupConfirmed: !!input.lineupSummary?.confirmed,
    injuriesTotal: Number(input.homeInjuries?.injuredCount || 0) + Number(input.awayInjuries?.injuredCount || 0),
    awayTravelPenalty: featureVector.away_travel_penalty,
    keeperDiff: featureVector.keeper_rating_diff,
  });
  const teamAiSummary = {
    home: buildTeamAiSummary("home", input.homeTeamProfile?.teamName || "Thuis", input.homeRecent, input.homeTeamProfile, input.homeInjuries),
    away: buildTeamAiSummary("away", input.awayTeamProfile?.teamName || "Uit", input.awayRecent, input.awayTeamProfile, input.awayInjuries),
  };

  return {
    homeProb: blended.homeProb,
    drawProb: blended.drawProb,
    awayProb: blended.awayProb,
    homeXG: Number(homeXG.toFixed(2)),
    awayXG: Number(awayXG.toFixed(2)),
    predHomeGoals,
    predAwayGoals,
    exactProb: Number(bestProb.toFixed(4)),
    confidence: Number(adjustedConfidence.toFixed(3)),
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
      lineupImpact,
      homeAwayEdge,
      tacticalMismatch,
      formShift,
      travelEdge,
      keeperEdge,
      learningEdge,
      leagueReliability,
      marketCalibration,
      refereeProfile,
      clubEloDiff: homeClubElo > 0 && awayClubElo > 0 ? Math.round(homeClubElo - awayClubElo) : null,
      stakes: input.context?.summary || null,
      matchImportance: input.matchImportance || 1,
      modelAgreement,
      riskProfile,
      teamAiSummary,
    },
    featureVector,
    ensembleMeta: {
      active: true,
      baseModel: "dixon-coles-poisson",
      blendModel: "heuristic-form-elo",
      blendWeightBase: 0.78,
      blendWeightHeuristic: 0.22,
      trainingReady: true,
      suggestedNextModel: "CatBoost or LightGBM",
      baseProbabilities: {
        homeProb: Number(baseModel.homeProb.toFixed(4)),
        drawProb: Number(baseModel.drawProb.toFixed(4)),
        awayProb: Number(baseModel.awayProb.toFixed(4)),
      },
      heuristicProbabilities: heuristicModel,
      agreement: modelAgreement,
    },
    matchImportance: input.matchImportance || 1,
  };
}

function compactStore(store, referenceDateKey, now) {
  const retainedDates = buildRetainedDateSet(referenceDateKey);
  const retainedMatchIds = new Set();

  for (const date of Object.keys(store.matches || {})) {
    if (!retainedDates.has(date)) {
      delete store.matches[date];
      delete store.predictions[date];
      delete store.knockoutOverview?.[date];
      continue;
    }

    store.matches[date] = (store.matches[date] || []).filter(Boolean);
    store.predictions[date] = (store.predictions[date] || []).map((prediction) =>
      compactPredictionEntry(prediction, date !== referenceDateKey && date !== addDaysToDateKey(referenceDateKey, 1))
    );

    for (const match of store.matches[date]) {
      if (match?.id) retainedMatchIds.add(match.id);
    }
  }

  const reviewEntries = Object.entries(store.postMatchReviews || {})
    .filter(([, review]) => retainedMatchIds.has(review?.matchId))
    .sort((a, b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0))
    .slice(0, MAX_REVIEWS);
  store.postMatchReviews = Object.fromEntries(reviewEntries);

  pruneUpdatedMap(store, "teamStats", "teamStatsUpdated", FORM_TTL, now, 600);
  pruneUpdatedMap(store, "teamInjuries", "teamInjuriesUpdated", INJURY_TTL, now, 600);
  pruneUpdatedMap(store, "teamSeasonStats", "teamSeasonStatsUpdated", SEASON_TTL, now, 600);
  pruneUpdatedMap(store, "eventCache", "eventCacheUpdated", EVENT_TTL, now, MAX_EVENT_CACHE);
  pruneUpdatedMap(store, "marketProfiles", "marketProfilesUpdated", MARKET_TTL, now, MAX_MARKET_PROFILES);
  pruneEmbeddedUpdatedMap(store, "h2hCache", H2H_TTL, now, MAX_H2H_CACHE);
  pruneEmbeddedUpdatedMap(store, "weatherCache", WEATHER_TTL, now, MAX_WEATHER_CACHE);

  if (store.clubEloUpdated && now - Number(store.clubEloUpdated || 0) > CLUB_ELO_TTL * 2) {
    store.clubEloCache = null;
    store.clubEloUpdated = null;
  }
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
    marketProfiles: {},
    marketProfilesUpdated: {},
    postMatchReviews: {},
    teamLearning: {},
    leagueReliability: {},
    lastRun: null,
    workerVersion: "v7-ref-market-league",
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
  if (!store.marketProfiles) store.marketProfiles = {};
  if (!store.marketProfilesUpdated) store.marketProfilesUpdated = {};
  if (!store.postMatchReviews) store.postMatchReviews = {};
  if (!store.teamLearning) store.teamLearning = {};
  if (!store.leagueReliability) store.leagueReliability = {};
  purgeExcludedContent(store);
  compactStore(store, today, now);
  for (const date of dates) store.knockoutOverview[date] = [];
  store.cupSheets = {};
  rebuildReviewsAndLearning(store);

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
    const events = (json?.events || [])
      .filter((event) => {
        const key = event?.startTimestamp
          ? toAmsterdamDateKey(new Date(Number(event.startTimestamp) * 1000))
          : null;
        return key === date;
      })
      .filter((event) => getLeagueInfo(event));
    allEvents[date] = events;

    for (const event of events) {
      const leagueInfo = getLeagueInfo(event);
      const homeId = String(event.homeTeam?.id || "");
      const awayId = String(event.awayTeam?.id || "");
      const homeName = event.homeTeam?.name || "Home";
      const awayName = event.awayTeam?.name || "Away";
      const tournamentId =
        event.uniqueTournament?.id || event.tournament?.uniqueTournament?.id || event.tournament?.id || null;
      const seasonId = event.season?.id || null;

      if (homeId) requiredTeamIds.add(homeId);
      if (awayId) requiredTeamIds.add(awayId);
      if (homeId && tournamentId && seasonId) {
        teamTournamentMap.set(homeId, {
          tournamentId,
          seasonId,
          teamName: homeName,
          tournamentName: event?.tournament?.name || event?.uniqueTournament?.name || "",
        });
      }
      if (awayId && tournamentId && seasonId) {
        teamTournamentMap.set(awayId, {
          tournamentId,
          seasonId,
          teamName: awayName,
          tournamentName: event?.tournament?.name || event?.uniqueTournament?.name || "",
        });
      }
      if (tournamentId && seasonId && leagueInfo) {
        tournamentsMap.set(`${tournamentId}_${seasonId}`, { tournamentId, seasonId, label: leagueInfo.label });
      }
    }
  }

  const activeLeagueLabels = [
    ...new Set(
      Object.values(allEvents)
        .flat()
        .map((event) => getLeagueInfo(event)?.label)
        .filter(Boolean)
    ),
  ].filter((label) => MARKET_LEAGUE_CODES[label]);

  for (const leagueLabel of activeLeagueLabels) {
    if (
      !store.marketProfiles[leagueLabel] ||
      now - Number(store.marketProfilesUpdated?.[leagueLabel] || 0) > MARKET_TTL
    ) {
      const marketProfile = await fetchHistoricalMarketProfile(leagueLabel, today);
      if (marketProfile) {
        store.marketProfiles[leagueLabel] = marketProfile;
        store.marketProfilesUpdated[leagueLabel] = now;
        await sleep(50);
      }
    }
  }

  for (const teamId of requiredTeamIds) {
    if (!store.teamStats[teamId] || now - Number(store.teamStatsUpdated?.[teamId] || 0) > FORM_TTL) {
      store.teamStats[teamId] = await fetchTeamForm(teamId, {
        teamName: teamTournamentMap.get(teamId)?.teamName,
        tournamentName: teamTournamentMap.get(teamId)?.tournamentName,
        segment: getCompetitionSegment(
          teamTournamentMap.get(teamId)?.teamName,
          teamTournamentMap.get(teamId)?.tournamentName
        ),
      });
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
          weightedRecentBalance: calculateRecentH2HBalance({ results: [fallbackPreviousLeg] }, homeId, awayId),
          status: "fallback",
        };
      } else if (fallbackPreviousLeg && !String(JSON.stringify(h2h?.results || [])).includes(String(fallbackPreviousLeg.score))) {
        h2h = {
          ...(h2h || {}),
          results: [...(h2h?.results || []), fallbackPreviousLeg],
          played: Number(h2h?.played || 0) + 1,
          weightedRecentBalance: calculateRecentH2HBalance(
            { results: [...(h2h?.results || []), fallbackPreviousLeg] },
            homeId,
            awayId
          ),
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
      const leagueMarketProfile = store.marketProfiles[leagueInfo.label] || null;
      const homeMarketProfile = lookupMarketTeamProfile(leagueMarketProfile, homeName);
      const awayMarketProfile = lookupMarketTeamProfile(leagueMarketProfile, awayName);
      const homeLearning = store.teamLearning[homeId ? `id:${homeId}` : `name:${normalizeName(homeName)}`] || null;
      const awayLearning = store.teamLearning[awayId ? `id:${awayId}` : `name:${normalizeName(awayName)}`] || null;
      const leagueReliability = store.leagueReliability?.[leagueInfo.label] || null;

      const minuteState = resolveMinuteState(event, eventDetails);

      const homeTeamProfile = buildTeamProfile({
        teamName: homeName,
        recent: homeRecent,
        seasonStats: store.teamSeasonStats[homeId] || null,
        injuries: store.teamInjuries[homeId] || null,
        clubElo: homeClubElo,
        standingPos: homePos,
      });
      const awayTeamProfile = buildTeamProfile({
        teamName: awayName,
        recent: awayRecent,
        seasonStats: store.teamSeasonStats[awayId] || null,
        injuries: store.teamInjuries[awayId] || null,
        clubElo: awayClubElo,
        standingPos: awayPos,
      });
      const referee = extractReferee(eventDetails);
      const marketCalibration = buildMarketCalibration({
        homeMarketProfile,
        awayMarketProfile,
        homeTeamProfile,
        awayTeamProfile,
      });
      const refereeProfile = buildRefereeProfile(referee, homeRecent, awayRecent, marketCalibration);

      const prediction = predict({
        homeTeamId: homeId,
        awayTeamId: awayId,
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
        homeTeamProfile,
        awayTeamProfile,
        homeCountry,
        awayCountry,
        leagueType: leagueInfo.type,
        context,
        matchImportance,
        homeMarketProfile,
        awayMarketProfile,
        homeLearning,
        awayLearning,
        leagueReliability,
        marketCalibration,
        refereeProfile,
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
        homeTeamProfile,
        awayTeamProfile,
        h2h,
        h2hStatus: h2h?.status || "empty",
        marketCalibration: prediction.modelEdges?.marketCalibration || null,
        learningSummary: prediction.modelEdges?.learningEdge || null,
        competitionReliability: prediction.modelEdges?.leagueReliability || null,
        refereeProfile: prediction.modelEdges?.refereeProfile || refereeProfile || null,
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
        homeTeamProfile,
        awayTeamProfile,
        h2h,
        h2hStatus: h2h?.status || "empty",
        marketCalibration: prediction.modelEdges?.marketCalibration || null,
        learningSummary: prediction.modelEdges?.learningEdge || null,
        competitionReliability: prediction.modelEdges?.leagueReliability || null,
        refereeProfile: prediction.modelEdges?.refereeProfile || refereeProfile || null,
        aggregate,
        context,
        homeClubElo,
        awayClubElo,
        matchImportance,
        featureVector: prediction.featureVector,
        ensembleMeta: prediction.ensembleMeta,
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

  compactStore(store, today, now);
  rebuildReviewsAndLearning(store);
  store.lastRun = Date.now();
  store.workerVersion = "v7-ref-market-league";
  fs.mkdirSync(path.dirname(TRAINING_SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(TRAINING_SNAPSHOT_FILE, JSON.stringify(buildTrainingSnapshot(store)));
  fs.writeFileSync(DATA_FILE, JSON.stringify(store));
  console.log("[worker] klaar");
}

main();
