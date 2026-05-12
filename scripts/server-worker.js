#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { normalizeMinute, parseMinuteValue } from "../shared/minute.js";

const SOFA = "https://api.sofascore.com/api/v1";
const sofaFetchCircuit = { blocked: false, failures: 0, logged: false };
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
const STANDINGS_TTL = 60 * 60 * 1000;
const H2H_TTL = 3 * 24 * 60 * 60 * 1000;
const WEATHER_TTL = 6 * 60 * 60 * 1000;
const EVENT_TTL = 12 * 60 * 60 * 1000;
const CLUB_ELO_TTL = 12 * 60 * 60 * 1000;
const MARKET_TTL = 24 * 60 * 60 * 1000;
const SNAPSHOT_TTL = 3 * 24 * 60 * 60 * 1000;
const OPENFOOTBALL_TTL = 14 * 24 * 60 * 60 * 1000;
const INTERNATIONAL_AVAILABILITY_TTL = 12 * 60 * 60 * 1000;
// Bewaar gespeelde dagen ruim genoeg voor analyse, terugkijken en model-review.
const HISTORY_KEEP_DAYS_BACK = 365;
const HISTORY_KEEP_DAYS_FORWARD = 14;
const MAX_REVIEWS = 2500;
const MAX_SCORE_MATRIX_ENTRIES = 10;
const MAX_EVENT_CACHE = 300;
const MAX_H2H_CACHE = 500;
const MAX_WEATHER_CACHE = 220;
const MAX_MARKET_PROFILES = 64;
const MAX_SNAPSHOT_CACHE = 48;
const MAX_OPENFOOTBALL_CACHE = 48;
const MAX_INTERNATIONAL_AVAILABILITY = 160;
const TEAM_RECENT_MATCH_WINDOW = 10;
const TEAM_FORM_BADGE_WINDOW = 5;

const MARKET_LEAGUE_CODES = {
  "England - Premier League": "E0",
  "England - Championship": "E1",
  "Scotland - Premiership": "SC0",
  "Scotland - Championship": "SC1",
  "Netherlands - Eredivisie": "N1",
  "Netherlands - Eerste Divisie": "N2",
  "Germany - Bundesliga": "D1",
  "Germany - 2. Bundesliga": "D2",
  "Spain - LaLiga": "SP1",
  "Spain - LaLiga2": "SP2",
  "Spain - LaLiga 2": "SP2",
  "Italy - Serie A": "I1",
  "Italy - Serie B": "I2",
  "France - Ligue 1": "F1",
  "France - Ligue 2": "F2",
  "Portugal - Liga Portugal": "P1",
  "Portugal - Liga Portugal 2": "P2",
  "Belgium - Pro League": "B1",
  "Belgium - Challenger Pro League": "B2",
  "Turkey - Super Lig": "T1",
  "Greece - Super League": "G1",
  "Austria - Bundesliga": "AUT",
  "Switzerland - Super League": "SWZ",
  "Denmark - Superliga": "DNK",
  "Sweden - Allsvenskan": "SWE",
  "Norway - Eliteserien": "NOR",
  "Poland - Ekstraklasa": "POL",
};

const TEAM_FORM_HISTORY_LEAGUES = Object.keys(MARKET_LEAGUE_CODES);

const SPORTSDB_LEAGUE_IDS = {
  "Belgium - Pro League": "4338",
  "England - Championship": "4329",
  "England - Premier League": "4328",
  "France - Ligue 1": "4334",
  "Germany - Bundesliga": "4331",
  "Italy - Serie A": "4332",
  "Netherlands - Eredivisie": "4337",
  "Spain - LaLiga": "4335",
};

const SPORTSDB_NAME_TO_LABEL = {
  "Belgian Pro League": "Belgium - Pro League",
  "Dutch Eredivisie": "Netherlands - Eredivisie",
  "English League Championship": "England - Championship",
  "English Premier League": "England - Premier League",
  "French Ligue 1": "France - Ligue 1",
  "German Bundesliga": "Germany - Bundesliga",
  "Italian Serie A": "Italy - Serie A",
  "Spanish La Liga": "Spain - LaLiga",
};

const ESPN_SCOREBOARD_LEAGUES = {
  "Belgium - Pro League": "bel.1",
  "England - Championship": "eng.2",
  "England - Premier League": "eng.1",
  "Europe - Champions League": "uefa.champions",
  "Europe - Conference League": "uefa.europa.conf",
  "Europe - Europa League": "uefa.europa",
  "France - Ligue 1": "fra.1",
  "Germany - 2. Bundesliga": "ger.2",
  "Germany - Bundesliga": "ger.1",
  "Italy - Serie A": "ita.1",
  "Netherlands - Eredivisie": "ned.1",
  "Portugal - Liga Portugal": "por.1",
  "Spain - LaLiga": "esp.1",
};

const DATA_SCOUT_SOURCES = [
  {
    key: "sofascore",
    name: "Sofascore",
    category: "optionele live/details",
    freeUse: "publieke voetbaldata",
    data: ["wedstrijden", "live status", "scores", "lineups", "standen"],
    priority: "optioneel",
  },
  {
    key: "espn-scoreboard",
    name: "ESPN Scoreboard",
    category: "scores/logo",
    freeUse: "publieke scoreboard endpoint",
    data: ["fixtures", "live/FT scores", "clublogo's", "competitiedekking"],
    priority: "hoog",
  },
  {
    key: "thesportsdb",
    name: "TheSportsDB",
    category: "fixtures/logo",
    freeUse: "gratis API-laag",
    data: ["fixtures", "teamlogo's", "basic events"],
    priority: "hoog",
  },
  {
    key: "football-data",
    name: "football-data.co.uk",
    category: "historie/odds",
    freeUse: "gratis CSV-bestanden",
    data: ["historische uitslagen", "closing odds", "shots", "cards", "referee"],
    priority: "hoog",
  },
  {
    key: "openligadb",
    name: "OpenLigaDB",
    category: "scores/logo",
    freeUse: "gratis openbare API",
    data: ["Duitse fixtures", "uitslagen", "teamlogo's"],
    priority: "medium",
  },
  {
    key: "openfootball",
    name: "openfootball",
    category: "historische H2H",
    freeUse: "open GitHub datasets",
    data: ["historische wedstrijden", "H2H-backfill", "competitiegeschiedenis"],
    priority: "hoog",
  },
  {
    key: "understat",
    name: "Understat",
    category: "xG-profielen",
    freeUse: "publieke pagina snapshots",
    data: ["xG", "xGA", "shotkwaliteit", "teamprofielen"],
    priority: "pilot",
  },
  {
    key: "fbref",
    name: "FBref",
    category: "shots/splits",
    freeUse: "publieke pagina snapshots, rate-limited",
    data: ["schoten", "home/away splits", "teamstatistieken"],
    priority: "pilot",
  },
  {
    key: "bbc-fixtures",
    name: "BBC fixtures",
    category: "fixture-check",
    freeUse: "publieke fixturepagina's",
    data: ["topwedstrijd controle", "noodbackfill"],
    priority: "veiligheidsnet",
  },
];

const BBC_COMPETITION_TO_LABEL = {
  "UEFA Champions League": "Europe - Champions League",
  "UEFA Europa League": "Europe - Europa League",
  "UEFA Conference League": "Europe - Conference League",
  "Premier League": "England - Premier League",
  "Championship": "England - Championship",
  "Bundesliga": "Germany - Bundesliga",
  "Spanish La Liga": "Spain - LaLiga",
  "Italian Serie A": "Italy - Serie A",
  "French Ligue 1": "France - Ligue 1",
  "Dutch Eredivisie": "Netherlands - Eredivisie",
  "Portuguese Primeira Liga": "Portugal - Liga Portugal",
  "Belgian First Division A": "Belgium - Pro League",
};


const CURATED_FIXTURE_BACKFILL = [
  {
    date: "2026-05-04",
    time: "21:00",
    league: "England - Premier League",
    tournament: "Premier League",
    country: "England",
    home: "Everton",
    away: "Manchester City",
    sourceNote: "BBC fixtures backfill",
  },
  {
    date: "2026-05-05",
    time: "18:45",
    league: "Netherlands - Eredivisie",
    tournament: "Eredivisie",
    country: "Netherlands",
    home: "RKC Waalwijk",
    away: "Willem II",
    sourceNote: "TheSportsDB result safety backfill",
  },
  {
    date: "2026-05-05",
    time: "21:00",
    league: "Europe - Champions League",
    tournament: "Champions League",
    country: "Europe",
    home: "Arsenal",
    away: "Atletico Madrid",
    round: "Semi-finals",
    aggregateLabel: "Aggregate 1-1",
    sourceNote: "BBC fixtures backfill",
  },
  {
    date: "2026-05-06",
    time: "21:00",
    league: "Europe - Champions League",
    tournament: "Champions League",
    country: "Europe",
    home: "Bayern Munich",
    away: "Paris Saint-Germain",
    round: "Semi-finals",
    aggregateLabel: "Aggregate 4-5",
    sourceNote: "UEFA result safety backfill",
  },
  {
    date: "2026-05-07",
    time: "21:00",
    league: "Europe - Europa League",
    tournament: "Europa League",
    country: "Europe",
    home: "Freiburg",
    away: "Sporting Braga",
    round: "Semi-finals",
    sourceNote: "UEFA fixtures backfill",
  },
  {
    date: "2026-05-07",
    time: "21:00",
    league: "Europe - Europa League",
    tournament: "Europa League",
    country: "Europe",
    home: "Aston Villa",
    away: "Nottingham Forest",
    round: "Semi-finals",
    sourceNote: "UEFA fixtures backfill",
  },
  {
    date: "2026-05-07",
    time: "21:00",
    league: "Europe - Conference League",
    tournament: "Conference League",
    country: "Europe",
    home: "Crystal Palace",
    away: "Shakhtar Donetsk",
    round: "Semi-finals",
    sourceNote: "UEFA fixtures backfill",
  },
  {
    date: "2026-05-07",
    time: "21:00",
    league: "Europe - Conference League",
    tournament: "Conference League",
    country: "Europe",
    home: "Strasbourg",
    away: "Rayo Vallecano",
    round: "Semi-finals",
    sourceNote: "UEFA fixtures backfill",
  },
];

const CURATED_RESULT_BACKFILL = [
  {
    date: "2026-05-05",
    home: "RKC Waalwijk",
    away: "Willem II",
    score: "0-1",
    status: "FT",
    sourceNote: "TheSportsDB verified result backfill",
  },
  {
    date: "2026-05-05",
    home: "Arsenal",
    away: "Atletico Madrid",
    score: "1-0",
    status: "FT",
    sourceNote: "manual verified result backfill",
  },
  {
    date: "2026-05-06",
    home: "Bayern Munich",
    away: "Paris Saint-Germain",
    score: "1-1",
    status: "FT",
    sourceNote: "manual verified result backfill",
  },
  {
    date: "2026-05-07",
    home: "Freiburg",
    away: "Sporting Braga",
    score: "3-1",
    status: "FT",
    sourceNote: "UEFA verified semi-final result backfill",
  },
  {
    date: "2026-05-07",
    home: "Aston Villa",
    away: "Nottingham Forest",
    score: "4-0",
    status: "FT",
    sourceNote: "UEFA verified semi-final result backfill",
  },
  {
    date: "2026-05-07",
    home: "Crystal Palace",
    away: "Shakhtar Donetsk",
    score: "2-1",
    status: "FT",
    sourceNote: "UEFA verified semi-final result backfill",
  },
  {
    date: "2026-05-07",
    home: "Strasbourg",
    away: "Rayo Vallecano",
    score: "0-1",
    status: "FT",
    sourceNote: "UEFA verified semi-final result backfill",
  },
];

const CURATED_H2H_BACKFILL = {
  "arsenal__atletico madrid": [
    {
      date: "2018-05-03",
      home: "Atletico Madrid",
      away: "Arsenal",
      score: "1-0",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2025-10-21",
      home: "Arsenal",
      away: "Atletico Madrid",
      score: "4-0",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2026-04-28",
      home: "Arsenal",
      away: "Atletico Madrid",
      score: "1-1",
      source: "aiscore-h2h-backfill",
    },
  ],
  "rkc waalwijk__willem ii": [
    {
      date: "2026-02-08",
      home: "Willem II",
      away: "RKC Waalwijk",
      score: "2-1",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2025-10-18",
      home: "RKC Waalwijk",
      away: "Willem II",
      score: "2-3",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2024-09-15",
      home: "Willem II",
      away: "RKC Waalwijk",
      score: "3-0",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2025-01-26",
      home: "RKC Waalwijk",
      away: "Willem II",
      score: "2-0",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2022-02-06",
      home: "Willem II",
      away: "RKC Waalwijk",
      score: "3-1",
      source: "aiscore-h2h-backfill",
    },
  ],
  "aston villa__nottingham forest": [
    {
      date: "2026-04-12",
      home: "Nottingham Forest",
      away: "Aston Villa",
      score: "1-1",
      source: "sportsmole-h2h-backfill",
    },
    {
      date: "2026-01-03",
      home: "Aston Villa",
      away: "Nottingham Forest",
      score: "3-1",
      source: "sportsmole-h2h-backfill",
    },
    {
      date: "2025-04-05",
      home: "Aston Villa",
      away: "Nottingham Forest",
      score: "2-1",
      source: "avfc-history-h2h-backfill",
    },
    {
      date: "2024-12-14",
      home: "Nottingham Forest",
      away: "Aston Villa",
      score: "2-1",
      source: "sportsmole-h2h-backfill",
    },
    {
      date: "2024-02-24",
      home: "Aston Villa",
      away: "Nottingham Forest",
      score: "4-2",
      source: "avfc-history-h2h-backfill",
    },
  ],
  "bayern munich__paris saint germain": [
    {
      date: "2024-11-26",
      home: "Bayern Munich",
      away: "Paris Saint-Germain",
      score: "1-0",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2025-11-05",
      home: "Paris Saint-Germain",
      away: "Bayern Munich",
      score: "1-2",
      source: "aiscore-h2h-backfill",
    },
    {
      date: "2025-07-06",
      home: "Paris Saint-Germain",
      away: "Bayern Munich",
      score: "2-0",
      source: "aiscore-h2h-backfill",
    },
  ],
};
const OPENLIGADB_LEAGUES = {
  bl1: "Germany - Bundesliga",
  bl2: "Germany - 2. Bundesliga",
};

const OPENFOOTBALL_COMPETITIONS = {
  "England - Premier League": "eng.1",
  "England - Championship": "eng.2",
  "Germany - Bundesliga": "de.1",
  "Germany - 2. Bundesliga": "de.2",
  "Spain - LaLiga": "es.1",
  "Spain - LaLiga2": "es.2",
  "Spain - LaLiga 2": "es.2",
  "Italy - Serie A": "it.1",
  "Italy - Serie B": "it.2",
  "France - Ligue 1": "fr.1",
  "France - Ligue 2": "fr.2",
  "Netherlands - Eredivisie": "nl.1",
};

const UNDERSTAT_LEAGUE_CODES = {
  "England - Premier League": "EPL",
  "Spain - LaLiga": "La_liga",
  "Germany - Bundesliga": "Bundesliga",
  "Italy - Serie A": "Serie_A",
  "France - Ligue 1": "Ligue_1",
};

const FBREF_RELEASE_CODES = {
  "England - Premier League": { country: "ENG", tier: "1st", advanced: true },
  "England - Championship": { country: "ENG", tier: "2nd", advanced: false },
  "Spain - LaLiga": { country: "ESP", tier: "1st", advanced: true },
  "France - Ligue 1": { country: "FRA", tier: "1st", advanced: true },
  "Germany - Bundesliga": { country: "GER", tier: "1st", advanced: true },
  "Italy - Serie A": { country: "ITA", tier: "1st", advanced: true },
  "Portugal - Liga Portugal": { country: "POR", tier: "1st", advanced: false },
  "Netherlands - Eredivisie": { country: "NED", tier: "1st", advanced: false },
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

  const minute = normalizeMinute(null, current, extra, period) || null;

  return {
    minute,
    minuteValue: current,
    extraTime: extra,
    period,
  };
}

function resolveAppStatus(eventLike) {
  const type = String(eventLike?.status?.type || "").toLowerCase();
  const description = String(eventLike?.status?.description || eventLike?.status?.status || "").toLowerCase();
  const period = String(eventLike?.period || "").toLowerCase();

  if (type === "finished" || description.includes("finished") || description === "ft" || description.includes("full time")) {
    return "FT";
  }

  if (type === "halftime" || period === "ht" || description === "ht" || description.includes("half")) {
    return "HT";
  }

  if (
    type === "inprogress" ||
    description.includes("live") ||
    description.includes("progress") ||
    description.includes("1st") ||
    description.includes("2nd")
  ) {
    return "LIVE";
  }

  return "NS";
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const TEAM_ALIAS_GROUPS = [
  ["fc cologne", "1 fc koln", "1 fc koeln", "fc koln", "fc koeln", "koln", "koeln", "cologne"],
  ["1 fc heidenheim 1846", "1 fc heidenheim", "fc heidenheim", "heidenheim"],
  ["hamburg sv", "hamburger sv", "hsv"],
  ["hertha bsc", "hertha berlin"],
  ["spvgg greuther furth", "spvgg greuther fuerth", "greuther furth", "greuther fuerth"],
  ["borussia monchengladbach", "borussia moenchengladbach", "monchengladbach", "moenchengladbach", "gladbach"],
  ["bayern munich", "fc bayern munchen", "bayern munchen", "bayern"],
  ["bayer leverkusen", "bayer 04 leverkusen", "leverkusen"],
  ["borussia dortmund", "dortmund"],
  ["rb leipzig", "rasenballsport leipzig", "leipzig"],
  ["fc st pauli", "st pauli"],
  ["werder bremen", "sv werder bremen"],
  ["ajax", "ajax amsterdam", "afc ajax"],
  ["az alkmaar", "az"],
  ["fc twente", "twente"],
  ["fc utrecht", "utrecht"],
  ["fc volendam", "volendam"],
  ["nec nijmegen", "nijmegen", "nec"],
  ["fortuna sittard", "for sittard"],
  ["pec zwolle", "zwolle"],
  ["fc groningen", "groningen"],
  ["heracles almelo", "heracles"],
  ["go ahead eagles", "ga eagles"],
  ["psv eindhoven", "psv"],
  ["feyenoord rotterdam", "feyenoord"],
  ["karlsruher sc", "karlsruhe", "karlsruher"],
  ["dsc arminia bielefeld", "arminia bielefeld", "bielefeld"],
  ["1 fc kaiserslautern", "kaiserslautern"],
  ["sc paderborn 07", "paderborn"],
  ["paris saint germain", "psg", "paris sg", "paris saint-germain"],
  ["internazionale", "inter milan", "inter"],
  ["ac milan", "milan"],
  ["as roma", "roma"],
  ["ss lazio", "lazio"],
  ["fiorentina", "acf fiorentina"],
  ["atletico madrid", "ath madrid", "atletico"],
  ["athletic club", "athletic bilbao", "ath bilbao", "athletic club bilbao"],
  ["espanyol", "espanol", "rcd espanyol", "espanyol barcelona"],
  ["barcelona", "fc barcelona", "barca"],
  ["crystal palace", "crystal palace fc"],
  ["real sociedad", "sociedad"],
  ["real betis", "betis"],
  ["rayo vallecano", "vallecano"],
  ["celta vigo", "rc celta", "celtavigo", "celta"],
  ["girona", "girona fc"],
  ["leeds united", "leeds"],
  ["manchester city", "man city"],
  ["manchester united", "man united"],
  ["nottingham forest", "nott m forest", "nottm forest"],
  ["wolverhampton wanderers", "wolverhampton", "wolves"],
  ["brighton hove albion", "brighton and hove albion", "brighton"],
  ["tottenham hotspur", "tottenham", "spurs"],
  ["newcastle united", "newcastle"],
  ["west ham united", "west ham"],
  ["aston villa", "villa"],
  ["sporting braga", "sp braga", "braga"],
  ["sporting cp", "sporting lisbon"],
  ["union st gilloise", "union saint gilloise", "royale union saint gilloise"],
  ["standard liege", "standard"],
  ["sint truidense", "sint truiden"],
  ["oh leuven", "oud heverlee leuven", "oud heverlee"],
  ["kv mechelen", "mechelen"],
  ["kaa gent", "gent"],
  ["sl benfica", "benfica"],
  ["fc porto", "porto"],
  ["ogc nice", "nice"],
  ["aj auxerre", "auxerre"],
  ["angers sco", "angers"],
];

const teamAliasLookup = new Map();
for (const group of TEAM_ALIAS_GROUPS) {
  const normalizedGroup = [...new Set(group.map(normalizeName).filter(Boolean))];
  const canonical = normalizedGroup[0];
  for (const alias of normalizedGroup) {
    teamAliasLookup.set(alias, canonical);
  }
}

const UNSAFE_LOGO_KEYS = new Set([
  "city",
  "united",
  "real",
  "sporting",
  "athletic",
  "inter",
  "milan",
  "racing",
  "standard",
  "union",
  "wanderers",
  "rovers",
  "forest",
  "villa",
]);

function canonicalTeamName(name) {
  const normalized = normalizeName(name);
  if (!normalized) return "";
  return teamAliasLookup.get(normalized) || normalized.replace(/\s+and\s+/g, " ");
}

function buildLogoLookupNames(name) {
  const normalized = normalizeName(name);
  if (!normalized) return [];
  const canonical = canonicalTeamName(normalized);
  const groupAliases = TEAM_ALIAS_GROUPS.find((group) =>
    group.map(normalizeName).includes(canonical)
  ) || [];
  return [...new Set([normalized, canonical, ...groupAliases.map(normalizeName)])]
    .filter(Boolean)
    .filter(isSafeLogoLookupName);
}

function isSafeLogoLookupName(key) {
  const normalized = normalizeName(key);
  if (!normalized || UNSAFE_LOGO_KEYS.has(normalized)) return false;
  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length === 1 && normalized.length < 5) return false;
  if (parts.length === 1 && /^(fc|cf|sc|cd|ac|afc|sv|bk|ifk|rkc|psg|psv)$/i.test(normalized)) return false;
  return true;
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
  const canonical = canonicalTeamName(normalized);
  if (canonical && canonical !== normalized) variants.add(canonical);
  for (const group of TEAM_ALIAS_GROUPS) {
    const normalizedGroup = group.map(normalizeName);
    if (normalizedGroup.includes(normalized) || normalizedGroup.includes(canonical)) {
      normalizedGroup.forEach((alias) => variants.add(alias));
      break;
    }
  }
  const withoutLeadingClubPrefix = normalized
    .replace(/^(?:1\s+)?(?:fc|sc|dsc|ac|afc|cf|sv|tsv|kaa|kv|kvc)\s+/, "")
    .trim();
  if (withoutLeadingClubPrefix && withoutLeadingClubPrefix !== normalized) variants.add(withoutLeadingClubPrefix);
  const withoutTrailingClubSuffix = normalized.replace(/\s+(?:fc|sc|afc|cf|ac|ksv|rfc)$/g, "").trim();
  if (withoutTrailingClubSuffix && withoutTrailingClubSuffix !== normalized) variants.add(withoutTrailingClubSuffix);
  const withoutTrailingNumber = withoutLeadingClubPrefix.replace(/\s+\d+$/g, "").trim();
  if (withoutTrailingNumber && withoutTrailingNumber !== normalized) variants.add(withoutTrailingNumber);
  const withoutCitySuffix = normalized.replace(/\s+city$/g, "").trim();
  if (withoutCitySuffix && withoutCitySuffix !== normalized) variants.add(withoutCitySuffix);
  if (normalized.includes("fc ")) variants.add(normalized.replace("fc ", "").trim());
  if (normalized.includes(" cf")) variants.add(normalized.replace(" cf", "").trim());
  if (normalized.includes(" afc")) variants.add(normalized.replace(" afc", "").trim());
  if (normalized.includes(" sc")) variants.add(normalized.replace(" sc", "").trim());
  if (normalized.includes(" ac")) variants.add(normalized.replace(" ac", "").trim());
  if (normalized.includes(" ksv")) variants.add(normalized.replace(" ksv", "").trim());
  if (normalized.includes(" rfc")) variants.add(normalized.replace(" rfc", "").trim());
  if (normalized.includes(" and ")) variants.add(normalized.replace(/\s+and\s+/g, " ").trim());
  if (normalized.includes("manchester ")) variants.add(normalized.replace("manchester ", "man ").trim());
  if (normalized.includes("man ")) variants.add(normalized.replace("man ", "manchester ").trim());
  if (normalized === "nottingham forest") variants.add("nott m forest");
  if (normalized === "nott m forest") variants.add("nottingham forest");
  if (normalized === "real sociedad") variants.add("sociedad");
  if (normalized === "sociedad") variants.add("real sociedad");
  if (normalized === "atletico madrid") variants.add("ath madrid");
  if (normalized === "ath madrid") variants.add("atletico madrid");
  if (normalized === "wolverhampton") variants.add("wolves");
  if (normalized === "wolves") variants.add("wolverhampton");
  if (normalized === "tottenham hotspur") variants.add("tottenham");
  if (normalized === "tottenham") variants.add("tottenham hotspur");
  if (normalized === "hull city") variants.add("hull");
  if (normalized === "hull") variants.add("hull city");
  if (normalized === "sc paderborn 07") variants.add("paderborn");
  if (normalized === "paderborn") variants.add("sc paderborn 07");
  if (normalized === "karlsruher sc") {
    variants.add("karlsruher");
    variants.add("karlsruhe");
  }
  if (normalized === "karlsruhe") variants.add("karlsruher sc");
  if (normalized === "1 fc kaiserslautern") variants.add("kaiserslautern");
  if (normalized === "kaiserslautern") variants.add("1 fc kaiserslautern");
  if (normalized === "dsc arminia bielefeld") {
    variants.add("arminia bielefeld");
    variants.add("bielefeld");
  }
  if (normalized === "arminia bielefeld" || normalized === "bielefeld") variants.add("dsc arminia bielefeld");
  if (normalized === "oh leuven") {
    variants.add("oud heverlee leuven");
    variants.add("oud heverlee");
  }
  if (normalized === "oud heverlee leuven") variants.add("oh leuven");
  if (normalized === "standard liege") variants.add("standard");
  if (normalized === "standard") variants.add("standard liege");
  if (normalized === "sporting braga") variants.add("sp braga");
  if (normalized === "sp braga") variants.add("sporting braga");
  if (normalized === "rayo vallecano") variants.add("vallecano");
  if (normalized === "vallecano") variants.add("rayo vallecano");
  if (normalized === "bayer 04 leverkusen") variants.add("bayer leverkusen");
  if (normalized === "bayer leverkusen") variants.add("bayer 04 leverkusen");
  if (normalized === "fc st pauli") variants.add("st pauli");
  if (normalized === "st pauli") variants.add("fc st pauli");
  if (normalized === "sv werder bremen") variants.add("werder bremen");
  if (normalized === "werder bremen") variants.add("sv werder bremen");
  if (normalized === "tsv eintracht braunschweig") variants.add("eintracht braunschweig");
  if (normalized === "eintracht braunschweig") variants.add("tsv eintracht braunschweig");
  if (normalized === "fc bayern munchen" || normalized === "bayern munchen") variants.add("bayern munich");
  if (normalized === "bayern munich") {
    variants.add("fc bayern munchen");
    variants.add("bayern munchen");
  }
  if (normalized === "sint truidense") variants.add("sint truiden");
  if (normalized === "sint truiden") variants.add("sint truidense");
  if (normalized === "1 fsv mainz 05") variants.add("mainz");
  if (normalized === "mainz") variants.add("1 fsv mainz 05");
  if (normalized === "cercle brugge ksv") variants.add("cercle brugge");
  if (normalized === "cercle brugge") variants.add("cercle brugge ksv");
  if (normalized === "ajax amsterdam") variants.add("ajax");
  if (normalized === "ajax") variants.add("ajax amsterdam");
  if (normalized === "fc utrecht") variants.add("utrecht");
  if (normalized === "utrecht") variants.add("fc utrecht");
  if (normalized === "fc volendam") variants.add("volendam");
  if (normalized === "volendam") variants.add("fc volendam");
  if (normalized === "union st gilloise") variants.add("union saint gilloise");
  if (normalized === "union saint gilloise") variants.add("union st gilloise");
  if (normalized === "kv mechelen") variants.add("mechelen");
  if (normalized === "mechelen") variants.add("kv mechelen");
  if (normalized === "angers sco") variants.add("angers");
  if (normalized === "angers") variants.add("angers sco");
  if (normalized === "aj auxerre") variants.add("auxerre");
  if (normalized === "auxerre") variants.add("aj auxerre");
  if (normalized === "ogc nice") variants.add("nice");
  if (normalized === "nice") variants.add("ogc nice");
  if (normalized === "fc porto") variants.add("porto");
  if (normalized === "porto") variants.add("fc porto");
  if (normalized === "sl benfica") variants.add("benfica");
  if (normalized === "benfica") variants.add("sl benfica");
  if (normalized === "braga") variants.add("sporting braga");
  if (normalized === "sporting braga") variants.add("braga");
  if (normalized === "famalicao") variants.add("famalicao");
  if (normalized === "kaa gent") variants.add("gent");
  if (normalized === "gent") variants.add("kaa gent");
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

function calcTeamPressure(pos, totalTeams) {
  if (!pos || !totalTeams) return 1;
  const relegationStart = Math.max(totalTeams - 2, 1);

  if (pos === 1) return 1.12;
  if (pos <= 2) return 1.1;
  if (pos === 3) return 1.08;
  if (pos <= 6) return 1.04;
  if (pos >= relegationStart) return 1.08;
  if (pos >= Math.max(totalTeams - 5, 1)) return 1.03;
  return 1;
}

function calcMatchImportance(homePos, awayPos, totalTeams) {
  if (!homePos || !awayPos || !totalTeams) return 1;
  const homePressure = calcTeamPressure(homePos, totalTeams);
  const awayPressure = calcTeamPressure(awayPos, totalTeams);
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
          avgShotsOnAgainst: seasonStats.avgShotsOnAgainst ?? null,
          avgShots: seasonStats.avgShots ?? null,
          avgShotsAgainst: seasonStats.avgShotsAgainst ?? null,
          avgPossession: seasonStats.avgPossession ?? null,
          avgCorners: seasonStats.avgCorners ?? null,
          avgCornersAgainst: seasonStats.avgCornersAgainst ?? null,
          cleanSheets: seasonStats.cleanSheets ?? null,
          cleanSheetRate: seasonStats.cleanSheetRate ?? null,
          failToScoreRate: seasonStats.failToScoreRate ?? null,
          bttsRate: seasonStats.bttsRate ?? null,
          over25Rate: seasonStats.over25Rate ?? null,
          dominanceScore: seasonStats.dominanceScore ?? null,
          historicalGames: seasonStats.historicalGames ?? null,
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
  const homeCompareKey = String(input.homeTeamId || normalizeName(input.homeTeamName || ""));
  const awayCompareKey = String(input.awayTeamId || normalizeName(input.awayTeamName || ""));
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
  const phaseReliability = input.phaseReliability || {};
  const refereeProfile = input.refereeProfile || {};
  const h2hSampleSize = Math.max(Number(input.h2h?.played || 0), Array.isArray(input.h2h?.results) ? input.h2h.results.length : 0);
  const h2hReliability = h2hSampleSize >= 5 ? 1 : h2hSampleSize >= 3 ? 0.65 : h2hSampleSize >= 2 ? 0.35 : 0;
  const isInternational =
    isSeniorInternationalTournament(input.league) ||
    String(input.phaseBucket || "").toLowerCase() === "interland" ||
    String(input.leagueType || "").toLowerCase() === "international";
  const clubEloScale = isInternational ? 0.35 : 1;

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
    club_elo_diff: Number(((Number(input.homeClubElo || 0) - Number(input.awayClubElo || 0)) * clubEloScale).toFixed(0)),
    raw_club_elo_diff: Number((Number(input.homeClubElo || 0) - Number(input.awayClubElo || 0)).toFixed(0)),
    club_elo_scale: clubEloScale,
    home_injuries: Number(input.homeInjuries?.injuredCount || 0),
    away_injuries: Number(input.awayInjuries?.injuredCount || 0),
    weather_risk:
      input.weather?.riskLevel === "high" ? 2 : input.weather?.riskLevel === "medium" ? 1 : 0,
    lineups_confirmed: input.lineupSummary?.confirmed ? 1 : 0,
    h2h_sample_size: h2hSampleSize,
    h2h_reliability: h2hReliability,
    h2h_balance:
      input.h2h?.played >= 1
        ? Number(
            (
              (Number(input.h2h.homeWins || 0) - Number(input.h2h.awayWins || 0)) /
              Math.max(Number(input.h2h.played || 1), 1)
            ).toFixed(2)
          )
        : 0,
    h2h_recent_5_balance: calculateRecentH2HBalance(input.h2h, homeCompareKey, awayCompareKey),
    recent_h2h_balance:
      input.h2h?.results?.length >= 1
        ? Number(
            (() => {
              const recent5 = (input.h2h.results || []).slice(-5);
              let homeWins = 0;
              let awayWins = 0;
              recent5.forEach(r => {
                if (String(r.winnerId || "") === homeCompareKey) homeWins++;
                else if (String(r.winnerId || "") === awayCompareKey) awayWins++;
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
    home_avg_shots: Number(input.homeSeasonStats?.avgShots || 0),
    away_avg_shots: Number(input.awaySeasonStats?.avgShots || 0),
    home_avg_shots_against: Number(input.homeSeasonStats?.avgShotsAgainst || 0),
    away_avg_shots_against: Number(input.awaySeasonStats?.avgShotsAgainst || 0),
    home_avg_shots_on_against: Number(input.homeSeasonStats?.avgShotsOnAgainst || 0),
    away_avg_shots_on_against: Number(input.awaySeasonStats?.avgShotsOnAgainst || 0),
    dominance_diff: Number(
      (
        Number(input.homeSeasonStats?.dominanceScore || 0) -
        Number(input.awaySeasonStats?.dominanceScore || 0)
      ).toFixed(2)
    ),
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
    phase_reliability: Number(phaseReliability.reliabilityScore || 0.5),
    phase_avg_goal_error: Number(phaseReliability.avgGoalError || 2),
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
  homeScore += featureVector.dominance_diff * 0.08;
  awayScore -= featureVector.dominance_diff * 0.08;
  homeScore += (featureVector.home_avg_shots - featureVector.away_avg_shots_against) * 0.01;
  awayScore += (featureVector.away_avg_shots - featureVector.home_avg_shots_against) * 0.01;
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
  const h2hWeight = Number(featureVector.h2h_reliability || 0);
  homeScore += featureVector.h2h_balance * 0.05 * h2hWeight;
  awayScore -= featureVector.h2h_balance * 0.05 * h2hWeight;
  // Recente onderlinge vorm weegt alleen stevig als er minimaal 3 betrouwbare duels zijn.
  homeScore += featureVector.h2h_recent_5_balance * 0.12 * h2hWeight;
  awayScore -= featureVector.h2h_recent_5_balance * 0.12 * h2hWeight;
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
  homeScore += (featureVector.phase_reliability - 0.5) * 0.08;
  awayScore += (featureVector.phase_reliability - 0.5) * 0.08;
  homeScore -= Math.max(0, featureVector.phase_avg_goal_error - 1.5) * 0.03;
  awayScore -= Math.max(0, featureVector.phase_avg_goal_error - 1.5) * 0.03;

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
  const homeReviewedMatches = Number(home?.reviewedMatches || 0);
  const awayReviewedMatches = Number(away?.reviewedMatches || 0);
  const totalReviewedMatches = homeReviewedMatches + awayReviewedMatches;
  const denominator = (home ? 1 : 0) + (away ? 1 : 0) || 1;
  const phaseBucket = getReliabilityBucket(input);
  const phaseMultiplier =
    phaseBucket === "friendly"
      ? 0.55
      : phaseBucket === "interland" || phaseBucket === "qualification"
        ? 0.68
        : phaseBucket === "cup" || phaseBucket === "two-leg-knockout"
          ? 0.78
          : 1;
  const sampleConfidence = clamp(totalReviewedMatches / 30, 0, 1);
  const teamBalance = Math.min(homeReviewedMatches, awayReviewedMatches) / Math.max(Math.max(homeReviewedMatches, awayReviewedMatches), 1);
  const safeToApply = totalReviewedMatches >= 8 && teamBalance >= 0.25;
  const summary = home || away
    ? `${input.homeTeamProfile?.teamName || "Thuis"} ${homeBias >= 0 ? "licht onderschat" : "licht overschat"} (${Math.round(homeReliability * 100)}%) / ${input.awayTeamProfile?.teamName || "Uit"} ${awayBias >= 0 ? "licht onderschat" : "licht overschat"} (${Math.round(awayReliability * 100)}%)`
    : "nog geen reviewdata";

  return {
    summary,
    homeReviewedMatches,
    awayReviewedMatches,
    totalReviewedMatches,
    homeOutcomeHitRate: homeReliability,
    awayOutcomeHitRate: awayReliability,
    homeExactHitRate: Number(home?.exactHitRate || 0),
    awayExactHitRate: Number(away?.exactHitRate || 0),
    homeBias,
    awayBias,
    homeAvgGoalError: Number(home?.avgGoalError || 0),
    awayAvgGoalError: Number(away?.avgGoalError || 0),
    combinedReliability: Number(((homeReliability + awayReliability) / denominator).toFixed(2)),
    phaseBucket,
    phaseMultiplier: Number(phaseMultiplier.toFixed(2)),
    sampleConfidence: Number(sampleConfidence.toFixed(2)),
    teamBalance: Number(teamBalance.toFixed(2)),
    safeToApply,
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
  const leagueMeta = input.leagueMarketProfile?.leagueMeta || null;
  const supplemental = input.supplementalOdds || null;
  if (!home && !away) {
    const supplementalSignals = Array.isArray(supplemental?.bookmakerSignals) ? supplemental.bookmakerSignals : [];
    const homePpg = Number(input.homeTeamProfile?.pointsPerGame || input.homeRecent?.pointsPerGame || 0);
    const awayPpg = Number(input.awayTeamProfile?.pointsPerGame || input.awayRecent?.pointsPerGame || 0);
    const isInternational =
      isSeniorInternationalTournament(input.league) ||
      String(input.phaseBucket || "").toLowerCase() === "interland" ||
      String(input.leagueType || "").toLowerCase() === "international";
    const clubEloScale = isInternational ? 0.35 : 1;
    const eloDiff =
      Number(input.homeClubElo || 0) > 0 && Number(input.awayClubElo || 0) > 0
        ? ((Number(input.homeClubElo || 0) - Number(input.awayClubElo || 0)) * clubEloScale) / 125
        : 0;
    const derivedDiff = Number((homePpg - awayPpg + eloDiff * 0.45).toFixed(2));
    const derivedStrength = clamp(
      0.1 +
        Math.abs(derivedDiff) / 2.8 +
        Math.max(Number(input.homeSeasonStats?.sourceQuality || 0), Number(input.awaySeasonStats?.sourceQuality || 0)) * 0.25,
      0.1,
      0.42
    );
    const derivedLean = derivedDiff >= 0.3 ? "home" : derivedDiff <= -0.3 ? "away" : "neutral";
    const bookmakerSignals = [...supplementalSignals];
    if (!bookmakerSignals.length) {
      bookmakerSignals.push({
        key: "FreeProxy",
        bookmaker: "Gratis model-proxy",
        diff: derivedDiff,
        strength: Number(derivedStrength.toFixed(2)),
        closingCoverage: 0.18,
        lean: derivedLean,
        source: "derived-free-market-proxy",
      });
    }
    return {
      summary: bookmakerSignals.length
        ? supplementalSignals.length
          ? `geen historische marktdata, live oddsdekking ${supplementalSignals.length} bookmakers`
          : "geen historische marktdata; gratis model-proxy gebruikt als marktcalibratie"
        : "geen historische marktdata gekoppeld",
      source: supplementalSignals.length ? "Sofascore current odds" : "gratis model-proxy",
      homeImpliedPpg: null,
      awayImpliedPpg: null,
      overperformanceDiff: derivedDiff,
      strength: supplementalSignals.length ? 0.26 : Number(derivedStrength.toFixed(2)),
      closingLean: supplemental?.bookmakerSignals?.[0]?.lean || derivedLean,
      closingCoverage: Number(Math.max(Number(supplemental?.closingCoverage || 0), bookmakerSignals.length ? 0.18 : 0).toFixed(2)),
      bookmakerSignals,
      bookmakerAgreement: Number(supplemental?.bookmakerAgreement || (bookmakerSignals.length ? 0.46 : 0)),
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
  const sampleStrength = Math.min(sampleGames / 26, 1);
  const closingCoverage = Number(leagueMeta?.closingCoverage || 0);
  const historicalSignals = BOOKMAKER_DEFS.map((bookmaker) => {
    const homeBook = home?.bookmakers?.[bookmaker.key] || null;
    const awayBook = away?.bookmakers?.[bookmaker.key] || null;
    if (!homeBook && !awayBook) return null;

    const bookDiff = Number(
      (
        Number(homeBook?.homeOverperformance || 0) -
        Number(awayBook?.awayOverperformance || 0)
      ).toFixed(2)
    );
    const bookGames = Number(homeBook?.homeGames || 0) + Number(awayBook?.awayGames || 0);
    const bookCoverage = Number(
      (
        (Number(homeBook?.closingCoverage || closingCoverage) +
          Number(awayBook?.closingCoverage || closingCoverage)) /
        2
      ).toFixed(2)
    );
    const bookStrength = Number((Math.min(bookGames / 18, 1) * 0.58 + Math.min(bookCoverage, 1) * 0.42).toFixed(2));
    const bookLean = bookDiff >= 0.3 ? "home" : bookDiff <= -0.3 ? "away" : "neutral";
    return {
      key: bookmaker.key,
        bookmaker: bookmaker.label,
        diff: bookDiff,
        strength: bookStrength,
        closingCoverage: bookCoverage,
        lean: bookLean,
        source: "football-data.co.uk",
      };
  }).filter(Boolean);

  const supplementalSignals = Array.isArray(supplemental?.bookmakerSignals) ? supplemental.bookmakerSignals : [];
  const bookmakerSignals = [...historicalSignals];
  for (const signal of supplementalSignals) {
    if (bookmakerSignals.some((item) => item.key === signal.key)) continue;
    bookmakerSignals.push(signal);
  }

  const weightedBookDiff = bookmakerSignals.length
    ? bookmakerSignals.reduce((sum, item) => sum + Number(item.diff || 0) * Math.max(Number(item.strength || 0), 0.1), 0) /
      bookmakerSignals.reduce((sum, item) => sum + Math.max(Number(item.strength || 0), 0.1), 0)
    : diff;
  let bookmakerAgreement =
    bookmakerSignals.length > 0
      ? Number(
          (
            bookmakerSignals.filter((item) => item.lean === "home" || item.lean === "away").length /
            bookmakerSignals.length
          ).toFixed(2)
        )
      : 0;
  const bookmakerCoverage = bookmakerSignals.length
    ? bookmakerSignals.reduce((sum, item) => sum + Number(item.closingCoverage || 0), 0) / bookmakerSignals.length
    : 0;
  const strength = Number(
    (
      sampleStrength * 0.42 +
      Math.min(Math.max(closingCoverage, Number(supplemental?.closingCoverage || 0), bookmakerCoverage), 1) * 0.23 +
      (bookmakerSignals.length ? bookmakerSignals.reduce((sum, item) => sum + Number(item.strength || 0), 0) / bookmakerSignals.length : 0) * 0.35
    ).toFixed(2)
  );
  const closingLean = weightedBookDiff >= 0.35 ? "home" : weightedBookDiff <= -0.35 ? "away" : "neutral";
  const effectiveCoverage = Number(Math.max(closingCoverage, Number(supplemental?.closingCoverage || 0), bookmakerCoverage).toFixed(2));

  if (!bookmakerSignals.length && Number.isFinite(weightedBookDiff)) {
    bookmakerSignals.push({
      key: "Hist",
      bookmaker: "Historical closing",
      diff: Number(weightedBookDiff.toFixed(2)),
      strength: Number(Math.max(strength, 0.12).toFixed(2)),
      closingCoverage: effectiveCoverage,
      lean: closingLean,
      source: "historical-closing-fallback",
    });
  }
  if (!bookmakerSignals.length) {
    const sourceQuality = Math.max(Number(input.homeSeasonStats?.sourceQuality || 0), Number(input.awaySeasonStats?.sourceQuality || 0));
    const sourceDiff = Number((Number(input.homeTeamProfile?.pointsPerGame || 0) - Number(input.awayTeamProfile?.pointsPerGame || 0)).toFixed(2));
    bookmakerSignals.push({
      key: "FreeProxy",
      bookmaker: "Gratis model-proxy",
      diff: sourceDiff,
      strength: Number(clamp(0.12 + sourceQuality * 0.25, 0.12, 0.38).toFixed(2)),
      closingCoverage: 0.18,
      lean: sourceDiff >= 0.3 ? "home" : sourceDiff <= -0.3 ? "away" : "neutral",
      source: "derived-free-market-proxy",
    });
  }
  if (bookmakerSignals.length && bookmakerAgreement === 0) {
    bookmakerAgreement = Number(
      (
        bookmakerSignals.filter((item) => item.lean === "home" || item.lean === "away").length /
        bookmakerSignals.length
      ).toFixed(2)
    );
  }

  return {
    summary: `closing-profiel ${input.homeTeamProfile?.teamName || "thuis"} ${homeImplied.toFixed(2)} PPG vs ${input.awayTeamProfile?.teamName || "uit"} ${awayImplied.toFixed(2)} PPG, dekking ${Math.round(effectiveCoverage * 100)}%, bookmaker-consensus ${Math.round(bookmakerAgreement * 100)}%`,
    source: supplementalSignals.length ? "football-data.co.uk + Sofascore current odds" : "football-data.co.uk",
    homeImpliedPpg: homeImplied,
    awayImpliedPpg: awayImplied,
    overperformanceDiff: diff,
    homeGames: Number(home?.homeGames || 0),
    awayGames: Number(away?.awayGames || 0),
    strength,
    closingLean,
    closingCoverage: effectiveCoverage,
    bookmakerSignals,
    bookmakerAgreement,
  };
}

function getSeasonFolder(dateISO) {
  const base = dateISO ? new Date(dateISO) : new Date();
  const amsterdamString = base.toLocaleString("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "numeric",
  });
  const [yearStr, monthStr] = amsterdamString.split('/');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const startYear = month >= 6 ? year : year - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}${String(endYear).slice(-2)}`;
}

function getSeasonFolders(dateISO, seasonsBack = 2) {
  const base = dateISO ? new Date(dateISO) : new Date();
  const amsterdamString = base.toLocaleString("en-US", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "numeric",
  });
  const [monthStr, yearStr] = amsterdamString.split('/');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const startYear = month >= 6 ? year : year - 1;
  const folders = [];
  for (let offset = 0; offset < seasonsBack; offset += 1) {
    const currentStart = startYear - offset;
    const currentEnd = currentStart + 1;
    folders.push(`${String(currentStart).slice(-2)}${String(currentEnd).slice(-2)}`);
  }
  return folders;
}

function getOpenfootballSeasonTags(dateISO, seasonsBack = 2) {
  const folder = getSeasonFolder(dateISO);
  const startYear = 2000 + Number(folder.slice(0, 2));
  const tags = [];
  for (let offset = 0; offset < seasonsBack; offset += 1) {
    const currentStart = startYear - offset;
    const currentEnd = String(currentStart + 1).slice(-2);
    tags.push(`${currentStart}-${currentEnd}`);
  }
  return tags;
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

function parseFootballDataDateKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    let year = Number(slashMatch[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return raw;
  return null;
}

function buildFootballDataKickoffIso(dateKey, timeValue) {
  const rawTime = String(timeValue || "").trim();
  const timeMatch = rawTime.match(/^(\d{1,2}):(\d{2})$/);
  const hours = timeMatch ? Number(timeMatch[1]) : 15;
  const minutes = timeMatch ? Number(timeMatch[2]) : 0;
  return new Date(
    `${dateKey}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+02:00`
  ).toISOString();
}

async function fetchFallbackScheduledEventsFromMarket(dateISO) {
  const seasonFolder = getSeasonFolder(dateISO);
  const fallbackEvents = [];
  const seen = new Set();

  for (const leagueInfo of LEAGUES.filter((item) => MARKET_LEAGUE_CODES[item.label])) {
    const marketCode = MARKET_LEAGUE_CODES[leagueInfo.label];
    const csvText = await fetchText(`https://www.football-data.co.uk/mmz4281/${seasonFolder}/${marketCode}.csv`);
    if (!csvText) continue;

    for (const row of parseCsv(csvText)) {
      const rowDate = parseFootballDataDateKey(row.Date || row.date);
      if (rowDate !== dateISO) continue;

      const homeName = String(row.HomeTeam || row.homeTeam || "").trim();
      const awayName = String(row.AwayTeam || row.awayTeam || "").trim();
      if (!homeName || !awayName) continue;
      if (isWomenContext(leagueInfo.label, homeName, awayName) || isYouthContext(leagueInfo.label, homeName, awayName)) continue;

      const id = `fd-${marketCode}-${dateISO}-${normalizeName(homeName)}-${normalizeName(awayName)}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const homeGoals = toNumber(row.FTHG);
      const awayGoals = toNumber(row.FTAG);
      const finished = Number.isFinite(homeGoals) && Number.isFinite(awayGoals);

      fallbackEvents.push({
        id,
        startTimestamp: Math.floor(new Date(buildFootballDataKickoffIso(dateISO, row.Time)).getTime() / 1000),
        homeTeam: { id: "", name: homeName, country: { name: leagueInfo.country || "" } },
        awayTeam: { id: "", name: awayName, country: { name: leagueInfo.country || "" } },
        uniqueTournament: { id: null, name: leagueInfo.name },
        tournament: {
          id: null,
          name: leagueInfo.name,
          category: { name: leagueInfo.country || "" },
          uniqueTournament: { id: null },
        },
        season: { id: null },
        status: { type: finished ? "finished" : "notstarted" },
        homeScore: finished ? { current: homeGoals } : {},
        awayScore: finished ? { current: awayGoals } : {},
        source: "football-data-fixture-fallback",
      });
    }
  }

  return fallbackEvents;
}

function dedupeFallbackEvents(events) {
  const canonicalEventName = (name) => canonicalTeamName(name || "");
  const hasScore = (event) => event?.homeScore?.current != null && event?.awayScore?.current != null;
  const hasLogos = (event) => Boolean(event?.homeTeam?.logoUrl) && Boolean(event?.awayTeam?.logoUrl);
  const quality = (event) => {
    const status = resolveAppStatus(event);
    const statusScore = status === "FT" ? 60 : status === "LIVE" || status === "HT" ? 50 : status === "RESULT_PENDING" ? 15 : 0;
    const scoreQuality = hasScore(event) ? 25 : 0;
    const logoQuality = Number(Boolean(event?.homeTeam?.logoUrl)) + Number(Boolean(event?.awayTeam?.logoUrl));
    const sourceQuality = String(event?.source || "").includes("espn")
      ? 8
      : String(event?.source || "").includes("thesportsdb")
        ? 6
        : String(event?.source || "").includes("openligadb")
          ? 4
          : 1;
    return statusScore + scoreQuality + logoQuality + sourceQuality;
  };
  const mergeEvent = (current, incoming) => {
    const incomingPreferred = quality(incoming) > quality(current);
    const preferred = incomingPreferred ? { ...incoming } : { ...current };
    const fallback = incomingPreferred ? current : incoming;

    preferred.homeTeam = {
      ...(fallback?.homeTeam || {}),
      ...(preferred?.homeTeam || {}),
      logoUrl: preferred?.homeTeam?.logoUrl || fallback?.homeTeam?.logoUrl || "",
    };
    preferred.awayTeam = {
      ...(fallback?.awayTeam || {}),
      ...(preferred?.awayTeam || {}),
      logoUrl: preferred?.awayTeam?.logoUrl || fallback?.awayTeam?.logoUrl || "",
    };

    if (!hasScore(preferred) && hasScore(fallback)) {
      preferred.homeScore = fallback.homeScore;
      preferred.awayScore = fallback.awayScore;
      preferred.status = fallback.status || preferred.status;
      preferred.time = fallback.time || preferred.time;
      preferred.period = fallback.period || preferred.period;
    }

    if (!hasLogos(preferred) && hasLogos(fallback)) {
      preferred.homeTeam.logoUrl = fallback.homeTeam.logoUrl;
      preferred.awayTeam.logoUrl = fallback.awayTeam.logoUrl;
    }

    preferred.source = [...new Set([preferred.source, fallback?.source].filter(Boolean))].join("+");
    return preferred;
  };
  const seen = new Map();
  for (const event of events || []) {
    const kickoff = Number(event?.startTimestamp || 0);
    const dateKey = Number.isFinite(kickoff) && kickoff > 0
      ? toAmsterdamDateKey(new Date(kickoff * 1000))
      : "";
    const home = canonicalEventName(event?.homeTeam?.name || "");
    const away = canonicalEventName(event?.awayTeam?.name || "");
    const key = `${dateKey}|${home}|${away}`;
    const current = seen.get(key);
    if (!current) {
      seen.set(key, event);
      continue;
    }

    seen.set(key, mergeEvent(current, event));
  }
  return [...seen.values()];
}

function getSportsDbSeasonLabel(dateISO) {
  const base = new Date(`${dateISO}T12:00:00Z`);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  return month >= 6 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}


function fetchCuratedFixtureBackfill(dateISO) {
  return CURATED_FIXTURE_BACKFILL
    .filter((item) => item.date === dateISO)
    .map((item) => {
      const leagueInfo = LEAGUES.find((league) => league.label === item.league) || {
        label: item.league,
        name: item.tournament,
        country: item.country,
        type: item.league.includes("Champions") ? "cup" : "league",
      };
      const kickoffIso = buildFootballDataKickoffIso(dateISO, item.time);
      const id = `curated-${dateISO}-${normalizeName(item.home)}-${normalizeName(item.away)}`;
      return {
        id,
        startTimestamp: Math.floor(new Date(kickoffIso).getTime() / 1000),
        homeTeam: { id: "", name: item.home, country: { name: item.country || leagueInfo.country || "" } },
        awayTeam: { id: "", name: item.away, country: { name: item.country || leagueInfo.country || "" } },
        uniqueTournament: { id: null, name: item.tournament || leagueInfo.name },
        tournament: {
          id: null,
          name: item.tournament || leagueInfo.name,
          category: { name: item.country || leagueInfo.country || "" },
          uniqueTournament: { id: null },
        },
        season: { id: null },
        roundInfo: item.round ? { name: item.round, roundType: item.round } : null,
        status: { type: "notstarted" },
        homeScore: {},
        awayScore: {},
        curatedMeta: {
          sourceNote: item.sourceNote || "curated fixture backfill",
          aggregateLabel: item.aggregateLabel || null,
        },
        source: "curated-fixture-fallback",
      };
    });
}

function lookupCuratedResultBackfill(dateISO, homeName, awayName) {
  const pairKey = buildPairKey(homeName, awayName);
  return (
    CURATED_RESULT_BACKFILL.find((item) => item.date === dateISO && buildPairKey(item.home, item.away) === pairKey) ||
    null
  );
}

function applyCuratedResultBackfill(event, dateISO) {
  const result = lookupCuratedResultBackfill(
    dateISO,
    event?.homeTeam?.name || "",
    event?.awayTeam?.name || ""
  );
  if (!result) return event;

  const [homeGoals, awayGoals] = String(result.score || "").split("-").map(Number);
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return event;

  return {
    ...event,
    status: { ...(event.status || {}), type: "finished", description: "FT" },
    homeScore: { ...(event.homeScore || {}), current: homeGoals },
    awayScore: { ...(event.awayScore || {}), current: awayGoals },
    resultBackfillMeta: {
      sourceNote: result.sourceNote || "curated result backfill",
    },
    source: `${event.source || "unknown"}+result-backfill`,
  };
}

function inferPostKickoffStatus(event, appStatus, score, nowMs) {
  if (appStatus !== "NS" || score) return appStatus;
  const kickoffMs = Number(event?.startTimestamp || 0) * 1000;
  if (!Number.isFinite(kickoffMs) || kickoffMs <= 0) return appStatus;
  return nowMs - kickoffMs > 150 * 60 * 1000 ? "RESULT_PENDING" : appStatus;
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

function getBbcLeagueLabel(html, index) {
  const before = html.slice(Math.max(0, index - 5000), index);
  const headings = [...before.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)];
  const headingName = decodeHtmlText(String(headings.at(-1)?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  if (BBC_COMPETITION_TO_LABEL[headingName]) return BBC_COMPETITION_TO_LABEL[headingName];
  if (headingName) return null;

  const matches = [...before.matchAll(/SignpostLink[^>]*>([^<]+)</g)];
  const competitionName = decodeHtmlText(matches.at(-1)?.[1] || "");
  return BBC_COMPETITION_TO_LABEL[competitionName] || null;
}

function parseBbcAggregate(block, homeName, awayName) {
  const aggregateTextMatch = String(block || "").match(/Aggregate score\s+([^<]+?)<\/span>/i);
  const aggregateText = decodeHtmlText(aggregateTextMatch?.[1] || "");
  const numberMatch = aggregateText.match(/(.+?)\s+(\d+)\s*,\s*(.+?)\s+(\d+)/);
  if (!numberMatch) return null;

  const firstTeam = decodeHtmlText(numberMatch[1]);
  const firstGoals = Number(numberMatch[2]);
  const secondTeam = decodeHtmlText(numberMatch[3]);
  const secondGoals = Number(numberMatch[4]);
  if (!Number.isFinite(firstGoals) || !Number.isFinite(secondGoals)) return null;

  const homeVariants = buildPossibleNames(homeName);
  const awayVariants = buildPossibleNames(awayName);
  const firstVariants = buildPossibleNames(firstTeam);
  const secondVariants = buildPossibleNames(secondTeam);
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

function rememberEspnTeamLogo(team) {
  const logo =
    String(team?.logos?.[0]?.href || team?.logo || "").trim();
  if (!logo) return;
  const names = [
    team?.displayName,
    team?.name,
    team?.shortDisplayName,
  ].filter(Boolean);
  for (const name of names) {
    for (const variant of buildLogoLookupNames(name)) {
      espnTeamLogoCache.set(normalizeName(variant), logo);
    }
  }
}

async function ensureEspnTeamLogoCache() {
  if (espnTeamLogoCacheLoaded) return;
  espnTeamLogoCacheLoaded = true;
  const codes = [...new Set(Object.values(ESPN_SCOREBOARD_LEAGUES))];
  for (const code of codes) {
    const json = await fetchExternalJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/teams`);
    const teams = json?.sports?.[0]?.leagues?.[0]?.teams || json?.sports?.leagues?.teams || [];
    for (const wrapper of teams || []) {
      rememberEspnTeamLogo(wrapper?.team || wrapper);
    }
    await sleep(20);
  }
}

async function resolveEspnTeamLogoByName(teamName) {
  await ensureEspnTeamLogoCache();
  const variants = buildLogoLookupNames(teamName);
  for (const variant of variants) {
    const logo = espnTeamLogoCache.get(normalizeName(variant));
    if (logo) return logo;
  }
  return "";
}

async function fetchBbcScheduledEvents(dateISO) {
  const html = await fetchText(`https://www.bbc.co.uk/sport/football/scores-fixtures/${dateISO}`);
  if (!html) return [];

  const fallbackEvents = [];
  const pattern = /<span class="visually-hidden[^"]*">([^<]+?) versus ([^<]+?) kick off ([0-9]{1,2}:[0-9]{2})<\/span>/g;
  for (const match of html.matchAll(pattern)) {
    const homeName = decodeHtmlText(match[1]);
    const awayName = decodeHtmlText(match[2]);
    const time = decodeHtmlText(match[3]);
    const leagueLabel = getBbcLeagueLabel(html, match.index || 0);
    const eventBlock = html.slice(match.index || 0, Math.min(html.length, (match.index || 0) + 3500));
    const bbcAggregate = parseBbcAggregate(eventBlock, homeName, awayName);
    if (!leagueLabel) continue;
    if (isWomenContext(leagueLabel, homeName, awayName) || isYouthContext(leagueLabel, homeName, awayName)) continue;

    const leagueInfo = LEAGUES.find((item) => item.label === leagueLabel) || {
      label: leagueLabel,
      name: leagueLabel.split(" - ").at(-1),
      country: leagueLabel.split(" - ")[0],
      type: leagueLabel.includes("Europe -") ? "cup" : "league",
    };
    const kickoffIso = buildFootballDataKickoffIso(dateISO, time);
    const [homeLogoUrl, awayLogoUrl] = await Promise.all([
      resolveEspnTeamLogoByName(homeName),
      resolveEspnTeamLogoByName(awayName),
    ]);
    fallbackEvents.push({
      id: `bbc-${dateISO}-${normalizeName(homeName)}-${normalizeName(awayName)}`,
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

async function fetchSportsDbScheduledEvents(dateISO) {
  const fallbackById = new Map();
  const appendEvent = (event, leagueLabel) => {
    const leagueInfo = LEAGUES.find((item) => item.label === leagueLabel);
    if (!leagueInfo) return;
    const homeName = String(event?.strHomeTeam || "").trim();
    const awayName = String(event?.strAwayTeam || "").trim();
    if (!homeName || !awayName) return;
    if (isWomenContext(leagueLabel, homeName, awayName) || isYouthContext(leagueLabel, homeName, awayName)) return;

    const eventId = `tsdb-${leagueLabel}-${event.idEvent || `${dateISO}-${normalizeName(homeName)}-${normalizeName(awayName)}`}`;

    const kickoff = event?.strTimestamp
      ? new Date(String(event.strTimestamp).replace(" ", "T") + "Z")
      : new Date(buildFootballDataKickoffIso(dateISO, event?.strTimeLocal || event?.strTime));
    const homeGoals = toNumber(event?.intHomeScore);
    const awayGoals = toNumber(event?.intAwayScore);
    const statusText = String(event?.strStatus || "").toLowerCase();
    const rawScoreAvailable = Number.isFinite(homeGoals) && Number.isFinite(awayGoals);
    const finished =
      statusText.includes("finished") ||
      statusText === "ft" ||
      statusText.includes("full time") ||
      (rawScoreAvailable && kickoff.getTime() + 150 * 60 * 1000 < Date.now());
    const statusType = finished
      ? "finished"
      : statusText.includes("half")
        ? "halftime"
        : statusText.includes("live") ||
            statusText.includes("progress") ||
            statusText.includes("1st") ||
            statusText.includes("2nd") ||
            statusText === "1h" ||
            statusText === "2h"
        ? "inprogress"
        : "notstarted";
    const scoreAvailable = rawScoreAvailable && statusType !== "notstarted";

    const mappedEvent = {
      id: eventId,
      startTimestamp: Math.floor(kickoff.getTime() / 1000),
      homeTeam: {
        id: "",
        name: homeName,
        country: { name: leagueInfo.country || "" },
        logoUrl: String(event?.strHomeTeamBadge || ""),
      },
      awayTeam: {
        id: "",
        name: awayName,
        country: { name: leagueInfo.country || "" },
        logoUrl: String(event?.strAwayTeamBadge || ""),
      },
      uniqueTournament: { id: null, name: leagueInfo.name },
      tournament: {
        id: null,
        name: leagueInfo.name,
        category: { name: leagueInfo.country || "" },
        uniqueTournament: { id: null },
      },
      season: { id: null },
      status: {
        type: statusType,
        description: statusType === "halftime" ? "HT" : event?.strStatus || "",
      },
      period: statusType === "halftime" ? "HT" : null,
      homeScore: scoreAvailable ? { current: homeGoals } : {},
      awayScore: scoreAvailable ? { current: awayGoals } : {},
      source: "thesportsdb-fixture-fallback",
    };

    const quality =
      (scoreAvailable ? 20 : 0) +
      (statusType === "finished" ? 12 : statusType === "halftime" ? 8 : statusType === "inprogress" ? 6 : 0) +
      (event?.strTimestamp ? 2 : 0);
    const existing = fallbackById.get(eventId);
    if (!existing || quality > existing.quality) {
      fallbackById.set(eventId, { quality, event: mappedEvent });
    }
  };

  try {
    const response = await fetch(`https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${dateISO}&s=Soccer`, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
      },
    });
    if (response.ok) {
      const json = await response.json();
      for (const event of Array.isArray(json?.events) ? json.events : []) {
        const leagueLabel = SPORTSDB_NAME_TO_LABEL[String(event?.strLeague || "")];
        if (leagueLabel) appendEvent(event, leagueLabel);
      }
    }
  } catch {}

  for (const [leagueLabel, leagueId] of Object.entries(SPORTSDB_LEAGUE_IDS)) {
    for (const endpoint of ["eventsnextleague", "eventspastleague"]) {
      try {
        const response = await fetch(`https://www.thesportsdb.com/api/v1/json/123/${endpoint}.php?id=${leagueId}`, {
          headers: {
            Accept: "application/json",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
          },
        });
        if (!response.ok) continue;
        const json = await response.json();
        for (const event of Array.isArray(json?.events) ? json.events : []) {
          if (String(event?.dateEvent || "") !== dateISO) continue;
          appendEvent(event, leagueLabel);
        }
      } catch {}
    }
  }

  return Array.from(fallbackById.values()).map((item) => item.event);
}

function getEspnCompetitor(competition, side) {
  return (competition?.competitors || []).find((competitor) => competitor?.homeAway === side) || null;
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

function getEspnDisplayMinute(status) {
  const detail = String(status?.type?.shortDetail || status?.type?.detail || status?.displayClock || "").trim();
  const minute = parseMinuteFromDescription(detail);
  if (minute?.current) return { current: minute.current, extra: minute.extra || 0, label: detail };
  const clockSeconds = Number(status?.clock || 0);
  if (clockSeconds > 0) {
    const current = Math.max(1, Math.floor(clockSeconds / 60));
    return { current, extra: 0, label: `${current}'` };
  }
  return { current: null, extra: 0, label: detail || null };
}

async function fetchEspnScoreboardEvents(dateISO) {
  const fallbackEvents = [];
  const yyyymmdd = String(dateISO || "").replace(/-/g, "");

  for (const [leagueLabel, espnCode] of Object.entries(ESPN_SCOREBOARD_LEAGUES)) {
    const leagueInfo = LEAGUES.find((item) => item.label === leagueLabel);
    if (!leagueInfo) continue;

    const json = await fetchExternalJson(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnCode}/scoreboard?dates=${yyyymmdd}`
    );
    const events = Array.isArray(json?.events) ? json.events : [];
    for (const event of events) {
      const competition = event?.competitions?.[0] || {};
      const home = getEspnCompetitor(competition, "home");
      const away = getEspnCompetitor(competition, "away");
      const homeName = String(home?.team?.displayName || home?.team?.name || "").trim();
      const awayName = String(away?.team?.displayName || away?.team?.name || "").trim();
      if (!homeName || !awayName) continue;
      if (isWomenContext(leagueLabel, homeName, awayName) || isYouthContext(leagueLabel, homeName, awayName)) continue;

      const kickoff = new Date(competition?.date || event?.date || "");
      if (toAmsterdamDateKey(kickoff) !== dateISO) continue;

      const statusType = competition?.status?.type || event?.status?.type || {};
      const homeGoals = toNumber(home?.score);
      const awayGoals = toNumber(away?.score);
      let appStatusType = mapEspnStatus(statusType);
      const hasNumericScore = Number.isFinite(homeGoals) && Number.isFinite(awayGoals);
      const ageMs = Date.now() - kickoff.getTime();
      if (hasNumericScore && appStatusType === "notstarted") {
        if (ageMs > 130 * 60 * 1000) appStatusType = "finished";
        else if (ageMs > 0) appStatusType = "inprogress";
      }
      const scoreAvailable =
        Number.isFinite(homeGoals) && Number.isFinite(awayGoals) && appStatusType !== "notstarted";
      const minute = getEspnDisplayMinute(competition?.status || event?.status || {});

      fallbackEvents.push({
        id: `espn-${espnCode}-${event.id || `${dateISO}-${normalizeName(homeName)}-${normalizeName(awayName)}`}`,
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
    await sleep(20);
  }

  return fallbackEvents;
}

async function fetchOpenLigaDbScheduledEvents(dateISO) {
  const fallbackEvents = [];
  const seen = new Set();

  for (const [leagueKey, leagueLabel] of Object.entries(OPENLIGADB_LEAGUES)) {
    try {
      const response = await fetch(`https://api.openligadb.de/getmatchdata/${leagueKey}`, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
        },
      });
      if (!response.ok) continue;

      const rows = await response.json();
      for (const row of Array.isArray(rows) ? rows : []) {
        const kickoffText = row?.matchDateTime || row?.matchDateTimeUTC || null;
        if (!kickoffText) continue;
        if (toAmsterdamDateKey(kickoffText) !== dateISO) continue;

        const homeName = String(row?.team1?.teamName || row?.team1?.shortName || "").trim();
        const awayName = String(row?.team2?.teamName || row?.team2?.shortName || "").trim();
        if (!homeName || !awayName) continue;
        if (isWomenContext(leagueLabel, homeName, awayName) || isYouthContext(leagueLabel, homeName, awayName)) continue;

        const uniqueKey = `${leagueLabel}|${normalizeName(homeName)}|${normalizeName(awayName)}|${kickoffText}`;
        if (seen.has(uniqueKey)) continue;
        seen.add(uniqueKey);

        const homeGoals = toNumber(row?.matchResults?.[0]?.pointsTeam1);
        const awayGoals = toNumber(row?.matchResults?.[0]?.pointsTeam2);
        const finished = Boolean(row?.matchIsFinished) || (Number.isFinite(homeGoals) && Number.isFinite(awayGoals));

        fallbackEvents.push({
          id: `oldb-${row?.matchID || uniqueKey}`,
          startTimestamp: Math.floor(new Date(kickoffText).getTime() / 1000),
          homeTeam: {
            id: "",
            name: homeName,
            country: { name: leagueLabel.split(" - ")[0] || "" },
            logoUrl: String(row?.team1?.teamIconUrl || ""),
          },
          awayTeam: {
            id: "",
            name: awayName,
            country: { name: leagueLabel.split(" - ")[0] || "" },
            logoUrl: String(row?.team2?.teamIconUrl || ""),
          },
          uniqueTournament: { id: null, name: leagueLabel },
          tournament: {
            id: null,
            name: leagueLabel,
            category: { name: leagueLabel.split(" - ")[0] || "" },
            uniqueTournament: { id: null },
          },
          season: { id: null },
          status: { type: finished ? "finished" : "notstarted" },
          homeScore: Number.isFinite(homeGoals) ? { current: homeGoals } : {},
          awayScore: Number.isFinite(awayGoals) ? { current: awayGoals } : {},
          source: "openligadb-fixture-fallback",
        });
      }
    } catch {}
  }

  return fallbackEvents;
}

function toNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function pickOdds(row, keys) {
  for (const key of keys) {
    const value = toNumber(row?.[key]);
    if (value && value > 1.01) return value;
  }
  return null;
}

function pickOddsWithMeta(row, closingKeys, openingKeys) {
  for (const key of closingKeys) {
    const value = toNumber(row?.[key]);
    if (value && value > 1.01) return { value, closing: true, key };
  }
  for (const key of openingKeys) {
    const value = toNumber(row?.[key]);
    if (value && value > 1.01) return { value, closing: false, key };
  }
  return { value: null, closing: false, key: null };
}

function extractRefereePenaltyCount(row) {
  const penaltyKeys = [
    "Penalties",
    "pens",
    "PEN",
    "HPen",
    "APen",
    "HomePens",
    "AwayPens",
    "PKH",
    "PKA",
  ];
  for (const key of penaltyKeys) {
    const value = toNumber(row?.[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

const BOOKMAKER_DEFS = [
  {
    key: "PS",
    label: "Pinnacle",
    closing: ["PSCH", "PSCD", "PSCA"],
    opening: ["PSH", "PSD", "PSA"],
  },
  {
    key: "B365",
    label: "Bet365",
    closing: ["B365CH", "B365CD", "B365CA"],
    opening: ["B365H", "B365D", "B365A"],
  },
  {
    key: "BW",
    label: "Bet&Win",
    closing: ["BWCH", "BWCD", "BWCA"],
    opening: ["BWH", "BWD", "BWA"],
  },
  {
    key: "IW",
    label: "Interwetten",
    closing: ["IWCH", "IWCD", "IWCA"],
    opening: ["IWH", "IWD", "IWA"],
  },
  {
    key: "WH",
    label: "William Hill",
    closing: ["WHCH", "WHCD", "WHCA"],
    opening: ["WHH", "WHD", "WHA"],
  },
  {
    key: "VC",
    label: "VC Bet",
    closing: ["VCCH", "VCCD", "VCCA"],
    opening: ["VCH", "VCD", "VCA"],
  },
  {
    key: "Avg",
    label: "Average",
    closing: ["AvgCH", "AvgCD", "AvgCA"],
    opening: ["AvgH", "AvgD", "AvgA"],
  },
  {
    key: "Max",
    label: "Max",
    closing: ["MaxCH", "MaxCD", "MaxCA"],
    opening: ["MaxH", "MaxD", "MaxA"],
  },
];

function buildRefereeAliasVariants(refereeName) {
  const normalized = normalizeName(refereeName);
  if (!normalized) return [];

  const parts = normalized.split(" ").filter(Boolean);
  const aliases = new Set([normalized]);
  const connectors = new Set(["de", "da", "del", "van", "von", "der", "den", "di", "la", "le"]);
  const filteredParts = parts.filter((part) => !connectors.has(part) && part !== "jr" && part !== "sr");
  const effectiveParts = filteredParts.length ? filteredParts : parts;
  const collapsed = effectiveParts.join(" ");
  if (collapsed) aliases.add(collapsed);
  const surname = parts.at(-1) || normalized;
  aliases.add(surname);
  const first = parts[0] || "";
  const firstInitial = first ? first[0] : "";
  const compact = normalized.replace(/\s+/g, "");
  const compactFiltered = collapsed.replace(/\s+/g, "");
  if (compact) aliases.add(compact);
  if (compactFiltered) aliases.add(compactFiltered);

  if (parts.length >= 2) {
    aliases.add(`${parts[0]} ${surname}`);
    aliases.add(`${parts[0][0]} ${surname}`);
    aliases.add(`${parts[0][0]}.${surname}`);
    aliases.add(`${surname} ${parts[0]}`);
    aliases.add(`${surname} ${parts[0][0]}`);
    aliases.add(`${surname} ${parts[0][0]}.`);
    aliases.add(`${parts[0][0]}-${surname}`);
    aliases.add(`${parts[0][0]}${surname}`);
    aliases.add(parts.slice(-2).join(" "));
  }

  if (parts.length >= 3) {
    aliases.add(`${parts[0]} ${parts[1]} ${surname}`);
    aliases.add(`${parts[0][0]} ${parts[1][0]} ${surname}`);
    aliases.add(`${parts[0][0]}.${parts[1][0]}. ${surname}`);
    aliases.add(`${surname} ${parts[0][0]} ${parts[1][0]}`);
  }

  if (effectiveParts.length >= 2) {
    aliases.add(`${effectiveParts[0]} ${effectiveParts.at(-1)}`);
    aliases.add(`${effectiveParts[0][0]} ${effectiveParts.at(-1)}`);
    aliases.add(`${effectiveParts[0][0]}.${effectiveParts.at(-1)}`);
    aliases.add(effectiveParts.slice(-2).join(" "));
    aliases.add(`${effectiveParts.at(-1)} ${effectiveParts[0]}`);
    aliases.add(`${effectiveParts.at(-1)} ${effectiveParts[0][0]}`);
  }

  if (effectiveParts.length >= 3) {
    aliases.add(effectiveParts.slice(-3).join(" "));
    aliases.add(`${effectiveParts.slice(0, -1).join(" ")} ${effectiveParts.at(-1)}`);
    aliases.add(`${effectiveParts[0][0]} ${effectiveParts[1][0]} ${effectiveParts.at(-1)}`);
  }

  if (surname && firstInitial) {
    aliases.add(`${firstInitial}.${surname}`);
    aliases.add(`${firstInitial} ${surname}`);
    aliases.add(`${surname}, ${firstInitial}`);
  }

  return [...aliases].filter(Boolean);
}

function getMarketLeagueFamilyCodes(leagueLabel) {
  const direct = MARKET_LEAGUE_CODES[leagueLabel];
  const countryPrefix = String(leagueLabel || "").split(" - ")[0] || "";
  const codes = new Set();
  if (direct) codes.add(direct);
  if (countryPrefix) {
    for (const [label, code] of Object.entries(MARKET_LEAGUE_CODES)) {
      if (!code) continue;
      if (String(label).startsWith(`${countryPrefix} - `)) codes.add(code);
    }
  }
  return [...codes];
}

function mergeRefereeArchives(profiles) {
  const merged = { referees: {}, refereeAliases: {} };
  for (const profile of profiles || []) {
    for (const [key, value] of Object.entries(profile?.referees || {})) {
      const existing = merged.referees[key];
      if (!existing || Number(value?.matches || 0) > Number(existing?.matches || 0)) {
        merged.referees[key] = value;
      }
    }
    for (const [alias, key] of Object.entries(profile?.refereeAliases || {})) {
      if (!merged.refereeAliases[alias]) merged.refereeAliases[alias] = key;
    }
  }
  return merged;
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

function buildPairKey(homeTeam, awayTeam) {
  return [normalizeName(homeTeam), normalizeName(awayTeam)].filter(Boolean).sort().join("__");
}

function hashString(value) {
  const text = String(value || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function escapeSvgText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getTeamInitials(name) {
  const words = String(name || "Team")
    .replace(/\b(fc|sc|sv|cf|afc|ac|as|cd|rc|ud|1\.|club|united|city)\b/gi, " ")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  const initials = (words.length >= 2 ? words[0][0] + words[1][0] : (words[0] || "T").slice(0, 2)).toUpperCase();
  return initials || "FC";
}

function createGeneratedTeamLogo(name) {
  const cleanName = String(name || "Team").trim() || "Team";
  const palettes = [
    ["#11244d", "#37d5ff", "#f7c600"],
    ["#141a3a", "#7cf6b2", "#f35b8f"],
    ["#1d2240", "#f8b73e", "#47c7ff"],
    ["#122b25", "#71f6c2", "#f8e25c"],
    ["#251a3d", "#b47cff", "#50e3c2"],
    ["#302018", "#ff8f3d", "#67d5ff"],
  ];
  const [bg, accent, accent2] = palettes[hashString(cleanName) % palettes.length];
  const initials = escapeSvgText(getTeamInitials(cleanName));
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <defs>
        <radialGradient id="g" cx="35%" cy="25%" r="75%">
          <stop offset="0%" stop-color="${accent}" stop-opacity=".85"/>
          <stop offset="48%" stop-color="${bg}"/>
          <stop offset="100%" stop-color="#050914"/>
        </radialGradient>
        <filter id="glow" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <circle cx="64" cy="64" r="59" fill="url(#g)" stroke="${accent}" stroke-width="3"/>
      <path d="M28 42 Q64 18 100 42 L92 94 Q64 112 36 94 Z" fill="none" stroke="${accent2}" stroke-width="4" opacity=".45"/>
      <text x="64" y="76" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="800" fill="#ffffff" filter="url(#glow)">${initials}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}`;
}

function isEspnDataSource(source) {
  return /espn/i.test(String(source || ""));
}

function isSofaScoreDataSource(source) {
  const text = String(source || "");
  return /sofascore|sofa-score/i.test(text) && !isEspnDataSource(text);
}

function isSofaScoreLogoUrl(url) {
  return /api\.sofascore\.(?:app|com)\/api\/v1\/team\/\d+\/image/i.test(String(url || ""));
}

function resolveEspnTeamLogoById(teamId) {
  const id = String(teamId || "").trim();
  if (!/^\d+$/.test(id)) return "";
  return `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`;
}

function resolveTeamLogoUrl(team, teamId, teamName, source) {
  const directLogo = String(team?.logoUrl || team?.logo || team?.logos?.[0]?.href || "").trim();
  if (directLogo) return directLogo;
  if (isEspnDataSource(source)) {
    const espnLogo = resolveEspnTeamLogoById(teamId);
    if (espnLogo) return espnLogo;
  }
  if (isSofaScoreDataSource(source) && teamId && /^\d+$/.test(String(teamId))) {
    return `https://api.sofascore.app/api/v1/team/${teamId}/image`;
  }
  return createGeneratedTeamLogo(team?.name || teamName || "Team");
}

async function repairStoredLogos(store) {
  const days = Object.keys(store.matches || {});
  for (const day of days) {
    const matches = Array.isArray(store.matches?.[day]) ? store.matches[day] : [];
    for (const match of matches) {
      const [homeOfficialLogo, awayOfficialLogo] = await Promise.all([
        resolveEspnTeamLogoByName(match.homeTeamName),
        resolveEspnTeamLogoByName(match.awayTeamName),
      ]);
      const dataSource = String(match.dataSource || match.source || "");
      const homeCurrentLogo = String(match.homeLogo || "").trim();
      const awayCurrentLogo = String(match.awayLogo || "").trim();
      const homeTrustedCurrentLogo = homeCurrentLogo && !(isEspnDataSource(dataSource) && isSofaScoreLogoUrl(homeCurrentLogo))
        ? homeCurrentLogo
        : "";
      const awayTrustedCurrentLogo = awayCurrentLogo && !(isEspnDataSource(dataSource) && isSofaScoreLogoUrl(awayCurrentLogo))
        ? awayCurrentLogo
        : "";
      const homeEspnLogo = isEspnDataSource(dataSource) ? resolveEspnTeamLogoById(match.homeTeamId) : "";
      const awayEspnLogo = isEspnDataSource(dataSource) ? resolveEspnTeamLogoById(match.awayTeamId) : "";
      const homeSofaLogo = isSofaScoreDataSource(dataSource) && match.homeTeamId && /^\d+$/.test(String(match.homeTeamId))
        ? `https://api.sofascore.app/api/v1/team/${match.homeTeamId}/image`
        : "";
      const awaySofaLogo = isSofaScoreDataSource(dataSource) && match.awayTeamId && /^\d+$/.test(String(match.awayTeamId))
        ? `https://api.sofascore.app/api/v1/team/${match.awayTeamId}/image`
        : "";
      match.homeLogo =
        homeEspnLogo || homeOfficialLogo || homeTrustedCurrentLogo || homeSofaLogo || createGeneratedTeamLogo(match.homeTeamName);
      match.awayLogo =
        awayEspnLogo || awayOfficialLogo || awayTrustedCurrentLogo || awaySofaLogo || createGeneratedTeamLogo(match.awayTeamName);
    }
  }
}

function repairStoredPredictionScoreSelections(store) {
  let repaired = 0;
  for (const predictions of Object.values(store.predictions || {})) {
    if (!Array.isArray(predictions)) continue;
    for (const prediction of predictions) {
      const topScore = Object.entries(prediction?.scoreMatrix || {})
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0];
      if (!topScore) continue;
      const [score, probability] = topScore;
      const [homeGoals, awayGoals] = score.split("-").map(Number);
      if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
      const currentScore = `${Number(prediction.predHomeGoals || 0)}-${Number(prediction.predAwayGoals || 0)}`;
      if (currentScore === score) continue;
      prediction.predHomeGoals = homeGoals;
      prediction.predAwayGoals = awayGoals;
      prediction.exactProb = Number(probability || 0);
      if (!prediction.modelEdges || typeof prediction.modelEdges !== "object") prediction.modelEdges = {};
      prediction.modelEdges.scoreSelection = {
        ...(prediction.modelEdges.scoreSelection || {}),
        rawBestScore: score,
        selectedScore: score,
        reason: "hoogste exacte scorematrix-kans",
        repairedFrom: currentScore,
      };
      repaired += 1;
    }
  }
  if (repaired > 0) console.log(`[worker] ${repaired} oude voorspellingen gelijkgetrokken met scorematrix`);
}

function parseHistoricalRowDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const year = Number(slash[3]) < 100 ? 2000 + Number(slash[3]) : Number(slash[3]);
    const iso = `${year}-${String(slash[2]).padStart(2, "0")}-${String(slash[1]).padStart(2, "0")}`;
    return iso;
  }
  const dash = new Date(text);
  if (!Number.isNaN(dash.getTime())) return dash.toISOString().slice(0, 10);
  return null;
}

function mergeH2HResultLists(existingResults = [], extraResults = []) {
  const seen = new Set();
  const merged = [];
  for (const item of [...existingResults, ...extraResults]) {
    const key = `${item?.date || ""}_${item?.home || ""}_${item?.away || ""}_${item?.score || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")))
    .slice(-8);
}

function h2hCompareKeys(homeName, awayName, homeId, awayId) {
  return {
    home: String(homeId || normalizeName(homeName)),
    away: String(awayId || normalizeName(awayName)),
  };
}

function normalizeH2HWinnerId(item, homeName, awayName, homeId, awayId) {
  const keys = h2hCompareKeys(homeName, awayName, homeId, awayId);
  const winner = String(item?.winnerId || "");
  if (!winner) return "";
  if (winner === String(homeId || "") || winner === normalizeName(homeName)) return keys.home;
  if (winner === String(awayId || "") || winner === normalizeName(awayName)) return keys.away;
  return winner;
}

function summarizeH2HResults(results, homeName, awayName, homeId, awayId, status, sameCompetitionPlayed = 0) {
  const keys = h2hCompareKeys(homeName, awayName, homeId, awayId);
  const normalizedResults = (results || [])
    .map((item) => ({
      ...item,
      winnerId: normalizeH2HWinnerId(item, homeName, awayName, homeId, awayId),
    }))
    .filter((item) => item?.score)
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")))
    .slice(-5);

  return {
    played: normalizedResults.length,
    homeWins: normalizedResults.filter((item) => String(item.winnerId || "") === keys.home).length,
    draws: normalizedResults.filter((item) => !item.winnerId).length,
    awayWins: normalizedResults.filter((item) => String(item.winnerId || "") === keys.away).length,
    sameCompetitionPlayed,
    weightedRecentBalance: calculateRecentH2HBalance({ results: normalizedResults }, keys.home, keys.away),
    results: normalizedResults,
    status: status || "h2h-agent",
  };
}

function buildMarketProfiles(rows) {
  const teams = {};
  const referees = {};
  const refereeAliases = {};
  const h2hPairs = {};
  let closingRows = 0;
  let fallbackRows = 0;
  let validRows = 0;

  for (const row of rows || []) {
    const homeTeam = String(row.HomeTeam || row.homeTeam || "").trim();
    const awayTeam = String(row.AwayTeam || row.awayTeam || "").trim();
    const homeGoals = toNumber(row.FTHG);
    const awayGoals = toNumber(row.FTAG);
    const result = String(row.FTR || outcomeFromGoals(homeGoals, awayGoals) || "");
    const homeOddsMeta = pickOddsWithMeta(row, ["PSCH", "AvgCH", "MaxCH", "B365CH"], ["PSH", "AvgH", "MaxH", "B365H"]);
    const drawOddsMeta = pickOddsWithMeta(row, ["PSCD", "AvgCD", "MaxCD", "B365CD"], ["PSD", "AvgD", "MaxD", "B365D"]);
    const awayOddsMeta = pickOddsWithMeta(row, ["PSCA", "AvgCA", "MaxCA", "B365CA"], ["PSA", "AvgA", "MaxA", "B365A"]);
    const homeOdds = homeOddsMeta.value;
    const drawOdds = drawOddsMeta.value;
    const awayOdds = awayOddsMeta.value;

    if (!homeTeam || !awayTeam || !homeOdds || !drawOdds || !awayOdds || !result) continue;

    validRows += 1;
    const usedClosing = [homeOddsMeta, drawOddsMeta, awayOddsMeta].filter((item) => item.closing).length >= 2;
    if (usedClosing) closingRows += 1;
    else fallbackRows += 1;

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
        shotsFor: 0,
        shotsAgainst: 0,
        shotsOnFor: 0,
        shotsOnAgainst: 0,
        cornersFor: 0,
        cornersAgainst: 0,
        yellowCards: 0,
        redCards: 0,
        cleanSheets: 0,
        failedToScore: 0,
        bttsMatches: 0,
        over25Matches: 0,
        statsRows: 0,
        recentMatches: [],
        bookmakers: {},
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
        shotsFor: 0,
        shotsAgainst: 0,
        shotsOnFor: 0,
        shotsOnAgainst: 0,
        cornersFor: 0,
        cornersAgainst: 0,
        yellowCards: 0,
        redCards: 0,
        cleanSheets: 0,
        failedToScore: 0,
        bttsMatches: 0,
        over25Matches: 0,
        statsRows: 0,
        recentMatches: [],
        bookmakers: {},
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

    const homeShots = toNumber(row.HS);
    const awayShots = toNumber(row.AS);
    const homeShotsOn = toNumber(row.HST);
    const awayShotsOn = toNumber(row.AST);
    const homeCorners = toNumber(row.HC);
    const awayCorners = toNumber(row.AC);
    const homeYellow = toNumber(row.HY);
    const awayYellow = toNumber(row.AY);
    const homeRed = toNumber(row.HR);
    const awayRed = toNumber(row.AR);
    const hasStats =
      Number.isFinite(homeShots) ||
      Number.isFinite(awayShots) ||
      Number.isFinite(homeShotsOn) ||
      Number.isFinite(awayShotsOn) ||
      Number.isFinite(homeCorners) ||
      Number.isFinite(awayCorners);

    if (hasStats) {
      teams[homeKey].statsRows += 1;
      teams[awayKey].statsRows += 1;
      teams[homeKey].shotsFor += Number(homeShots || 0);
      teams[homeKey].shotsAgainst += Number(awayShots || 0);
      teams[awayKey].shotsFor += Number(awayShots || 0);
      teams[awayKey].shotsAgainst += Number(homeShots || 0);
      teams[homeKey].shotsOnFor += Number(homeShotsOn || 0);
      teams[homeKey].shotsOnAgainst += Number(awayShotsOn || 0);
      teams[awayKey].shotsOnFor += Number(awayShotsOn || 0);
      teams[awayKey].shotsOnAgainst += Number(homeShotsOn || 0);
      teams[homeKey].cornersFor += Number(homeCorners || 0);
      teams[homeKey].cornersAgainst += Number(awayCorners || 0);
      teams[awayKey].cornersFor += Number(awayCorners || 0);
      teams[awayKey].cornersAgainst += Number(homeCorners || 0);
    }

    teams[homeKey].yellowCards += Number(homeYellow || 0);
    teams[awayKey].yellowCards += Number(awayYellow || 0);
    teams[homeKey].redCards += Number(homeRed || 0);
    teams[awayKey].redCards += Number(awayRed || 0);
    if (Number.isFinite(homeGoals) && Number.isFinite(awayGoals)) {
      if (awayGoals === 0) teams[homeKey].cleanSheets += 1;
      if (homeGoals === 0) teams[awayKey].cleanSheets += 1;
      if (homeGoals === 0) teams[homeKey].failedToScore += 1;
      if (awayGoals === 0) teams[awayKey].failedToScore += 1;
      if (homeGoals > 0 && awayGoals > 0) {
        teams[homeKey].bttsMatches += 1;
        teams[awayKey].bttsMatches += 1;
      }
      if (homeGoals + awayGoals > 2.5) {
        teams[homeKey].over25Matches += 1;
        teams[awayKey].over25Matches += 1;
      }

      const rowDate = parseHistoricalRowDate(row.Date);
      teams[homeKey].recentMatches.push({
        date: rowDate,
        league: row.Div || row.League || null,
        venue: "H",
        opponent: awayTeam,
        opponentId: "",
        score: `${homeGoals}-${awayGoals}`,
        goalsFor: homeGoals,
        goalsAgainst: awayGoals,
        result: homeGoals > awayGoals ? "W" : homeGoals === awayGoals ? "D" : "L",
        source: "football-data.co.uk",
      });
      teams[awayKey].recentMatches.push({
        date: rowDate,
        league: row.Div || row.League || null,
        venue: "A",
        opponent: homeTeam,
        opponentId: "",
        score: `${awayGoals}-${homeGoals}`,
        goalsFor: awayGoals,
        goalsAgainst: homeGoals,
        result: awayGoals > homeGoals ? "W" : awayGoals === homeGoals ? "D" : "L",
        source: "football-data.co.uk",
      });
    }

    const pairKey = buildPairKey(homeTeam, awayTeam);
    if (!h2hPairs[pairKey]) h2hPairs[pairKey] = [];
    const winnerId = result === "H" ? homeKey : result === "A" ? awayKey : "";
    h2hPairs[pairKey].push({
      date: parseHistoricalRowDate(row.Date),
      home: homeTeam,
      away: awayTeam,
      homeTeamId: "",
      awayTeamId: "",
      score: Number.isFinite(homeGoals) && Number.isFinite(awayGoals) ? `${homeGoals}-${awayGoals}` : "-",
      winnerId,
      source: "football-data.co.uk",
    });

    for (const bookmaker of BOOKMAKER_DEFS) {
      const homeBookMeta = pickOddsWithMeta(row, [bookmaker.closing[0]], [bookmaker.opening[0]]);
      const drawBookMeta = pickOddsWithMeta(row, [bookmaker.closing[1]], [bookmaker.opening[1]]);
      const awayBookMeta = pickOddsWithMeta(row, [bookmaker.closing[2]], [bookmaker.opening[2]]);
      if (!homeBookMeta.value || !drawBookMeta.value || !awayBookMeta.value) continue;

      const usedBookClosing = [homeBookMeta, drawBookMeta, awayBookMeta].filter((item) => item.closing).length >= 2;
      const bookmakerImplied = normalizeProbabilities(1 / homeBookMeta.value, 1 / drawBookMeta.value, 1 / awayBookMeta.value);

      if (!teams[homeKey].bookmakers[bookmaker.key]) {
        teams[homeKey].bookmakers[bookmaker.key] = {
          bookmaker: bookmaker.label,
          homeGames: 0,
          awayGames: 0,
          homeActualPoints: 0,
          awayActualPoints: 0,
          homeImpliedPoints: 0,
          awayImpliedPoints: 0,
          closingRows: 0,
          fallbackRows: 0,
        };
      }
      if (!teams[awayKey].bookmakers[bookmaker.key]) {
        teams[awayKey].bookmakers[bookmaker.key] = {
          bookmaker: bookmaker.label,
          homeGames: 0,
          awayGames: 0,
          homeActualPoints: 0,
          awayActualPoints: 0,
          homeImpliedPoints: 0,
          awayImpliedPoints: 0,
          closingRows: 0,
          fallbackRows: 0,
        };
      }

      teams[homeKey].bookmakers[bookmaker.key].homeGames += 1;
      teams[homeKey].bookmakers[bookmaker.key].homeActualPoints += actualHomePoints;
      teams[homeKey].bookmakers[bookmaker.key].homeImpliedPoints += bookmakerImplied.home * 3 + bookmakerImplied.draw;
      teams[awayKey].bookmakers[bookmaker.key].awayGames += 1;
      teams[awayKey].bookmakers[bookmaker.key].awayActualPoints += actualAwayPoints;
      teams[awayKey].bookmakers[bookmaker.key].awayImpliedPoints += bookmakerImplied.away * 3 + bookmakerImplied.draw;

      if (usedBookClosing) {
        teams[homeKey].bookmakers[bookmaker.key].closingRows += 1;
        teams[awayKey].bookmakers[bookmaker.key].closingRows += 1;
      } else {
        teams[homeKey].bookmakers[bookmaker.key].fallbackRows += 1;
        teams[awayKey].bookmakers[bookmaker.key].fallbackRows += 1;
      }
    }

    const refereeName = String(row.Referee || row.referee || "").trim();
    if (refereeName) {
      const refereeKey = normalizeName(refereeName);
      const yellowCards = Number(toNumber(row.HY) || 0) + Number(toNumber(row.AY) || 0);
      const redCards = Number(toNumber(row.HR) || 0) + Number(toNumber(row.AR) || 0);
      const totalCards = Number((yellowCards + redCards * 2).toFixed(2));
      const penaltyCount = extractRefereePenaltyCount(row);
      if (!referees[refereeKey]) {
        referees[refereeKey] = {
          refereeName,
          matches: 0,
          yellowCards: 0,
          redCards: 0,
          totalCards: 0,
          penaltyEvents: 0,
          penaltyMatches: 0,
        };
      }
      referees[refereeKey].matches += 1;
      referees[refereeKey].yellowCards += yellowCards;
      referees[refereeKey].redCards += redCards;
      referees[refereeKey].totalCards += totalCards;
      if (penaltyCount != null) {
        referees[refereeKey].penaltyEvents += Number(penaltyCount || 0);
        referees[refereeKey].penaltyMatches += 1;
      }
    }
  }

  const formattedTeams = {};
  for (const [key, value] of Object.entries(teams)) {
    const homeActualPpg = value.homeGames ? value.homeActualPoints / value.homeGames : 0;
    const awayActualPpg = value.awayGames ? value.awayActualPoints / value.awayGames : 0;
    const homeImpliedPpg = value.homeGames ? value.homeImpliedPoints / value.homeGames : 0;
    const awayImpliedPpg = value.awayGames ? value.awayImpliedPoints / value.awayGames : 0;
    const statsRows = Math.max(Number(value.statsRows || 0), 1);
    const games = Math.max(Number(value.totalGames || 0), 1);
    const avgShots = Number((Number(value.shotsFor || 0) / statsRows).toFixed(2));
    const avgShotsAgainst = Number((Number(value.shotsAgainst || 0) / statsRows).toFixed(2));
    const avgShotsOn = Number((Number(value.shotsOnFor || 0) / statsRows).toFixed(2));
    const avgShotsOnAgainst = Number((Number(value.shotsOnAgainst || 0) / statsRows).toFixed(2));
    const avgCorners = Number((Number(value.cornersFor || 0) / statsRows).toFixed(2));
    const avgCornersAgainst = Number((Number(value.cornersAgainst || 0) / statsRows).toFixed(2));
    const dominanceScore = Number(
      (
        (avgShots - avgShotsAgainst) * 0.055 +
        (avgShotsOn - avgShotsOnAgainst) * 0.13 +
        (avgCorners - avgCornersAgainst) * 0.035
      ).toFixed(2)
    );
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
      historicalStats: {
        source: "football-data.co.uk",
        seasons: 5,
        games: Number(value.totalGames || 0),
        statsRows: Number(value.statsRows || 0),
        avgShots,
        avgShotsAgainst,
        avgShotsOn,
        avgShotsOnAgainst,
        avgCorners,
        avgCornersAgainst,
        yellowCardRate: Number((Number(value.yellowCards || 0) / games).toFixed(2)),
        redCardRate: Number((Number(value.redCards || 0) / games).toFixed(2)),
        cleanSheetRate: Number((Number(value.cleanSheets || 0) / games).toFixed(2)),
        failToScoreRate: Number((Number(value.failedToScore || 0) / games).toFixed(2)),
        bttsRate: Number((Number(value.bttsMatches || 0) / games).toFixed(2)),
        over25Rate: Number((Number(value.over25Matches || 0) / games).toFixed(2)),
        dominanceScore,
      },
      recentMatches: (value.recentMatches || [])
        .filter((item) => item?.score)
        .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")))
        .slice(-TEAM_RECENT_MATCH_WINDOW),
      bookmakers: Object.fromEntries(
        Object.entries(value.bookmakers || {}).map(([bookKey, bookValue]) => {
          const bookHomeActualPpg = bookValue.homeGames ? bookValue.homeActualPoints / bookValue.homeGames : 0;
          const bookAwayActualPpg = bookValue.awayGames ? bookValue.awayActualPoints / bookValue.awayGames : 0;
          const bookHomeImpliedPpg = bookValue.homeGames ? bookValue.homeImpliedPoints / bookValue.homeGames : 0;
          const bookAwayImpliedPpg = bookValue.awayGames ? bookValue.awayImpliedPoints / bookValue.awayGames : 0;
          const totalBookRows = Number(bookValue.closingRows || 0) + Number(bookValue.fallbackRows || 0);
          return [
            bookKey,
            {
              bookmaker: bookValue.bookmaker,
              homeGames: Number(bookValue.homeGames || 0),
              awayGames: Number(bookValue.awayGames || 0),
              homeActualPpg: Number(bookHomeActualPpg.toFixed(2)),
              awayActualPpg: Number(bookAwayActualPpg.toFixed(2)),
              homeImpliedPpg: Number(bookHomeImpliedPpg.toFixed(2)),
              awayImpliedPpg: Number(bookAwayImpliedPpg.toFixed(2)),
              homeOverperformance: Number((bookHomeActualPpg - bookHomeImpliedPpg).toFixed(2)),
              awayOverperformance: Number((bookAwayActualPpg - bookAwayImpliedPpg).toFixed(2)),
              closingCoverage: totalBookRows ? Number((Number(bookValue.closingRows || 0) / totalBookRows).toFixed(2)) : 0,
            },
          ];
        })
      ),
    };
  }

  const formattedReferees = {};
  for (const [key, value] of Object.entries(referees)) {
    const matches = Math.max(Number(value.matches || 0), 1);
    const avgCards = Number((Number(value.totalCards || 0) / matches).toFixed(2));
    const redRate = Number((Number(value.redCards || 0) / matches).toFixed(2));
    const penaltyRate =
      Number(value.penaltyMatches || 0) > 0
        ? Number((Number(value.penaltyEvents || 0) / Number(value.penaltyMatches || 1)).toFixed(2))
        : null;
    formattedReferees[key] = {
      refereeName: value.refereeName,
      matches: Number(value.matches || 0),
      avgCards,
      redRate,
      penaltyRate,
      aliases: buildRefereeAliasVariants(value.refereeName),
      summary: `${value.refereeName}: ${avgCards} kaarten gem. over ${value.matches} duels`,
    };
    for (const alias of buildRefereeAliasVariants(value.refereeName)) {
      if (!refereeAliases[alias]) refereeAliases[alias] = key;
    }
  }

  return {
    updatedAt: Date.now(),
    sampleSize: rows.length,
    leagueMeta: {
      validRows,
      closingRows,
      fallbackRows,
      closingCoverage: validRows ? Number((closingRows / validRows).toFixed(2)) : 0,
    },
    teams: formattedTeams,
    referees: formattedReferees,
    refereeAliases,
    h2hPairs: Object.fromEntries(
      Object.entries(h2hPairs).map(([key, values]) => [key, values.sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || ""))).slice(-12)])
    ),
  };
}

async function fetchHistoricalMarketProfile(leagueLabel, dateISO) {
  const codes = getMarketLeagueFamilyCodes(leagueLabel);
  if (!codes.length) return null;

  const seasonFolders = getSeasonFolders(dateISO, 5);
  const allRows = [];
  for (const seasonFolder of seasonFolders) {
    for (const code of codes) {
      const url = `https://www.football-data.co.uk/mmz4281/${seasonFolder}/${code}.csv`;
      const csvText = await fetchText(url);
      if (!csvText) continue;
      const rows = parseCsv(csvText);
      if (rows.length) allRows.push(...rows);
    }
  }
  if (!allRows.length) return null;
  return buildMarketProfiles(allRows);
}

function buildH2HProfileFromResults(results, source) {
  const h2hPairs = {};
  const teams = {};
  for (const item of results || []) {
    const home = String(item.home || "").trim();
    const away = String(item.away || "").trim();
    const homeGoals = toNumber(item.homeGoals);
    const awayGoals = toNumber(item.awayGoals);
    if (!home || !away || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
    const pairKey = buildPairKey(home, away);
    if (!h2hPairs[pairKey]) h2hPairs[pairKey] = [];
    const homeKey = normalizeName(home);
    const awayKey = normalizeName(away);
    const winnerId = homeGoals > awayGoals ? normalizeName(home) : awayGoals > homeGoals ? normalizeName(away) : "";
    h2hPairs[pairKey].push({
      date: item.date || null,
      home,
      away,
      homeTeamId: "",
      awayTeamId: "",
      score: `${homeGoals}-${awayGoals}`,
      winnerId,
      source,
    });

    if (!teams[homeKey]) teams[homeKey] = { teamName: home, recentMatches: [] };
    if (!teams[awayKey]) teams[awayKey] = { teamName: away, recentMatches: [] };
    teams[homeKey].recentMatches.push({
      date: item.date || null,
      league: item.league || null,
      venue: "H",
      opponent: away,
      opponentId: "",
      score: `${homeGoals}-${awayGoals}`,
      goalsFor: homeGoals,
      goalsAgainst: awayGoals,
      result: homeGoals > awayGoals ? "W" : homeGoals === awayGoals ? "D" : "L",
      source,
    });
    teams[awayKey].recentMatches.push({
      date: item.date || null,
      league: item.league || null,
      venue: "A",
      opponent: home,
      opponentId: "",
      score: `${awayGoals}-${homeGoals}`,
      goalsFor: awayGoals,
      goalsAgainst: homeGoals,
      result: awayGoals > homeGoals ? "W" : awayGoals === homeGoals ? "D" : "L",
      source,
    });
  }

  return {
    updatedAt: Date.now(),
    source,
    sampleSize: results.length,
    teams: Object.fromEntries(
      Object.entries(teams).map(([key, value]) => [
        key,
        {
          teamName: value.teamName,
          recentMatches: value.recentMatches
            .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")))
            .slice(-TEAM_RECENT_MATCH_WINDOW),
        },
      ])
    ),
    h2hPairs: Object.fromEntries(
      Object.entries(h2hPairs).map(([key, values]) => [
        key,
        values.sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || ""))).slice(-16),
      ])
    ),
  };
}

async function fetchOpenfootballProfile(leagueLabel, dateISO) {
  const competitionCode = OPENFOOTBALL_COMPETITIONS[leagueLabel];
  if (!competitionCode) return null;

  const results = [];
  for (const seasonTag of getOpenfootballSeasonTags(dateISO, 3)) {
    const url = `https://raw.githubusercontent.com/openfootball/football.json/master/${seasonTag}/${competitionCode}.json`;
    const json = await fetchExternalJson(url);
    const matches = Array.isArray(json?.matches) ? json.matches : [];
    for (const match of matches) {
      const ft = match?.score?.ft;
      if (!Array.isArray(ft) || ft.length < 2) continue;
      const homeGoals = toNumber(ft[0]);
      const awayGoals = toNumber(ft[1]);
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
  return buildH2HProfileFromResults(results, "openfootball");
}

function getUnderstatSeason(dateISO) {
  const base = dateISO ? new Date(dateISO) : new Date();
  const amsterdamString = base.toLocaleString("en-US", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "numeric",
  });
  const [monthStr, yearStr] = amsterdamString.split('/');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  return String(month >= 6 ? year : year - 1);
}

function average(values) {
  const clean = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  return Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(2));
}

async function fetchUnderstatSnapshot(leagueLabel, dateISO) {
  const code = UNDERSTAT_LEAGUE_CODES[leagueLabel];
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
    teams[normalizeName(name)] = {
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

function getFbrefSnapshotUrls(leagueLabel) {
  const info = FBREF_RELEASE_CODES[leagueLabel];
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

async function fetchFbrefSnapshot(leagueLabel, dateISO) {
  const urls = getFbrefSnapshotUrls(leagueLabel);
  if (!urls.length) return null;

  const currentFolder = getSeasonFolder(dateISO);
  const currentEndYear = 2000 + Number(currentFolder.slice(2));
  const teams = {};
  let sampleSize = 0;
  let sourceType = null;

  for (const item of urls) {
    const csvText = await fetchText(item.url);
    if (!csvText) continue;
    const rows = parseCsv(csvText);
    if (!rows.length) continue;
    sourceType = item.type;
    const seenShotMatches = new Set();

    for (const row of rows) {
      const seasonEnd = Number(row.Season_End_Year || row.season_end_year || 0);
      if (seasonEnd && seasonEnd < currentEndYear - 2) continue;
      if (String(row.Gender || "M") !== "M") continue;
      const teamName = String(row.Team || row.Squad || "").trim();
      if (!teamName) continue;
      const key = normalizeName(teamName);
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
        const shots = Number(toNumber(row.Sh) || 0);
        const shotsOn = Number(toNumber(row.SoT) || 0);
        const xG = Number(toNumber(row.xG_Expected || row.Home_xG || row.Away_xG) || 0);
        const npxG = Number(toNumber(row.npxG_Expected) || xG || 0);
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
        const xG = Number(toNumber(row.xG) || 0);
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

function lookupSnapshotTeam(snapshot, teamName) {
  const teams = snapshot?.teams || {};
  for (const variant of buildPossibleNames(teamName)) {
    if (teams[variant]) return teams[variant];
  }
  return null;
}

function mergeSeasonStatsWithSnapshots(baseStats, teamName, leagueLabel, store) {
  const understat = lookupSnapshotTeam(store.understatSnapshots?.[leagueLabel], teamName);
  const fbref = lookupSnapshotTeam(store.fbrefSnapshots?.[leagueLabel], teamName);
  const marketTeam = lookupMarketTeamProfile(store.marketProfiles?.[leagueLabel], teamName);
  const historicalStats = marketTeam?.historicalStats || null;
  const externalSources = [];
  const merged = { ...(baseStats || {}) };

  if (historicalStats && Number(historicalStats.statsRows || 0) >= 8) {
    externalSources.push("football-data-history");
    merged.avgShots = merged.avgShots ?? historicalStats.avgShots ?? null;
    merged.avgShotsAgainst = merged.avgShotsAgainst ?? historicalStats.avgShotsAgainst ?? null;
    merged.avgShotsOn = merged.avgShotsOn ?? historicalStats.avgShotsOn ?? null;
    merged.avgShotsOnAgainst = merged.avgShotsOnAgainst ?? historicalStats.avgShotsOnAgainst ?? null;
    merged.avgCorners = merged.avgCorners ?? historicalStats.avgCorners ?? null;
    merged.avgCornersAgainst = merged.avgCornersAgainst ?? historicalStats.avgCornersAgainst ?? null;
    merged.cleanSheetRate = merged.cleanSheetRate ?? historicalStats.cleanSheetRate ?? null;
    merged.failToScoreRate = merged.failToScoreRate ?? historicalStats.failToScoreRate ?? null;
    merged.bttsRate = merged.bttsRate ?? historicalStats.bttsRate ?? null;
    merged.over25Rate = merged.over25Rate ?? historicalStats.over25Rate ?? null;
    merged.yellowCardRate = merged.yellowCardRate ?? historicalStats.yellowCardRate ?? null;
    merged.redCardRate = merged.redCardRate ?? historicalStats.redCardRate ?? null;
    merged.dominanceScore = merged.dominanceScore ?? historicalStats.dominanceScore ?? null;
    merged.historicalGames = historicalStats.games ?? merged.historicalGames ?? null;
  }

  if (understat) {
    externalSources.push("Understat");
    merged.xG = understat.avgXG ?? merged.xG ?? null;
    merged.xGAgainst = understat.avgXGA ?? merged.xGAgainst ?? null;
    merged.npxG = understat.avgNpxG ?? merged.npxG ?? null;
    merged.npxGAgainst = understat.avgNpxGA ?? merged.npxGAgainst ?? null;
    merged.homeXG = understat.homeXG ?? merged.homeXG ?? null;
    merged.awayXG = understat.awayXG ?? merged.awayXG ?? null;
    merged.homeXGA = understat.homeXGA ?? merged.homeXGA ?? null;
    merged.awayXGA = understat.awayXGA ?? merged.awayXGA ?? null;
    merged.ppda = understat.ppda ?? merged.ppda ?? null;
    merged.deep = understat.deep ?? merged.deep ?? null;
  }

  if (fbref) {
    externalSources.push("FBref");
    merged.avgShots = merged.avgShots ?? fbref.avgShots ?? null;
    merged.avgShotsOn = merged.avgShotsOn ?? fbref.avgShotsOn ?? null;
    merged.xG = merged.xG ?? fbref.avgXG ?? null;
    merged.npxG = merged.npxG ?? fbref.avgNpxG ?? null;
    merged.homeShots = fbref.homeShots ?? merged.homeShots ?? null;
    merged.awayShots = fbref.awayShots ?? merged.awayShots ?? null;
    merged.homeXG = merged.homeXG ?? fbref.homeXG ?? null;
    merged.awayXG = merged.awayXG ?? fbref.awayXG ?? null;
  }

  if (externalSources.length) {
    merged.externalSources = Array.from(new Set([...(merged.externalSources || []), ...externalSources]));
    merged.sourceQuality = Number(Math.min(1, 0.42 + merged.externalSources.length * 0.18 + Math.min(Number(merged.historicalGames || 0) / 120, 1) * 0.12).toFixed(2));
  }

  return Object.keys(merged).length ? merged : null;
}

function lookupHistoricalH2HBackfill(leagueMarketProfile, homeName, awayName, currentHomeId, currentAwayId) {
  const pairs = leagueMarketProfile?.h2hPairs || {};
  const homeVariants = buildPossibleNames(homeName);
  const awayVariants = buildPossibleNames(awayName);
  let raw = [];
  for (const homeVariant of homeVariants) {
    for (const awayVariant of awayVariants) {
      const variantKey = buildPairKey(homeVariant, awayVariant);
      if (Array.isArray(pairs[variantKey]) && pairs[variantKey].length) {
        raw = pairs[variantKey];
        break;
      }
    }
    if (raw.length) break;
  }
  const homeWinnerId = String(currentHomeId || normalizeName(homeName));
  const awayWinnerId = String(currentAwayId || normalizeName(awayName));
  const results = raw
    .map((item) => ({
      ...item,
      homeTeamId: item.homeTeamId || "",
      awayTeamId: item.awayTeamId || "",
      winnerId:
        homeVariants.includes(String(item.winnerId || ""))
          ? homeWinnerId
          : awayVariants.includes(String(item.winnerId || ""))
            ? awayWinnerId
            : "",
    }))
    .slice(-5);

  if (!results.length) return null;

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  for (const result of results) {
    if (!result.winnerId) draws += 1;
    else if (String(result.winnerId) === String(currentHomeId || "")) homeWins += 1;
    else if (String(result.winnerId) === String(currentAwayId || "")) awayWins += 1;
  }

  return {
    played: results.length,
    homeWins,
    draws,
    awayWins,
    sameCompetitionPlayed: results.length,
    weightedRecentBalance: calculateRecentH2HBalance({ results }, currentHomeId, currentAwayId),
    results,
    status: leagueMarketProfile?.source === "openfootball" ? "openfootball-historical" : "historical-competition",
  };
}

function lookupMarketTeamProfile(leagueMarketProfile, teamName) {
  const teams = leagueMarketProfile?.teams || {};
  for (const variant of buildPossibleNames(teamName)) {
    if (teams[variant]) return teams[variant];
  }
  return null;
}

function lookupHistoricalRefereeProfile(leagueMarketProfile, refereeName, globalArchive = null) {
  if (!refereeName) return null;
  const referees = leagueMarketProfile?.referees || {};
  const aliasMap = leagueMarketProfile?.refereeAliases || {};
  const globalReferees = globalArchive?.referees || {};
  const globalAliasMap = globalArchive?.refereeAliases || {};
  const normalizedRef = normalizeName(refereeName);
  const aliasHit = aliasMap[normalizedRef];
  if (aliasHit && referees[aliasHit]) return referees[aliasHit];
  const direct = referees[normalizedRef];
  if (direct) return direct;
  const globalAliasHit = globalAliasMap[normalizedRef];
  if (globalAliasHit && globalReferees[globalAliasHit]) return globalReferees[globalAliasHit];
  if (globalReferees[normalizedRef]) return globalReferees[normalizedRef];
  const aliases = buildRefereeAliasVariants(refereeName);
  for (const alias of aliases) {
    const aliasKey = aliasMap[alias];
    if (aliasKey && referees[aliasKey]) return referees[aliasKey];
    const globalKey = globalAliasMap[alias];
    if (globalKey && globalReferees[globalKey]) return globalReferees[globalKey];
  }
  const surname = normalizedRef.split(" ").filter(Boolean).slice(-1)[0] || normalizedRef;
  return (
    [...Object.values(referees), ...Object.values(globalReferees)].find((entry) => {
      const candidate = normalizeName(entry?.refereeName || "");
      if (candidate === normalizedRef) return true;
      if (!surname) return false;
      const candidateAliases = Array.isArray(entry?.aliases) ? entry.aliases : buildRefereeAliasVariants(entry?.refereeName || "");
      const candidateSurname = candidate.split(" ").filter(Boolean).slice(-1)[0] || candidate;
      return (
        candidate.includes(normalizedRef) ||
        normalizedRef.includes(candidate) ||
        candidateSurname === surname ||
        candidateAliases.some((alias) => aliases.includes(alias))
      );
    }) || null
  );
}

function flattenOddsContainers(node, bucket = []) {
  if (!node) return bucket;
  if (Array.isArray(node)) {
    for (const item of node) flattenOddsContainers(item, bucket);
    return bucket;
  }
  if (typeof node !== "object") return bucket;

  const maybeHome = Number(node.home || node.homeOdds || node.homeValue || node.oddsHome || node.choice1?.value || 0);
  const maybeDraw = Number(node.draw || node.drawOdds || node.drawValue || node.oddsDraw || node.choiceX?.value || 0);
  const maybeAway = Number(node.away || node.awayOdds || node.awayValue || node.oddsAway || node.choice2?.value || 0);
  const bookmaker =
    node.bookmaker?.name ||
    node.bookmakerName ||
    node.provider ||
    node.name ||
    node.marketName ||
    "";

  if (maybeHome > 1.01 && maybeDraw > 1.01 && maybeAway > 1.01) {
    bucket.push({
      bookmaker: String(bookmaker || "Sofascore"),
      home: maybeHome,
      draw: maybeDraw,
      away: maybeAway,
    });
  }

  for (const value of Object.values(node)) flattenOddsContainers(value, bucket);
  return bucket;
}

async function fetchEventBookmakerOdds(eventId) {
  const urls = [
    `${SOFA}/event/${eventId}/odds/1/all`,
    `${SOFA}/event/${eventId}/odds/1`,
    `${SOFA}/event/${eventId}/odds`,
  ];

  for (const url of urls) {
    const json = await safeFetch(url);
    const rows = flattenOddsContainers(json, []);
    if (!rows.length) continue;

    const byBook = {};
    for (const row of rows) {
      const key = normalizeName(row.bookmaker);
      if (!key || byBook[key]) continue;
      byBook[key] = row;
    }

    const signals = Object.values(byBook).slice(0, 8).map((row) => {
      const implied = normalizeProbabilities(1 / row.home, 1 / row.draw, 1 / row.away);
      const lean = implied.home >= implied.away && implied.home >= implied.draw ? "home" : implied.away >= implied.draw ? "away" : "neutral";
      return {
        key: normalizeName(row.bookmaker),
        bookmaker: row.bookmaker,
        diff: Number((implied.home - implied.away).toFixed(2)),
        strength: Number((Math.max(implied.home, implied.draw, implied.away) * 0.9).toFixed(2)),
        closingCoverage: 1,
        lean,
        source: "sofascore-odds",
      };
    });

    return {
      source: "Sofascore current odds",
      bookmakerSignals: signals,
      bookmakerAgreement:
        signals.length > 0
          ? Number((signals.filter((item) => item.lean === "home" || item.lean === "away").length / signals.length).toFixed(2))
          : 0,
      closingCoverage: signals.length > 0 ? 1 : 0,
    };
  }

  return null;
}

async function fetchTransfermarktNationalTeamAvailability(teamName) {
  const query = encodeURIComponent(teamName);
  const searchUrl = `https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query=${query}`;
  const searchText = await safeFetchText(searchUrl);
  if (!searchText) return null;

  const teamPattern = /href="\/([^"/]+)\/startseite\/verein\/(\d+)"[^>]*>([^<]+)</gi;
  let match = null;
  let candidate = null;
  const normalizedQuery = normalizeName(teamName);
  while ((match = teamPattern.exec(searchText))) {
    const name = String(match[3] || "").trim();
    const normalizedName = normalizeName(name);
    if (!normalizedName) continue;
    if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) {
      candidate = { slug: match[1], id: match[2], name };
      break;
    }
  }
  if (!candidate) return null;

  const availabilityUrl = `https://www.transfermarkt.com/${candidate.slug}/sperrenundverletzungen/verein/${candidate.id}`;
  const html = await safeFetchText(availabilityUrl);
  if (!html) return null;

  const names = [...html.matchAll(/spielerprofil[^>]*>([^<]+)</gi)].map((item) => String(item[1] || "").trim()).filter(Boolean);
  const suspensionHits = [...html.matchAll(/sperre|suspended|suspension/gi)].length;
  const injuryHits = [...html.matchAll(/verletz|injur|knock|muscular|ankle|illness/gi)].length;
  const doubtHits = [...html.matchAll(/fraglich|doubt|questionable/gi)].length;

  if (!injuryHits && !suspensionHits && !doubtHits) return null;

  return {
    injuredCount: Math.min(injuryHits, Math.max(names.length, injuryHits)),
    suspendedCount: suspensionHits,
    doubtsCount: doubtHits,
    source: "Transfermarkt availability",
    keyPlayersMissing: names.slice(0, 4),
    suspendedPlayers: names.slice(0, Math.min(3, suspensionHits || 0)),
  };
}

function mergeAvailability(baseAvailability, extraAvailability) {
  if (!extraAvailability) return baseAvailability;
  return {
    ...baseAvailability,
    injuredCount: Math.max(Number(baseAvailability?.injuredCount || 0), Number(extraAvailability?.injuredCount || 0)),
    suspendedCount: Math.max(Number(baseAvailability?.suspendedCount || 0), Number(extraAvailability?.suspendedCount || 0)),
    doubtsCount: Math.max(Number(baseAvailability?.doubtsCount || 0), Number(extraAvailability?.doubtsCount || 0)),
    injuredRating: Number(baseAvailability?.injuredRating || 0),
    keyPlayersMissing: [...new Set([...(baseAvailability?.keyPlayersMissing || []), ...(extraAvailability?.keyPlayersMissing || [])])].slice(0, 5),
    suspendedPlayers: [...new Set([...(baseAvailability?.suspendedPlayers || []), ...(extraAvailability?.suspendedPlayers || [])])].slice(0, 4),
    source: extraAvailability?.source || baseAvailability?.source || "Sofascore players",
  };
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
    dataSource: match.dataSource || prediction?.dataSource || "sofascore",
    phaseBucket: getReliabilityBucket(match),
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
    exactScoreConfidence: Number(prediction.exactScoreConfidence || prediction.exactProb || 0),
    outcomeHit: predictedOutcome === actualOutcome,
    probabilityOutcomeHit: probabilityOutcome === actualOutcome,
    exactHit: predHomeGoals === actualHomeGoals && predAwayGoals === actualAwayGoals,
    totalGoalError,
    totalGoalBias,
    homeGoalBias: Number((actualHomeGoals - predHomeGoals).toFixed(2)),
    awayGoalBias: Number((actualAwayGoals - predAwayGoals).toFixed(2)),
    bestBetRank: Number(prediction?.bestBetRank || 0) || null,
    topConfidencePick: Number(prediction?.bestBetRank || 0) > 0 && Number(prediction?.bestBetRank || 0) <= 5,
    topExactScorePick: Number(prediction?.bestBetRank || 0) > 0 && Number(prediction?.bestBetRank || 0) <= 5,
    topExactReasons: prediction?.exactScoreReasons || [],
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
  const reviews = { ...(store.postMatchReviews || {}) };

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
  store.phaseReliability = buildPhaseReliabilityFromReviews(reviews);
  store.featureDiagnostics = buildFeatureDiagnosticsFromReviews(reviews);
}

function buildExactScoreTipScore(prediction, match) {
  const exactProb = Number(prediction?.exactProb || 0);
  const confidence = Number(prediction?.confidence || 0);
  const modelAgreement = Number(prediction?.modelEdges?.modelAgreement || 0);
  const leagueReliability = prediction?.modelEdges?.leagueReliability || match?.competitionReliability || null;
  const phaseReliability = prediction?.modelEdges?.phaseReliability || match?.phaseReliability || null;
  const sourceQuality = Math.max(
    Number(match?.homeSeasonStats?.sourceQuality || 0),
    Number(match?.awaySeasonStats?.sourceQuality || 0),
    Number(prediction?.modelEdges?.marketCalibration?.closingCoverage || 0)
  );
  const lineupBonus = prediction?.lineupSummary?.confirmed || match?.lineupSummary?.confirmed ? 0.025 : 0;
  const h2hBonus = Number(match?.h2h?.played || prediction?.h2h?.played || 0) >= 3 ? 0.018 : 0;
  const reliabilityBonus = clamp(
    (Number(leagueReliability?.reliabilityScore || 0) +
      Number(phaseReliability?.reliabilityScore || 0)) / 2,
    0,
    1
  ) * 0.045;
  const exactReliability = clamp(
    (Number(leagueReliability?.exactHitRate || 0) + Number(phaseReliability?.exactHitRate || 0)) / 2,
    0,
    1
  );
  const exactReliabilityBonus = clamp((exactReliability - 0.12) * 0.24, -0.025, 0.05);
  const avgGoalError = Number(
    (
      (Number(leagueReliability?.avgGoalError || 0) + Number(phaseReliability?.avgGoalError || 0)) /
      ((leagueReliability?.avgGoalError != null ? 1 : 0) + (phaseReliability?.avgGoalError != null ? 1 : 0) || 1)
    ).toFixed(2)
  );
  const goalErrorPenalty = clamp((avgGoalError - 1.45) * 0.038, 0, 0.085);
  const learningEdge = prediction?.modelEdges?.learningEdge || match?.learningSummary || null;
  const learningGames = Number(learningEdge?.totalReviewedMatches || 0);
  const learningReliability = Number(learningEdge?.combinedReliability || 0);
  const learningBonus = learningGames >= 8 ? clamp((learningReliability - 0.48) * 0.12, -0.025, 0.035) : 0;
  const marketCoverage = Number(prediction?.modelEdges?.marketCalibration?.closingCoverage || 0);
  const marketBonus = marketCoverage >= 0.45 ? 0.026 : marketCoverage >= 0.18 ? 0.01 : marketCoverage <= 0.05 ? -0.02 : 0;
  const scoreSelectionReason = String(prediction?.modelEdges?.scoreSelection?.reason || "");
  const adjustedScoreBonus = scoreSelectionReason.includes("aangepast") ? 0.012 : 0;
  const riskPenalty = prediction?.modelEdges?.riskProfile === "high" ? 0.065 : prediction?.modelEdges?.riskProfile === "medium" ? 0.03 : 0;
  const agreementPenalty = modelAgreement < 0.42 ? 0.07 : modelAgreement < 0.55 ? 0.038 : 0;
  const score = clamp(
    exactProb * 2.85 +
      confidence * 0.1 +
      modelAgreement * 0.24 +
      sourceQuality * 0.17 +
      lineupBonus +
      h2hBonus +
      reliabilityBonus +
      exactReliabilityBonus +
      learningBonus +
      marketBonus +
      adjustedScoreBonus -
      riskPenalty -
      agreementPenalty -
      goalErrorPenalty,
    0,
    0.99
  );
  const reasons = [];
  if (exactProb >= 0.12) reasons.push("sterke exacte-score kans");
  if (modelAgreement >= 0.68) reasons.push("modellen eensgezind");
  if (sourceQuality >= 0.55) reasons.push("rijke brondata");
  if (sourceQuality < 0.3) reasons.push("brondata dun meegewogen");
  if (lineupBonus) reasons.push("opstellingen bevestigd");
  if (h2hBonus) reasons.push("H2H gevuld");
  if (reliabilityBonus >= 0.025) reasons.push("competitie/fase betrouwbaar");
  if (exactReliabilityBonus >= 0.015) reasons.push("exact-score historie sterk");
  if (learningBonus >= 0.015) reasons.push("leerdata positief");
  if (marketBonus > 0) reasons.push("marktdekking sterk");
  if (adjustedScoreBonus) reasons.push("scoreselectie bijgestuurd");
  if (riskPenalty) reasons.push("risico meegewogen");
  if (agreementPenalty) reasons.push("modeltwijfel afgestraft");
  if (goalErrorPenalty) reasons.push("historische foutmarge meegewogen");
  return {
    score: Number(score.toFixed(3)),
    reasons: reasons.slice(0, 4),
  };
}

function assignTopConfidenceRanks(dayMatches, dayPredictions) {
  const matchMap = new Map((dayMatches || []).map((match) => [match.id, match]));
  const ranked = [...(dayPredictions || [])]
    .map((prediction) => {
      const match = matchMap.get(prediction.matchId);
      const exactScoreTip = buildExactScoreTipScore(prediction, match);
      prediction.exactScoreConfidence = exactScoreTip.score;
      prediction.exactScoreReasons = exactScoreTip.reasons;
      return {
        matchId: prediction.matchId,
        exactScoreConfidence: exactScoreTip.score,
      };
    })
    .sort((a, b) => b.exactScoreConfidence - a.exactScoreConfidence)
    .slice(0, 5);

  const rankMap = new Map(ranked.map((item, index) => [item.matchId, index + 1]));

  for (const prediction of dayPredictions || []) {
    const rank = rankMap.get(prediction.matchId) || null;
    prediction.bestBetRank = rank;
    prediction.topConfidencePick = rank != null;
    prediction.topExactScorePick = rank != null;
  }

  for (const match of dayMatches || []) {
    const prediction = (dayPredictions || []).find((item) => item.matchId === match.id);
    const rank = rankMap.get(match.id) || null;
    match.bestBetRank = rank;
    match.topConfidencePick = rank != null;
    match.topExactScorePick = rank != null;
    if (prediction?.exactScoreConfidence != null) match.exactScoreConfidence = prediction.exactScoreConfidence;
    if (prediction?.exactScoreReasons) match.exactScoreReasons = prediction.exactScoreReasons;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
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

async function safeFetch(url) {
  const isSofaRequest = String(url || "").startsWith(SOFA);
  if (isSofaRequest && sofaFetchCircuit.blocked) {
    return null;
  }
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: "https://www.sofascore.com",
        Referer: "https://www.sofascore.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
      },
    }, 12000);
    if (!response.ok) {
      if (isSofaRequest && response.status === 403) {
        sofaFetchCircuit.failures += 1;
        sofaFetchCircuit.blocked = true;
        if (!sofaFetchCircuit.logged) {
          console.error("[worker] Sofascore geeft 403; deze run gebruikt automatisch de gratis fallbackbronnen.");
          sofaFetchCircuit.logged = true;
        }
        return null;
      }
      console.error(`[worker] API error ${response.status} voor ${url}`);
      return null;
    }
    return await response.json();
  } catch (err) {
    console.error(`[worker] Fetch error voor ${url}: ${err?.message || err}`);
    return null;
  }
}

async function safeFetchText(url) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "text/plain,text/csv,*/*",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/53736",
      },
    }, 12000);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchExternalJson(url, headers = {}) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json,text/javascript,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/53736",
        ...headers,
      },
    }, 12000);
    if (!response.ok) return null;
    return await response.json();
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

function emptyStandingTeam(teamName, teamId = "") {
  return {
    team: teamName,
    teamId: String(teamId || ""),
    p: 0,
    w: 0,
    d: 0,
    l: 0,
    gf: 0,
    ga: 0,
    pts: 0,
  };
}

function buildStandingResultTeamKey(teamName) {
  const variants = buildPossibleNames(teamName)
    .map(normalizeName)
    .filter(Boolean)
    .filter((name) => !UNSAFE_LOGO_KEYS.has(name))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  return variants[0] || canonicalTeamName(teamName);
}

function buildStandingResultKey(date, home, away) {
  return `${date || ""}|${buildStandingResultTeamKey(home)}|${buildStandingResultTeamKey(away)}`;
}

function sortStandingRows(rows) {
  return [...(rows || [])]
    .sort((a, b) => {
      const aGd = Number(a.gf || 0) - Number(a.ga || 0);
      const bGd = Number(b.gf || 0) - Number(b.ga || 0);
      return (
        Number(b.pts || 0) - Number(a.pts || 0) ||
        bGd - aGd ||
        Number(b.gf || 0) - Number(a.gf || 0) ||
        String(a.team || "").localeCompare(String(b.team || ""))
      );
    })
    .map((row, index) => ({ ...row, pos: index + 1 }));
}

function findStandingRowIndex(rows, teamName, teamId = "") {
  if (!Array.isArray(rows)) return -1;
  if (teamId) {
    const byId = rows.findIndex((row) => String(row.teamId || "") === String(teamId || ""));
    if (byId >= 0) return byId;
  }
  const variants = buildPossibleNames(teamName);
  return rows.findIndex((row) => buildPossibleNames(row.team).some((name) => variants.includes(name)));
}

function ensureStandingRow(rows, teamName, teamId = "") {
  const index = findStandingRowIndex(rows, teamName, teamId);
  if (index >= 0) return rows[index];
  const next = emptyStandingTeam(teamName, teamId);
  rows.push(next);
  return next;
}

function applyResultToStandingRows(rows, item, options = {}) {
  const home = String(item.home || item.homeTeamName || "").trim();
  const away = String(item.away || item.awayTeamName || "").trim();
  const homeGoals = toNumber(item.homeGoals);
  const awayGoals = toNumber(item.awayGoals);
  if (!home || !away || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return false;

  if (options.requireKnownTeams) {
    const homeIndex = findStandingRowIndex(rows, home, item.homeTeamId || "");
    const awayIndex = findStandingRowIndex(rows, away, item.awayTeamId || "");
    if (homeIndex < 0 || awayIndex < 0) return false;
  }

  const homeRow = ensureStandingRow(rows, home, item.homeTeamId || "");
  const awayRow = ensureStandingRow(rows, away, item.awayTeamId || "");

  homeRow.p += 1;
  awayRow.p += 1;
  homeRow.gf += homeGoals;
  homeRow.ga += awayGoals;
  awayRow.gf += awayGoals;
  awayRow.ga += homeGoals;

  if (homeGoals > awayGoals) {
    homeRow.w += 1;
    homeRow.pts += 3;
    awayRow.l += 1;
  } else if (awayGoals > homeGoals) {
    awayRow.w += 1;
    awayRow.pts += 3;
    homeRow.l += 1;
  } else {
    homeRow.d += 1;
    awayRow.d += 1;
    homeRow.pts += 1;
    awayRow.pts += 1;
  }
  return true;
}

function buildStandingFromResultRows(label, results, source) {
  const table = new Map();
  const resultKeys = new Set();
  let lastResultDate = null;
  for (const item of results || []) {
    const home = String(item.home || "").trim();
    const away = String(item.away || "").trim();
    const homeGoals = toNumber(item.homeGoals);
    const awayGoals = toNumber(item.awayGoals);
    if (!home || !away || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;

    const homeKey = canonicalTeamName(home);
    const awayKey = canonicalTeamName(away);
    if (!homeKey || !awayKey) continue;
    const homeRow = table.get(homeKey) || emptyStandingTeam(home, item.homeTeamId || "");
    const awayRow = table.get(awayKey) || emptyStandingTeam(away, item.awayTeamId || "");

    homeRow.p += 1;
    awayRow.p += 1;
    homeRow.gf += homeGoals;
    homeRow.ga += awayGoals;
    awayRow.gf += awayGoals;
    awayRow.ga += homeGoals;

    if (homeGoals > awayGoals) {
      homeRow.w += 1;
      homeRow.pts += 3;
      awayRow.l += 1;
    } else if (awayGoals > homeGoals) {
      awayRow.w += 1;
      awayRow.pts += 3;
      homeRow.l += 1;
    } else {
      homeRow.d += 1;
      awayRow.d += 1;
      homeRow.pts += 1;
      awayRow.pts += 1;
    }

    table.set(homeKey, homeRow);
    table.set(awayKey, awayRow);
    resultKeys.add(buildStandingResultKey(item.date || "", home, away));
    if (item.date && (!lastResultDate || String(item.date) > String(lastResultDate))) lastResultDate = item.date;
  }

  const rows = sortStandingRows([...table.values()]);

  if (!rows.length) return null;
  return {
    label,
    rows,
    updated: Date.now(),
    source,
    sources: [{ source, rows: rows.length, totalPlayed: rows.reduce((sum, row) => sum + Number(row.p || 0), 0) }],
    meta: deriveStandingMeta(label, rows.length),
    resultKeys: [...resultKeys],
    lastResultDate,
  };
}

async function fetchFootballDataStandings(label, dateISO) {
  const marketCode = MARKET_LEAGUE_CODES[label];
  if (!marketCode) return null;
  const results = [];
  for (const seasonFolder of getSeasonFolders(dateISO, 2)) {
    const csvText = await fetchText(`https://www.football-data.co.uk/mmz4281/${seasonFolder}/${marketCode}.csv`);
    if (!csvText) continue;
    for (const row of parseCsv(csvText)) {
      const homeGoals = toNumber(row.FTHG);
      const awayGoals = toNumber(row.FTAG);
      if (!row.HomeTeam || !row.AwayTeam || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
      results.push({
        date: parseFootballDataDateKey(row.Date || row.date),
        home: row.HomeTeam,
        away: row.AwayTeam,
        homeGoals,
        awayGoals,
      });
    }
    if (results.length) break;
  }
  return buildStandingFromResultRows(label, results, "football-data.co.uk");
}

async function fetchOpenfootballStandings(label, dateISO) {
  const competitionCode = OPENFOOTBALL_COMPETITIONS[label];
  if (!competitionCode) return null;
  const results = [];
  for (const seasonTag of getOpenfootballSeasonTags(dateISO, 2)) {
    const json = await fetchExternalJson(`https://raw.githubusercontent.com/openfootball/football.json/master/${seasonTag}/${competitionCode}.json`);
    const matches = Array.isArray(json?.matches) ? json.matches : [];
    for (const match of matches) {
      const ft = match?.score?.ft;
      if (!Array.isArray(ft) || ft.length < 2) continue;
      const homeGoals = toNumber(ft[0]);
      const awayGoals = toNumber(ft[1]);
      if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
      results.push({
        date: match.date || null,
        home: match.team1 || match.homeTeam || "",
        away: match.team2 || match.awayTeam || "",
        homeGoals,
        awayGoals,
      });
    }
    if (results.length) break;
  }
  return buildStandingFromResultRows(label, results, "openfootball");
}

function standingStrength(standing) {
  if (!standing?.rows?.length) return 0;
  return standing.rows.reduce((sum, row) => sum + Number(row.p || 0), 0) + standing.rows.length * 0.1;
}

function mergeStandingCandidates(label, candidates) {
  const valid = candidates.filter((item) => item?.rows?.length);
  if (!valid.length) return null;
  const best = valid.sort((a, b) => standingStrength(b) - standingStrength(a))[0];
  const sources = valid.map((item) => ({
    source: item.source || "sofascore",
    rows: item.rows.length,
    totalPlayed: item.rows.reduce((sum, row) => sum + Number(row.p || 0), 0),
  }));
  return {
    ...best,
    label,
    source: best.source || "sofascore",
    sources,
    updated: Date.now(),
    meta: deriveStandingMeta(label, best.rows.length),
    resultKeys: Array.isArray(best.resultKeys) ? best.resultKeys : [],
    lastResultDate: best.lastResultDate || null,
  };
}

function isStandingLeagueLabel(label) {
  const text = normalizeName(label);
  if (!text) return false;
  const excluded = [
    "champions league",
    "europa league",
    "conference league",
    "beker",
    "cup",
    "qualification",
    "qualificatie",
    "friendly",
    "vriendschapp",
    "nations league",
    "super cup",
  ];
  if (excluded.some((item) => text.includes(item))) return false;
  return true;
}

function parseScoreToGoals(score) {
  const match = String(score || "").match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  return { homeGoals: Number(match[1]), awayGoals: Number(match[2]) };
}

function shouldApplyMatchToStanding(match, baseStanding) {
  const status = String(match?.status || "").toUpperCase();
  if (!["FT", "LIVE", "HT", "RESULT_PENDING"].includes(status)) return false;
  if (!parseScoreToGoals(match?.score)) return false;
  if (status === "FT" && !Array.isArray(baseStanding?.resultKeys)) return true;
  return true;
}

function applyLiveMatchesToStanding(baseStanding, matches, label) {
  const rows = (baseStanding?.rows || []).map((row) => ({
    ...row,
    p: Number(row.p || 0),
    w: Number(row.w || 0),
    d: Number(row.d || 0),
    l: Number(row.l || 0),
    gf: Number(row.gf || 0),
    ga: Number(row.ga || 0),
    pts: Number(row.pts || 0),
  }));
  const resultKeys = new Set(Array.isArray(baseStanding?.resultKeys) ? baseStanding.resultKeys : []);
  let applied = 0;
  let liveApplied = 0;
  let lastResultDate = baseStanding?.lastResultDate || null;

  for (const match of matches || []) {
    if (String(match?.league || "") !== String(label || "")) continue;
    if (!shouldApplyMatchToStanding(match, baseStanding)) continue;
    const goals = parseScoreToGoals(match.score);
    if (!goals) continue;
    const resultKey = buildStandingResultKey(match.date || "", match.homeTeamName, match.awayTeamName);
    if (resultKeys.has(resultKey)) continue;

    const appliedResult = applyResultToStandingRows(rows, {
      date: match.date || "",
      home: match.homeTeamName,
      away: match.awayTeamName,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeGoals: goals.homeGoals,
      awayGoals: goals.awayGoals,
    }, { requireKnownTeams: (baseStanding?.rows || []).length >= 10 });
    if (!appliedResult) continue;

    resultKeys.add(resultKey);
    applied += 1;
    if (["LIVE", "HT"].includes(String(match.status || "").toUpperCase())) liveApplied += 1;
    if (match.date && (!lastResultDate || String(match.date) > String(lastResultDate))) lastResultDate = match.date;
  }

  if (!rows.length) return null;
  const sources = Array.isArray(baseStanding?.sources) ? [...baseStanding.sources] : [];
  if (applied > 0) {
    sources.push({
      source: "live-match-overlay",
      rows: rows.length,
      totalPlayed: applied,
      liveApplied,
    });
  }
  return {
    ...(baseStanding || {}),
    label,
    rows: sortStandingRows(rows),
    updated: Date.now(),
    source: applied > 0 ? `${baseStanding?.source || "stand"} + live-match-overlay` : baseStanding?.source || "stand",
    sources,
    meta: deriveStandingMeta(label, rows.length),
    resultKeys: [...resultKeys],
    lastResultDate,
    liveOverlay: {
      applied,
      liveApplied,
      updated: Date.now(),
    },
  };
}

function applyLiveStandingsOverlay(store) {
  const allMatches = Object.values(store.matches || {}).flat();
  const standingLabels = Object.values(store.standings || {})
    .map((standing) => standing?.label)
    .filter(Boolean);
  const matchLabels = allMatches.map((match) => match?.league).filter(Boolean);
  const labels = [...new Set([...standingLabels, ...matchLabels])].filter(isStandingLeagueLabel);

  for (const label of labels) {
    const labelKey = `label:${label}`;
    const sameLabelEntries = Object.entries(store.standings || {}).filter(([, standing]) => standing?.label === label);
    const base =
      store.standings[labelKey] ||
      sameLabelEntries
        .map(([, standing]) => standing)
        .sort((a, b) => standingStrength(b) - standingStrength(a))[0] ||
      {
        label,
        rows: [],
        updated: Date.now(),
        source: "live-match-overlay",
        sources: [],
        meta: deriveStandingMeta(label, 0),
        resultKeys: [],
      };
    const overlaid = applyLiveMatchesToStanding(base, allMatches, label);
    if (!overlaid) continue;
    store.standings[labelKey] = overlaid;
    for (const [key, standing] of sameLabelEntries) {
      if (standing?.rows?.length) store.standings[key] = overlaid;
    }
  }
}

async function fetchStandings(tournamentId, seasonId, label, dateISO) {
  const candidates = [];
  if (tournamentId && seasonId) {
    const json = await safeFetch(
      `${SOFA}/unique-tournament/${tournamentId}/season/${seasonId}/standings/total`
    );
    const rows = json?.standings?.[0]?.rows || [];
    if (rows.length) {
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
      candidates.push({
        label,
        rows: mapped,
        updated: Date.now(),
        source: "sofascore",
        sources: [{ source: "sofascore", rows: mapped.length, totalPlayed: mapped.reduce((sum, row) => sum + Number(row.p || 0), 0) }],
        meta: deriveStandingMeta(label, mapped.length),
      });
    }
  }

  const [footballDataStanding, openfootballStanding] = await Promise.all([
    fetchFootballDataStandings(label, dateISO),
    fetchOpenfootballStandings(label, dateISO),
  ]);
  if (footballDataStanding) candidates.push(footballDataStanding);
  if (openfootballStanding) candidates.push(openfootballStanding);
  return mergeStandingCandidates(label, candidates);
}

function findStandingRow(standing, teamId, teamName) {
  if (!standing?.rows?.length) return null;
  const byId = teamId ? standing.rows.find((row) => String(row.teamId || "") === String(teamId || "")) : null;
  if (byId) return byId;
  const variants = buildPossibleNames(teamName);
  return standing.rows.find((row) => buildPossibleNames(row.team).some((name) => variants.includes(name))) || null;
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

function buildEmptyTeamForm(source = "empty") {
  return {
    form: "",
    avgScored: 1.35,
    avgConceded: 1.35,
    bttsRate: 0.5,
    over15Rate: 0.5,
    over25Rate: 0.45,
    cleanSheetRate: 0.2,
    failToScoreRate: 0.25,
    yellowCardRate: 0,
    redCardRate: 0,
    gamesPlayed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    splits: { home: emptySplit(), away: emptySplit() },
    recentMatches: [],
    lastMatchKickoff: null,
    strongestSide: "balanced",
    source,
  };
}

function buildTeamFormFromRecentMatches(matches, source = "historical-form") {
  const sample = (matches || [])
    .filter((item) => item && Number.isFinite(toNumber(item.goalsFor)) && Number.isFinite(toNumber(item.goalsAgainst)))
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")))
    .slice(-TEAM_RECENT_MATCH_WINDOW)
    .map((item) => {
      const gf = Number(toNumber(item.goalsFor));
      const ga = Number(toNumber(item.goalsAgainst));
      return {
        date: item.date || null,
        eventId: item.eventId || null,
        league: item.league || null,
        tournamentId: item.tournamentId || null,
        seasonId: item.seasonId || null,
        venue: item.venue === "A" ? "A" : "H",
        opponent: item.opponent || "Opponent",
        opponentId: item.opponentId || "",
        score: item.score || `${gf}-${ga}`,
        goalsFor: gf,
        goalsAgainst: ga,
        result: gf > ga ? "W" : gf === ga ? "D" : "L",
        source: item.source || source,
      };
    });

  if (!sample.length) return buildEmptyTeamForm(source);

  let form = "";
  let scored = 0;
  let conceded = 0;
  let btts = 0;
  const splitState = {
    home: { games: 0, scored: 0, conceded: 0, btts: 0, over15: 0, over25: 0, cleanSheets: 0, failToScore: 0, wins: 0, draws: 0, losses: 0 },
    away: { games: 0, scored: 0, conceded: 0, btts: 0, over15: 0, over25: 0, cleanSheets: 0, failToScore: 0, wins: 0, draws: 0, losses: 0 },
  };

  for (const item of sample) {
    const gf = Number(item.goalsFor);
    const ga = Number(item.goalsAgainst);
    scored += gf;
    conceded += ga;
    if (gf > 0 && ga > 0) btts += 1;
    form += gf > ga ? "W" : gf === ga ? "D" : "L";

    const target = item.venue === "A" ? splitState.away : splitState.home;
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
  }

  const homeSplit = finalizeSplit(splitState.home);
  const awaySplit = finalizeSplit(splitState.away);
  let strongestSide = "balanced";
  if (homeSplit.avgScored > awaySplit.avgScored + 0.25) strongestSide = "home";
  if (awaySplit.avgScored > homeSplit.avgScored + 0.25) strongestSide = "away";

  return {
    form: form.slice(-TEAM_FORM_BADGE_WINDOW),
    avgScored: Number((scored / sample.length).toFixed(2)),
    avgConceded: Number((conceded / sample.length).toFixed(2)),
    bttsRate: Number((btts / sample.length).toFixed(2)),
    over15Rate: Number((sample.filter((item) => Number(item.goalsFor) + Number(item.goalsAgainst) > 1).length / sample.length).toFixed(2)),
    over25Rate: Number((sample.filter((item) => Number(item.goalsFor) + Number(item.goalsAgainst) > 2).length / sample.length).toFixed(2)),
    cleanSheetRate: Number((sample.filter((item) => Number(item.goalsAgainst) === 0).length / sample.length).toFixed(2)),
    failToScoreRate: Number((sample.filter((item) => Number(item.goalsFor) === 0).length / sample.length).toFixed(2)),
    yellowCardRate: 0,
    redCardRate: 0,
    gamesPlayed: sample.length,
    wins: (form.match(/W/g) || []).length,
    draws: (form.match(/D/g) || []).length,
    losses: (form.match(/L/g) || []).length,
    splits: { home: homeSplit, away: awaySplit },
    recentMatches: sample,
    lastMatchKickoff: sample[sample.length - 1]?.date ? `${sample[sample.length - 1].date}T00:00:00.000Z` : null,
    strongestSide,
    source,
  };
}

function collectHistoricalTeamMatches(teamName, profiles = []) {
  const matches = [];
  const seenProfiles = new Set();
  for (const profile of profiles || []) {
    if (!profile || seenProfiles.has(profile)) continue;
    seenProfiles.add(profile);
    const teamProfile = lookupMarketTeamProfile(profile, teamName);
    if (Array.isArray(teamProfile?.recentMatches)) matches.push(...teamProfile.recentMatches);
  }
  return matches;
}

function mergeTeamFormWithHistorical(currentForm, leagueMarketProfile, openFootballProfile, teamName, extraProfiles = []) {
  const currentMatches = Array.isArray(currentForm?.recentMatches) ? currentForm.recentMatches : [];
  if (currentMatches.length >= TEAM_RECENT_MATCH_WINDOW) return currentForm;

  const historicalMatches = [
    ...collectHistoricalTeamMatches(teamName, [leagueMarketProfile, openFootballProfile, ...extraProfiles]),
  ];
  if (!historicalMatches.length) return currentForm || buildEmptyTeamForm("no-historical-form");

  const byKey = new Map();
  for (const item of [...historicalMatches, ...currentMatches]) {
    const key = [
      item?.date || "",
      normalizeName(item?.opponent || ""),
      item?.venue || "",
      item?.score || "",
    ].join("|");
    if (!byKey.has(key)) byKey.set(key, item);
  }

  const mergedMatches = [...byKey.values()]
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")))
    .slice(-TEAM_RECENT_MATCH_WINDOW);
  const source = currentMatches.length
    ? "live+historical-team-form"
    : historicalMatches.some((item) => String(item?.source || "").includes("football-data"))
      ? "football-data-team-form"
      : "openfootball-team-form";

  return buildTeamFormFromRecentMatches(mergedMatches, source);
}

function buildTeamMatchesFromH2HResults(results, teamName) {
  const variants = buildPossibleNames(teamName);
  return (results || []).map((result) => {
    const home = String(result?.home || "").trim();
    const away = String(result?.away || "").trim();
    const homeMatch = buildPossibleNames(home).some((name) => variants.includes(name));
    const awayMatch = buildPossibleNames(away).some((name) => variants.includes(name));
    if (!homeMatch && !awayMatch) return null;
    const scoreParts = String(result?.score || "").match(/(\d+)\s*-\s*(\d+)/);
    if (!scoreParts) return null;
    const homeGoals = Number(scoreParts[1]);
    const awayGoals = Number(scoreParts[2]);
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
    const gf = homeMatch ? homeGoals : awayGoals;
    const ga = homeMatch ? awayGoals : homeGoals;
    return {
      date: result?.date || null,
      eventId: result?.eventId || null,
      league: result?.source || "h2h",
      tournamentId: result?.tournamentId || null,
      seasonId: result?.seasonId || null,
      venue: homeMatch ? "H" : "A",
      opponent: homeMatch ? away : home,
      opponentId: homeMatch ? result?.awayTeamId || "" : result?.homeTeamId || "",
      score: `${gf}-${ga}`,
      goalsFor: gf,
      goalsAgainst: ga,
      result: gf > ga ? "W" : gf === ga ? "D" : "L",
      source: result?.source || "h2h-agent",
    };
  }).filter(Boolean);
}

function supplementTeamFormWithH2H(currentForm, h2h, teamName) {
  const currentMatches = Array.isArray(currentForm?.recentMatches) ? currentForm.recentMatches : [];
  if (currentMatches.length >= TEAM_RECENT_MATCH_WINDOW) return currentForm;
  const h2hMatches = buildTeamMatchesFromH2HResults(h2h?.results || [], teamName);
  if (!h2hMatches.length) return currentForm;
  const byKey = new Map();
  for (const item of [...currentMatches, ...h2hMatches]) {
    const key = [
      item?.date || "",
      normalizeName(item?.opponent || ""),
      item?.venue || "",
      item?.score || "",
    ].join("|");
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return buildTeamFormFromRecentMatches([...byKey.values()], currentMatches.length ? "historical+h2h-team-form" : "h2h-team-form");
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
    return buildEmptyTeamForm("sofascore-empty");
  }

  const sample = finished.slice(-TEAM_RECENT_MATCH_WINDOW);
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

  const recentMatches = sample.slice(-TEAM_RECENT_MATCH_WINDOW).map((event) => {
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
    form: form.slice(-TEAM_FORM_BADGE_WINDOW),
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
    source: "sofascore-team-events",
  };
}

async function fetchInjuries(teamId, context = {}) {
  const json = await safeFetch(`${SOFA}/team/${teamId}/players`);
  const injured = Array.isArray(json?.players)
    ? json.players.filter(
    (player) =>
      player.player?.injured === true ||
      player.status === "injured" ||
      player.status === "doubtful"
      )
    : [];

  const baseAvailability = {
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
    suspendedCount: 0,
    suspendedPlayers: [],
    doubtsCount: injured.filter((player) => player.status === "doubtful").length,
    source: "Sofascore players",
  };

  const tournamentName = String(context?.tournamentName || "");
  const isInternational = isSeniorInternationalTournament(tournamentName);
  if (!isInternational) return baseAvailability;

  const extraAvailability = await fetchTransfermarktNationalTeamAvailability(context?.teamName || "");
  return mergeAvailability(baseAvailability, extraAvailability);
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

function getReliabilityBucket(input) {
  const league = String(input?.league || "").toLowerCase();
  const round = String(input?.roundLabel || "").toLowerCase();
  const summary = String(input?.context?.summary || input?.context?.type || "").toLowerCase();
  const leagueType = String(input?.leagueType || "").toLowerCase();
  const isInternational =
    league.startsWith("europe -") &&
    (league.includes("nations league") ||
      league.includes("qualification") ||
      league.includes("friendly") ||
      league.includes("international") ||
      league.includes("world cup") ||
      league.includes("championship"));
  const isQualification =
    isInternational &&
    (league.includes("qualification") || round.includes("qualification") || summary.includes("qualification"));
  const isFriendly =
    isInternational && (league.includes("friendly") || league.includes("international friendly") || summary.includes("friendly"));
  const isTwoLegKnockout =
    !!input?.aggregate?.active ||
    summary.includes("tweeluik") ||
    summary.includes("two-leg") ||
    summary.includes("aggregate");
  const isCupRound =
    leagueType === "cup" ||
    summary.includes("knock") ||
    summary.includes("play-off") ||
    /final|semi|quarter|round of|achtste|kwart|halve/.test(round);

  if (isTwoLegKnockout) return "two-leg-knockout";
  if (isQualification) return "qualification";
  if (isFriendly) return "friendly";
  if (isCupRound) return "cup";
  if (isInternational) return "interland";
  return "league";
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

function buildPhaseReliabilityFromReviews(reviews) {
  const phases = {};

  for (const review of Object.values(reviews || {})) {
    const phase = String(review?.phaseBucket || "league").trim();
    if (!phases[phase]) {
      phases[phase] = {
        phase,
        matches: 0,
        outcomeHits: 0,
        exactHits: 0,
        totalGoalError: 0,
      };
    }
    phases[phase].matches += 1;
    phases[phase].outcomeHits += review.outcomeHit ? 1 : 0;
    phases[phase].exactHits += review.exactHit ? 1 : 0;
    phases[phase].totalGoalError += Number(review.totalGoalError || 0);
  }

  for (const value of Object.values(phases)) {
    const matches = Math.max(Number(value.matches || 0), 1);
    const outcomeHitRate = Number((Number(value.outcomeHits || 0) / matches).toFixed(2));
    const exactHitRate = Number((Number(value.exactHits || 0) / matches).toFixed(2));
    const avgGoalError = Number((Number(value.totalGoalError || 0) / matches).toFixed(2));
    const reliability = Number(
      (outcomeHitRate * 0.68 + exactHitRate * 0.22 + Math.max(0, 1 - avgGoalError / 4) * 0.1).toFixed(2)
    );

    value.outcomeHitRate = outcomeHitRate;
    value.exactHitRate = exactHitRate;
    value.avgGoalError = avgGoalError;
    value.reliabilityScore = reliability;
    value.summary = `${value.phase}: ${Math.round(reliability * 100)}% betrouwbaar op ${value.matches} reviews`;
  }

  return phases;
}

function buildFeatureDiagnosticsFromReviews(reviews) {
  const items = Object.values(reviews || {});
  const failureCounts = {};
  const phaseMap = {};
  const topConfidence = {
    matches: 0,
    exactHits: 0,
    outcomeHits: 0,
    probabilityHits: 0,
    totalGoalError: 0,
    exactRank1Hits: 0,
    outcomeRank1Hits: 0,
    rank1Matches: 0,
  };
  let exactHits = 0;
  let outcomeHits = 0;
  let probabilityHits = 0;
  let totalGoalError = 0;

  for (const review of items) {
    if (review.exactHit) exactHits += 1;
    if (review.outcomeHit) outcomeHits += 1;
    if (review.probabilityOutcomeHit) probabilityHits += 1;
    totalGoalError += Number(review.totalGoalError || 0);

    if (review.topConfidencePick) {
      topConfidence.matches += 1;
      topConfidence.totalGoalError += Number(review.totalGoalError || 0);
      if (review.exactHit) topConfidence.exactHits += 1;
      if (review.outcomeHit) topConfidence.outcomeHits += 1;
      if (review.probabilityOutcomeHit) topConfidence.probabilityHits += 1;
      if (Number(review.bestBetRank || 0) === 1) {
        topConfidence.rank1Matches += 1;
        if (review.exactHit) topConfidence.exactRank1Hits += 1;
        if (review.outcomeHit) topConfidence.outcomeRank1Hits += 1;
      }
    }

    const phase = String(review.phaseBucket || "unknown");
    if (!phaseMap[phase]) phaseMap[phase] = { phase, matches: 0, exactHits: 0, outcomeHits: 0 };
    phaseMap[phase].matches += 1;
    if (review.exactHit) phaseMap[phase].exactHits += 1;
    if (review.outcomeHit) phaseMap[phase].outcomeHits += 1;

    for (const signal of review.failureSignals || []) {
      failureCounts[signal] = Number(failureCounts[signal] || 0) + 1;
    }
  }

  const total = items.length || 1;
  const topFailureSignals = Object.entries(failureCounts)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 6)
    .map(([signal, count]) => ({ signal, count: Number(count) }));
  const phaseBreakdown = Object.values(phaseMap)
    .map((item) => ({
      ...item,
      exactHitRate: Number((item.exactHits / Math.max(item.matches, 1)).toFixed(2)),
      outcomeHitRate: Number((item.outcomeHits / Math.max(item.matches, 1)).toFixed(2)),
    }))
    .sort((a, b) => b.matches - a.matches);

  return {
    reviews: items.length,
    exactHitRate: Number((exactHits / total).toFixed(3)),
    outcomeHitRate: Number((outcomeHits / total).toFixed(3)),
    probabilityOutcomeHitRate: Number((probabilityHits / total).toFixed(3)),
    avgGoalError: Number((totalGoalError / total).toFixed(2)),
    topConfidence: {
      matches: topConfidence.matches,
      exactHitRate: Number((topConfidence.exactHits / Math.max(topConfidence.matches, 1)).toFixed(3)),
      outcomeHitRate: Number((topConfidence.outcomeHits / Math.max(topConfidence.matches, 1)).toFixed(3)),
      probabilityOutcomeHitRate: Number((topConfidence.probabilityHits / Math.max(topConfidence.matches, 1)).toFixed(3)),
      avgGoalError: Number((topConfidence.totalGoalError / Math.max(topConfidence.matches, 1)).toFixed(2)),
      rank1ExactHitRate: Number((topConfidence.exactRank1Hits / Math.max(topConfidence.rank1Matches, 1)).toFixed(3)),
      rank1OutcomeHitRate: Number((topConfidence.outcomeRank1Hits / Math.max(topConfidence.rank1Matches, 1)).toFixed(3)),
      versusOverallOutcomeDelta: Number(
        (
          topConfidence.outcomeHits / Math.max(topConfidence.matches, 1) -
          outcomeHits / Math.max(items.length, 1)
        ).toFixed(3)
      ),
    },
    topFailureSignals,
    phaseBreakdown,
    summary:
      items.length > 0
        ? `Reviewdiagnose: exact ${Math.round((exactHits / total) * 100)}%, uitkomst ${Math.round((outcomeHits / total) * 100)}%, topkans ${Math.round((probabilityHits / total) * 100)}%.`
        : "Nog geen reviewdiagnose beschikbaar.",
  };
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

function buildPhaseReliabilityEdge(input) {
  const reliability = input.phaseReliability || null;
  if (!reliability) {
    return {
      summary: "geen fase-reviewdata",
      reliabilityScore: null,
      outcomeHitRate: null,
      exactHitRate: null,
      avgGoalError: null,
      matches: 0,
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

function buildRefereeProfile(referee, homeRecent, awayRecent, marketCalibration, historicalRefereeProfile) {
  if (!referee?.name) return null;
  const homeCards = Number(homeRecent?.yellowCardRate || 0) + Number(homeRecent?.redCardRate || 0) * 1.8;
  const awayCards = Number(awayRecent?.yellowCardRate || 0) + Number(awayRecent?.redCardRate || 0) * 1.8;
  const estimatedCardsTrend = Number(((homeCards + awayCards) / 2).toFixed(2));
  const estimatedPenaltyBase = Number(
    (
      Number(homeRecent?.over25Rate || 0.45) * 0.12 +
      Number(awayRecent?.over25Rate || 0.45) * 0.12 +
      Math.max(0, Number(marketCalibration?.overperformanceDiff || 0)) * 0.04
    ).toFixed(2)
  );
  const cardsTrend = Number(
    historicalRefereeProfile?.avgCards != null ? historicalRefereeProfile.avgCards : estimatedCardsTrend
  );
  const estimatedPenaltyRate =
    historicalRefereeProfile?.penaltyRate != null ? historicalRefereeProfile.penaltyRate : estimatedPenaltyBase;
  const strictness = cardsTrend >= 4.8 ? "streng" : cardsTrend >= 3.2 ? "gemiddeld" : "laat doorspelen";
  const source = historicalRefereeProfile ? "football-data.co.uk referee history" : "team-profiel schatting";

  return {
    ...referee,
    cardsTrend,
    estimatedPenaltyRate,
    strictness,
    source,
    matches: Number(historicalRefereeProfile?.matches || 0),
    summary: historicalRefereeProfile
      ? `${referee.name}: ${strictness}, ${cardsTrend} kaarten gem. uit ${historicalRefereeProfile.matches} duels`
      : `${referee.name}: ${strictness}, kaartenritme ${cardsTrend}, penalty-kans ${Math.round(estimatedPenaltyRate * 100)}%`,
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
  const bbcAggregate = event?.bbcMeta?.aggregate || null;
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

  if (!previousLeg && !isKnockoutHint && !bbcAggregate) return null;

  let firstLegHomeGoals = 0;
  let firstLegAwayGoals = 0;
  let firstLegText = null;
  if (bbcAggregate) {
    firstLegHomeGoals = Number(bbcAggregate.homeAggregateBeforeMatch || 0);
    firstLegAwayGoals = Number(bbcAggregate.awayAggregateBeforeMatch || 0);
    firstLegText = bbcAggregate.previousLegText || bbcAggregate.aggregateText || null;
  } else if (previousLeg?.score) {
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
    active: !!previousLeg || isKnockoutHint || !!bbcAggregate,
    firstLegScore: bbcAggregate?.previousLegScore || previousLeg?.score || null,
    firstLegText,
    aggregateScore: `${homeAggregate}-${awayAggregate}`,
    homeAggregate,
    awayAggregate,
    currentHomeGoals,
    currentAwayGoals,
    leader,
    roundLabel: extractRoundLabel(eventDetails),
    note:
      leader && (currentHomeGoals > 0 || currentAwayGoals > 0 || previousLeg || bbcAggregate)
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
    summary: notes.length ? notes.join(" - ") : null,
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

function buildH2HFromAggregateMeta(event, homeId, awayId, homeName, awayName, currentDate) {
  const aggregate = event?.bbcMeta?.aggregate || event?.curatedMeta?.aggregate || null;
  if (!aggregate?.previousLegScore) return null;
  const [homeGoals, awayGoals] = String(aggregate.previousLegScore).split("-").map(Number);
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
  return {
    eventId: `${event?.id || "aggregate"}-previous-leg`,
    date: addDaysToDateKey(currentDate, -7),
    homeTeamId: String(homeId || ""),
    awayTeamId: String(awayId || ""),
    home: homeName,
    away: awayName,
    score: `${homeGoals}-${awayGoals}`,
    winnerId: homeGoals === awayGoals ? "" : homeGoals > awayGoals ? String(homeId || normalizeName(homeName)) : String(awayId || normalizeName(awayName)),
    source: "bbc-aggregate",
  };
}

function lookupCuratedH2HBackfill(homeName, awayName, homeId, awayId) {
  const pairKey = buildPairKey(homeName, awayName);
  const raw = CURATED_H2H_BACKFILL[pairKey] || [];
  if (!raw.length) return null;

  const homeKey = String(homeId || normalizeName(homeName));
  const awayKey = String(awayId || normalizeName(awayName));
  const homeVariants = buildPossibleNames(homeName);
  const awayVariants = buildPossibleNames(awayName);
  const results = raw
    .map((item) => {
      const [homeGoals, awayGoals] = String(item.score || "").split("-").map(Number);
      if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
      const itemHomeVariants = buildPossibleNames(item.home);
      const itemAwayVariants = buildPossibleNames(item.away);
      const itemHomeIsCurrentHome = itemHomeVariants.some((variant) => homeVariants.includes(variant));
      const itemAwayIsCurrentAway = itemAwayVariants.some((variant) => awayVariants.includes(variant));
      const itemHomeIsCurrentAway = itemHomeVariants.some((variant) => awayVariants.includes(variant));
      const itemAwayIsCurrentHome = itemAwayVariants.some((variant) => homeVariants.includes(variant));
      const winnerId =
        homeGoals === awayGoals
          ? ""
          : homeGoals > awayGoals
            ? itemHomeIsCurrentHome
              ? homeKey
              : itemHomeIsCurrentAway
                ? awayKey
                : normalizeName(item.home)
            : itemAwayIsCurrentAway
              ? awayKey
              : itemAwayIsCurrentHome
                ? homeKey
                : normalizeName(item.away);

      return {
        date: item.date,
        home: item.home,
        away: item.away,
        homeTeamId: itemHomeIsCurrentHome ? homeKey : itemHomeIsCurrentAway ? awayKey : "",
        awayTeamId: itemAwayIsCurrentAway ? awayKey : itemAwayIsCurrentHome ? homeKey : "",
        score: item.score,
        winnerId,
        source: item.source || "curated-h2h",
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .slice(-5);

  if (!results.length) return null;
  return {
    played: results.length,
    homeWins: results.filter((item) => String(item.winnerId || "") === homeKey).length,
    draws: results.filter((item) => !item.winnerId).length,
    awayWins: results.filter((item) => String(item.winnerId || "") === awayKey).length,
    sameCompetitionPlayed: 0,
    weightedRecentBalance: calculateRecentH2HBalance({ results }, homeKey, awayKey),
    results,
    status: "curated-h2h-backfill",
  };
}

function buildH2HAgentProfile({
  baseH2H,
  fallbackLegs = [],
  marketProfile,
  openFootballProfile,
  homeName,
  awayName,
  homeId,
  awayId,
}) {
  const sources = [];
  let results = [];
  let sameCompetitionPlayed = Number(baseH2H?.sameCompetitionPlayed || 0);

  if (baseH2H?.results?.length) {
    results = mergeH2HResultLists(results, baseH2H.results);
    sources.push(baseH2H.status || "live-h2h");
  }

  for (const fallbackLeg of fallbackLegs || []) {
    if (!fallbackLeg) continue;
    results = mergeH2HResultLists(results, [fallbackLeg]);
    sources.push(fallbackLeg.source === "bbc-aggregate" ? "aggregate-backfill" : "previous-leg");
  }

  const curatedH2H = lookupCuratedH2HBackfill(homeName, awayName, homeId, awayId);
  if (curatedH2H?.results?.length) {
    results = mergeH2HResultLists(results, curatedH2H.results);
    sources.push(curatedH2H.status);
    sameCompetitionPlayed += Number(curatedH2H.sameCompetitionPlayed || 0);
  }

  for (const historicalH2H of [
    lookupHistoricalH2HBackfill(marketProfile || null, homeName, awayName, homeId, awayId),
    lookupHistoricalH2HBackfill(openFootballProfile || null, homeName, awayName, homeId, awayId),
  ]) {
    if (!historicalH2H?.results?.length) continue;
    results = mergeH2HResultLists(results, historicalH2H.results);
    sources.push(historicalH2H.status || "historical-competition");
    sameCompetitionPlayed += Number(historicalH2H.sameCompetitionPlayed || 0);
  }

  if (!results.length) {
    return { played: 0, homeWins: 0, draws: 0, awayWins: 0, results: [], status: "h2h-agent-empty" };
  }

  const profile = summarizeH2HResults(
    results,
    homeName,
    awayName,
    homeId,
    awayId,
    sources.length > 1 ? `h2h-agent:${[...new Set(sources)].join("+")}` : sources[0] || "h2h-agent",
    sameCompetitionPlayed
  );

  return {
    ...profile,
    targetPlayed: 5,
    coverage: Math.min(1, Number(profile.played || 0) / 5),
    agent: {
      name: "H2H-agent",
      target: 5,
      filled: Number(profile.played || 0),
      complete: Number(profile.played || 0) >= 5,
      sources: [...new Set(sources)],
    },
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

  if (input.homeSeasonStats?.dominanceScore != null && input.awaySeasonStats?.dominanceScore != null) {
    const dominanceDiff = Number(input.homeSeasonStats.dominanceScore || 0) - Number(input.awaySeasonStats.dominanceScore || 0);
    homeXG *= clamp(1 + dominanceDiff * 0.028, 0.92, 1.12);
    awayXG *= clamp(1 - dominanceDiff * 0.028, 0.92, 1.12);
  }

  if (input.homeSeasonStats?.avgShots && input.awaySeasonStats?.avgShotsAgainst) {
    homeXG *= clamp(Number(input.homeSeasonStats.avgShots || 0) / Math.max(Number(input.awaySeasonStats.avgShotsAgainst || 0), 1), 0.9, 1.1);
  }
  if (input.awaySeasonStats?.avgShots && input.homeSeasonStats?.avgShotsAgainst) {
    awayXG *= clamp(Number(input.awaySeasonStats.avgShots || 0) / Math.max(Number(input.homeSeasonStats.avgShotsAgainst || 0), 1), 0.9, 1.1);
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

  const homeStandingPressure = calcTeamPressure(input.homeStandingPos ?? input.homePos, input.standingTotalTeams);
  const awayStandingPressure = calcTeamPressure(input.awayStandingPos ?? input.awayPos, input.standingTotalTeams);
  if (homeStandingPressure > 1 || awayStandingPressure > 1) {
    homeXG *= clamp(homeStandingPressure, 1, 1.1);
    awayXG *= clamp(awayStandingPressure, 1, 1.1);
  } else if (input.matchImportance && input.matchImportance > 1) {
    homeXG *= clamp(input.matchImportance, 1, 1.05);
    awayXG *= clamp(input.matchImportance, 1, 1.05);
  }

  const learningEdge = buildLearningEdge(input);
  const marketCalibration = buildMarketCalibration(input);
  const leagueReliability = buildLeagueReliabilityEdge(input);
  const phaseReliability = buildPhaseReliabilityEdge(input);
  const refereeProfile = input.refereeProfile || null;
  const bookmakerSignals = Array.isArray(marketCalibration.bookmakerSignals) ? marketCalibration.bookmakerSignals : [];

  if (learningEdge.safeToApply && learningEdge.combinedReliability) {
    const learningSampleStrength = clamp(Number(learningEdge.totalReviewedMatches || 0) / 30, 0.2, 1);
    const reliabilityGate = clamp((Number(learningEdge.combinedReliability || 0) - 0.34) / 0.36, 0.12, 1);
    const phaseMultiplier = Number(learningEdge.phaseMultiplier || 1);
    const outcomeHitShift = clamp(
      (Number(learningEdge.homeOutcomeHitRate || 0) - Number(learningEdge.awayOutcomeHitRate || 0)) * 0.05,
      -0.045,
      0.045
    );
    const learningWeight = (0.04 + learningSampleStrength * 0.055) * reliabilityGate * phaseMultiplier;
    const learningBiasShift = clamp(
      (Number(learningEdge.homeBias || 0) - Number(learningEdge.awayBias || 0)) * learningWeight + outcomeHitShift,
      -0.115,
      0.115
    );
    homeXG *= clamp(1 + learningBiasShift, 0.94, 1.08);
    awayXG *= clamp(1 - learningBiasShift, 0.94, 1.08);
    learningEdge.applied = true;
    learningEdge.appliedShift = Number(learningBiasShift.toFixed(3));
  } else {
    learningEdge.applied = false;
    learningEdge.appliedShift = 0;
  }

  if (Number(learningEdge.totalReviewedMatches || 0) >= 8) {
    const exactEdge =
      clamp(
        (Number(learningEdge.homeExactHitRate || 0) - Number(learningEdge.awayExactHitRate || 0)) * 0.035,
        -0.04,
        0.04
      );
    homeXG *= clamp(1 + exactEdge, 0.97, 1.05);
    awayXG *= clamp(1 - exactEdge, 0.97, 1.05);
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
  if (bookmakerSignals.length) {
    const weightedBookDiff =
      bookmakerSignals.reduce((sum, item) => sum + Number(item.diff || 0) * Math.max(Number(item.strength || 0), 0.1), 0) /
      bookmakerSignals.reduce((sum, item) => sum + Math.max(Number(item.strength || 0), 0.1), 0);
    const bookmakerShift = clamp(
      weightedBookDiff * (Number(marketCalibration.bookmakerAgreement || 0) >= 0.7 ? 0.032 : 0.018),
      -0.06,
      0.06
    );
    homeXG *= clamp(1 + bookmakerShift, 0.955, 1.07);
    awayXG *= clamp(1 - bookmakerShift, 0.955, 1.07);
  }

  if (leagueReliability.reliabilityScore != null && leagueReliability.reliabilityScore < 0.45) {
    homeXG *= 0.98;
    awayXG *= 0.98;
  }
  if (phaseReliability.reliabilityScore != null && phaseReliability.reliabilityScore < 0.45) {
    homeXG *= 0.985;
    awayXG *= 0.985;
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
  const bestByOutcome = {
    home: { score: "1-0", probability: 0 },
    draw: { score: "1-1", probability: 0 },
    away: { score: "0-1", probability: 0 },
  };
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

      if (homeGoals > awayGoals && probability > bestByOutcome.home.probability) {
        bestByOutcome.home = { score: `${homeGoals}-${awayGoals}`, probability };
      } else if (homeGoals === awayGoals && probability > bestByOutcome.draw.probability) {
        bestByOutcome.draw = { score: `${homeGoals}-${awayGoals}`, probability };
      } else if (awayGoals > homeGoals && probability > bestByOutcome.away.probability) {
        bestByOutcome.away = { score: `${homeGoals}-${awayGoals}`, probability };
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

  const homeAwayEdge = buildHomeAwayEdge(input.homeRecent, input.awayRecent);
  const featureVector = buildFeatureVector(input);
  const heuristicModel = buildHeuristicEnsemble(featureVector);
  const baseModel = { homeProb, drawProb, awayProb };
  const blended = blendProbabilities(
    baseModel,
    heuristicModel,
    0.78
  );
  const outcomeEntries = [
    { key: "home", prob: blended.homeProb },
    { key: "draw", prob: blended.drawProb },
    { key: "away", prob: blended.awayProb },
  ].sort((a, b) => b.prob - a.prob);
  const [rawBestHomeGoals, rawBestAwayGoals] = bestScore.split("-").map(Number);
  const bestScoreOutcome =
    rawBestHomeGoals > rawBestAwayGoals
      ? "home"
      : rawBestHomeGoals === rawBestAwayGoals
        ? "draw"
        : "away";
  const selectedScore = bestScore;
  const selectedExactProb = bestProb;
  const dominantOutcome = outcomeEntries[0];
  const outcomeEdge = Number((dominantOutcome.prob - outcomeEntries[1].prob).toFixed(4));
  const [predHomeGoals, predAwayGoals] = selectedScore.split("-").map(Number);
  const modelAgreement = calcModelAgreement(baseModel, heuristicModel);
  const lineupImpact = buildLineupImpact(input);
  const tacticalMismatch = buildTacticalMismatch(input);
  const formShift = buildFormShift(input);
  const travelEdge = buildTravelEdge(input, featureVector);
  const keeperEdge = buildKeeperEdge(input, featureVector);
  const baseConfidence = Math.min(0.93, selectedExactProb * 3.5 + 0.24);
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
  const phasePenalty =
    phaseReliability.reliabilityScore != null && phaseReliability.reliabilityScore < 0.4
      ? 0.04
      : phaseReliability.reliabilityScore != null && phaseReliability.reliabilityScore < 0.52
        ? 0.015
        : 0;
  const bookmakerPenalty =
    bookmakerSignals.length === 0
      ? 0.015
      : Number(marketCalibration.bookmakerAgreement || 0) < 0.45
        ? 0.018
        : Number(marketCalibration.bookmakerAgreement || 0) < 0.62
          ? 0.008
          : 0;
  const closingCoveragePenalty =
    Number(marketCalibration.closingCoverage || 0) < 0.2
      ? 0.012
      : Number(marketCalibration.closingCoverage || 0) < 0.4
        ? 0.005
        : 0;
  const fragilityPenalty =
    (Number(learningEdge.homeFragility || 0) + Number(learningEdge.awayFragility || 0) >= 4 ? 0.02 : 0) +
    (!input.lineupSummary?.confirmed ? 0.015 : 0);
  const modelAgreementPenalty =
    modelAgreement < 0.35
      ? 0.085
      : modelAgreement < 0.45
        ? 0.055
        : modelAgreement < 0.55
          ? 0.028
          : 0;
  const adjustedConfidence = clamp(
    baseConfidence -
      reliabilityPenalty -
      fragilityPenalty -
      leaguePenalty -
      phasePenalty -
      bookmakerPenalty -
      closingCoveragePenalty -
      modelAgreementPenalty,
    0.24,
    0.93
  );
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
    exactProb: Number(selectedExactProb.toFixed(4)),
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
      phaseReliability,
      marketCalibration,
      refereeProfile,
      scoreSelection: {
        rawBestScore: bestScore,
        selectedScore,
        reason:
          dominantOutcome.key !== bestScoreOutcome
            ? `hoogste exacte scorematrix-kans; 1X2 neigt naar ${dominantOutcome.key === "home" ? "thuiswinst" : dominantOutcome.key === "away" ? "uitwinst" : "gelijkspel"}`
            : "hoogste exacte scorematrix-kans",
        outcomeEdge,
      },
      clubEloDiff: homeClubElo > 0 && awayClubElo > 0 ? Math.round(homeClubElo - awayClubElo) : null,
      stakes: input.context?.summary || null,
      matchImportance: input.matchImportance || 1,
      modelAgreement,
      modelAgreementPenalty: Number(modelAgreementPenalty.toFixed(3)),
      modelWarnings: [
        ...(modelAgreement < 0.55 ? ["low_model_agreement"] : []),
        ...(bookmakerSignals.length === 0 ? ["market_signals_missing"] : []),
      ],
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
    .sort((a, b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0))
    .slice(0, MAX_REVIEWS);
  store.postMatchReviews = Object.fromEntries(reviewEntries);

  pruneUpdatedMap(store, "teamStats", "teamStatsUpdated", FORM_TTL, now, 600);
  pruneUpdatedMap(store, "teamInjuries", "teamInjuriesUpdated", INJURY_TTL, now, 600);
  pruneUpdatedMap(store, "teamSeasonStats", "teamSeasonStatsUpdated", SEASON_TTL, now, 600);
  pruneUpdatedMap(store, "eventCache", "eventCacheUpdated", EVENT_TTL, now, MAX_EVENT_CACHE);
  pruneUpdatedMap(store, "marketProfiles", "marketProfilesUpdated", MARKET_TTL, now, MAX_MARKET_PROFILES);
  pruneUpdatedMap(store, "openfootballProfiles", "openfootballProfilesUpdated", OPENFOOTBALL_TTL, now, MAX_OPENFOOTBALL_CACHE);
  pruneUpdatedMap(store, "understatSnapshots", "understatSnapshotsUpdated", SNAPSHOT_TTL, now, MAX_SNAPSHOT_CACHE);
  pruneUpdatedMap(store, "fbrefSnapshots", "fbrefSnapshotsUpdated", SNAPSHOT_TTL, now, MAX_SNAPSHOT_CACHE);
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
    openfootballProfiles: {},
    openfootballProfilesUpdated: {},
    understatSnapshots: {},
    understatSnapshotsUpdated: {},
    fbrefSnapshots: {},
    fbrefSnapshotsUpdated: {},
    postMatchReviews: {},
    teamLearning: {},
    leagueReliability: {},
    phaseReliability: {},
    featureDiagnostics: null,
    sourceCoverage: null,
    dataScout: null,
    aiAdvice: [],
    lastRun: null,
    workerVersion: "v18-score-data-scout",
  };
}

function buildSourceCoverage(store, todayKey) {
  const todayMatches = Array.isArray(store.matches?.[todayKey]) ? store.matches[todayKey] : [];
  const total = Math.max(todayMatches.length, 1);
  const sourceBreakdown = todayMatches.reduce((acc, match) => {
    const key = String(match?.dataSource || "sofascore");
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const bookmakerCovered = todayMatches.filter(
    (match) => Array.isArray(match?.marketCalibration?.bookmakerSignals) && match.marketCalibration.bookmakerSignals.length > 0
  ).length;
  const refereeCovered = todayMatches.filter(
    (match) => Number(match?.refereeProfile?.matches || 0) > 0
  ).length;
  const h2hCovered = todayMatches.filter((match) => Number(match?.h2h?.played || 0) > 0).length;
  const openfootballH2hCovered = todayMatches.filter((match) =>
    (match?.h2h?.results || []).some((item) => String(item?.source || "").includes("openfootball"))
  ).length;
  const understatCovered = todayMatches.filter((match) =>
    match?.homeSeasonStats?.externalSources?.includes?.("Understat") ||
    match?.awaySeasonStats?.externalSources?.includes?.("Understat")
  ).length;
  const fbrefCovered = todayMatches.filter((match) =>
    match?.homeSeasonStats?.externalSources?.includes?.("FBref") ||
    match?.awaySeasonStats?.externalSources?.includes?.("FBref")
  ).length;
  const scoreRelevant = todayMatches.filter((match) => ["FT", "LIVE", "HT"].includes(String(match?.status || "").toUpperCase()));
  const scoreRelevantTotal = Math.max(scoreRelevant.length, 1);
  const finishedMatches = todayMatches.filter((match) => String(match?.status || "").toUpperCase() === "FT");
  const liveMatches = todayMatches.filter((match) => ["LIVE", "HT"].includes(String(match?.status || "").toUpperCase()));
  const finishedWithScore = finishedMatches.filter((match) => String(match?.score || "").includes("-")).length;
  const liveWithScore = liveMatches.filter((match) => String(match?.score || "").includes("-")).length;
  const scoreCovered = scoreRelevant.filter((match) => String(match?.score || "").includes("-")).length;
  const logoCovered = todayMatches.filter((match) => match?.homeLogo && match?.awayLogo).length;
  const statusBreakdown = todayMatches.reduce((acc, match) => {
    const key = String(match?.status || "UNKNOWN").toUpperCase();
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const openfootballProfiles = Object.keys(store.openfootballProfiles || {}).length;
  const understatSnapshots = Object.keys(store.understatSnapshots || {}).length;
  const fbrefSnapshots = Object.keys(store.fbrefSnapshots || {}).length;
  return {
    todayMatches: todayMatches.length,
    scoreCoverage: Number((scoreCovered / scoreRelevantTotal).toFixed(2)),
    finishedScoreCoverage: Number((finishedWithScore / Math.max(finishedMatches.length, 1)).toFixed(2)),
    liveScoreCoverage: Number((liveWithScore / Math.max(liveMatches.length, 1)).toFixed(2)),
    logoCoverage: Number((logoCovered / total).toFixed(2)),
    finishedMatches: finishedMatches.length,
    finishedWithScore,
    liveMatches: liveMatches.length,
    liveWithScore,
    pendingFinishedCount: Math.max(0, finishedMatches.length - finishedWithScore),
    statusBreakdown,
    bookmakerCoverage: Number((bookmakerCovered / total).toFixed(2)),
    refereeCoverage: Number((refereeCovered / total).toFixed(2)),
    h2hCoverage: Number((h2hCovered / total).toFixed(2)),
    openfootballH2hCoverage: Number((openfootballH2hCovered / total).toFixed(2)),
    understatCoverage: Number((understatCovered / total).toFixed(2)),
    fbrefCoverage: Number((fbrefCovered / total).toFixed(2)),
    marketProfiles: Object.keys(store.marketProfiles || {}).length,
    openfootballProfiles,
    understatSnapshots,
    fbrefSnapshots,
    sourceBreakdown,
    backupSources: [
      {
        key: "sofascore",
        name: "Sofascore",
        role: "optionele live/detailbron",
        status: Number(sourceBreakdown.sofascore || 0) > 0 ? "actief" : "403/uitgeschakeld deze run",
        note: "Wordt alleen gebruikt als de publieke API bereikbaar is; ESPN, TheSportsDB en open data vullen scores/logo's bij 403.",
      },
      {
        key: "espn-scoreboard",
        name: "ESPN Scoreboard",
        role: "score + logo backup",
        status: Object.keys(sourceBreakdown).some((key) => key.includes("espn")) ? "actief" : "stand-by",
        note: "Tweede hoofdbron voor fixtures, live/FT scores en officiele clublogo's voor topcompetities.",
      },
      {
        key: "thesportsdb",
        name: "TheSportsDB",
        role: "backup",
        status: Object.keys(sourceBreakdown).some((key) => key.includes("thesportsdb")) ? "actief" : "stand-by",
        note: "Gratis fixturefallback voor internationale en geselecteerde competitiewedstrijden.",
      },
      {
        key: "football-data",
        name: "football-data.co.uk",
        role: "backup + markt",
        status: Object.keys(sourceBreakdown).some((key) => key.includes("football-data")) ? "actief" : "markt-only",
        note: "Historische odds, closing-lijnen en fixturefallback uit gratis competitiebestanden.",
      },
      {
        key: "openligadb",
        name: "OpenLigaDB",
        role: "backup",
        status: Object.keys(sourceBreakdown).some((key) => key.includes("openligadb")) ? "actief" : "stand-by",
        note: "Extra gratis fixturebron voor vooral Duitse competities wanneer de hoofdbron dun blijft.",
      },
      {
        key: "curated-bbc",
        name: "BBC fixture backfill",
        role: "curated noodfallback",
        status: Object.keys(sourceBreakdown).some((key) => key.includes("curated-fixture")) ? "actief" : "stand-by",
        note: "Handmatige gratis veiligheidslaag voor bewezen topwedstrijden die alle automatische fallbackbronnen missen.",
      },
      {
        key: "openfootball",
        name: "openfootball",
        role: "historisch H2H",
        status: openfootballProfiles > 0 ? "gekoppeld" : "stand-by",
        note: `${openfootballProfiles} competitieprofiel(en), ${Math.round((openfootballH2hCovered / total) * 100)}% van vandaag met openfootball-H2H.`,
      },
    ],
    understat: {
      status: understatSnapshots > 0 ? "gekoppeld" : "stand-by",
      snapshots: understatSnapshots,
      coverage: Number((understatCovered / total).toFixed(2)),
      note: understatSnapshots > 0
        ? `${understatSnapshots} xG/xGA-snapshot(s), ${Math.round((understatCovered / total) * 100)}% van vandaag verrijkt.`
        : "Geen actieve Understat-competitie op deze speeldag of bron tijdelijk niet bereikbaar.",
    },
    fbref: {
      status: fbrefSnapshots > 0 ? "gekoppeld" : "stand-by",
      snapshots: fbrefSnapshots,
      coverage: Number((fbrefCovered / total).toFixed(2)),
      note: fbrefSnapshots > 0
        ? `${fbrefSnapshots} shot/split-snapshot(s), ${Math.round((fbrefCovered / total) * 100)}% van vandaag verrijkt.`
        : "Geen actieve FBref-snapshot voor deze speeldag of release tijdelijk niet bereikbaar.",
    },
  };
}

function buildDataScoutReport(store, todayKey) {
  const todayMatches = Array.isArray(store.matches?.[todayKey]) ? store.matches[todayKey] : [];
  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const yesterdayKey = addDaysToDateKey(todayKey, -1);
  const tomorrowMatches = Array.isArray(store.matches?.[tomorrowKey]) ? store.matches[tomorrowKey] : [];
  const yesterdayMatches = Array.isArray(store.matches?.[yesterdayKey]) ? store.matches[yesterdayKey] : [];
  const sourceCoverage = store.sourceCoverage || buildSourceCoverage(store, todayKey);
  const sourceBreakdown = sourceCoverage.sourceBreakdown || {};
  const sourceIsActive = (sourceKey) => Object.keys(sourceBreakdown).some((key) => key.includes(sourceKey));
  const finishedYesterday = yesterdayMatches.filter((match) => String(match?.status || "").toUpperCase() === "FT");
  const yesterdayScoresFilled = finishedYesterday.filter((match) => String(match?.score || "").includes("-")).length;
  const todaysFinished = todayMatches.filter((match) => String(match?.status || "").toUpperCase() === "FT");
  const todaysLive = todayMatches.filter((match) => ["LIVE", "HT"].includes(String(match?.status || "").toUpperCase()));
  const h2hFilled = todayMatches.filter((match) => Number(match?.h2h?.played || 0) > 0).length;
  const logoFilled = todayMatches.filter((match) => match?.homeLogo && match?.awayLogo).length;

  const sourceReports = DATA_SCOUT_SOURCES.map((source) => {
    const hasCache =
      (source.key === "openfootball" && Object.keys(store.openfootballProfiles || {}).length > 0) ||
      (source.key === "understat" && Object.keys(store.understatSnapshots || {}).length > 0) ||
      (source.key === "fbref" && Object.keys(store.fbrefSnapshots || {}).length > 0) ||
      (source.key === "football-data" && Object.keys(store.marketProfiles || {}).length > 0);
    const active = sourceIsActive(source.key) || hasCache || (source.key === "bbc-fixtures" && sourceIsActive("curated-fixture"));
    return {
      ...source,
      status: active ? "actief/gekoppeld" : source.priority === "pilot" ? "pilot/stand-by" : "stand-by",
      collected: active,
    };
  });

  const gaps = [];
  if (finishedYesterday.length > yesterdayScoresFilled) {
    gaps.push({
      title: "Uitslagen gisteren niet volledig",
      count: finishedYesterday.length - yesterdayScoresFilled,
      action: "ESPN, football-data en BBC fallback blijven elke worker-run opnieuw samenvoegen.",
    });
  }
  if (todayMatches.length && logoFilled < todayMatches.length) {
    gaps.push({
      title: "Logo's ontbreken",
      count: todayMatches.length - logoFilled,
      action: "ESPN en TheSportsDB logo-cache vullen ontbrekende clubemblemen automatisch aan.",
    });
  }
  if (todayMatches.length && h2hFilled < todayMatches.length) {
    gaps.push({
      title: "H2H nog niet overal gevuld",
      count: todayMatches.length - h2hFilled,
      action: "Openfootball en opgeslagen historische wedstrijden blijven onderlinge duels aanvullen.",
    });
  }
  if (!tomorrowMatches.length) {
    gaps.push({
      title: "Morgen leeg",
      count: 1,
      action: "Worker haalt morgen via primaire bron plus ESPN/TheSportsDB/football-data fallback opnieuw op.",
    });
  }

  return {
    lastScan: new Date().toISOString(),
    cadence: "worker elke 10 minuten",
    mode: "gratis databronnen, geen API-key verplicht",
    collected: {
      todayDate: todayKey,
      todayMatches: todayMatches.length,
      tomorrowDate: tomorrowKey,
      tomorrowMatches: tomorrowMatches.length,
      yesterdayDate: yesterdayKey,
      yesterdayMatches: yesterdayMatches.length,
      yesterdayScoresFilled,
      liveMatches: todaysLive.length,
      finishedToday: todaysFinished.length,
      finishedTodayWithScore: todaysFinished.filter((match) => String(match?.score || "").includes("-")).length,
      logosFilledToday: logoFilled,
      h2hFilledToday: h2hFilled,
      reviews: Object.keys(store.postMatchReviews || {}).length,
      teamsWithLearning: Object.keys(store.teamLearning || {}).length,
      marketProfiles: Object.keys(store.marketProfiles || {}).length,
      openfootballProfiles: Object.keys(store.openfootballProfiles || {}).length,
      understatSnapshots: Object.keys(store.understatSnapshots || {}).length,
      fbrefSnapshots: Object.keys(store.fbrefSnapshots || {}).length,
    },
    sources: sourceReports,
    gaps,
    recommendations: [
      "Gebruik ESPN Scoreboard als vaste score/logo back-up naast de primaire bron.",
      "Gebruik football-data.co.uk voor historische uitslagen, odds, shots en referee-signalen.",
      "Gebruik openfootball voor H2H-backfill wanneer live bronnen geen onderlinge historie geven.",
      "Gebruik Understat en FBref als pilot-signalen voor xG, shotdruk en home/away splits waar bereikbaar.",
    ],
  };
}

function buildAiRecommendations(store, todayKey) {
  const todayMatches = Array.isArray(store.matches?.[todayKey]) ? store.matches[todayKey] : [];
  const issues = [];

  const h2hMissing = todayMatches.filter((match) => !match?.h2h?.played).length;
  if (h2hMissing > 0) {
    issues.push({
      title: "H2H aanvullen",
      summary: `${h2hMissing} wedstrijd(en) missen nog onderlinge historie.`,
      action: "Voeg waar mogelijk extra competitie-backfill of bronfallback toe in de worker.",
      priority: "medium",
    });
  }

  const bookmakerMissing = todayMatches.filter(
    (match) => !Array.isArray(match?.marketCalibration?.bookmakerSignals) || !match.marketCalibration.bookmakerSignals.length
  ).length;
  if (bookmakerMissing > 0) {
    issues.push({
      title: "Bookmakerdekking verbreden",
      summary: `${bookmakerMissing} wedstrijd(en) missen bookmaker-signalen.`,
      action: "Gebruik extra oddsbron of current-odds fallback voor interlands en zeldzame competities.",
      priority: "medium",
    });
  }

  const sourceCoverage = store.sourceCoverage || null;
  if (sourceCoverage && Number(sourceCoverage.pendingFinishedCount || 0) > 0) {
    issues.push({
      title: "Uitslagen direct vullen",
      summary: `${Number(sourceCoverage.pendingFinishedCount || 0)} afgeronde wedstrijd(en) missen nog een score in de actuele speeldag.`,
      action: "Laat ESPN Scoreboard, football-data en BBC fixturefallback de scorevelden blijven overschrijven wanneer de primaire bron leeg blijft.",
      priority: "high",
    });
  }
  if (sourceCoverage && Number(sourceCoverage.logoCoverage || 0) < 0.95) {
    issues.push({
      title: "Clublogo-cache uitbreiden",
      summary: `Logo-dekking staat op ${Math.round(Number(sourceCoverage.logoCoverage || 0) * 100)}% voor de actuele speeldag.`,
      action: "Gebruik ESPN en TheSportsDB als vaste logobronnen en cache de gevonden logo's per clubnaam/alias.",
      priority: "medium",
    });
  }
  if (sourceCoverage && Number(sourceCoverage.bookmakerCoverage || 0) < 0.7) {
    issues.push({
      title: "Bronkwaliteit odds nog dun",
      summary: `Bookmakerdekking staat op ${Math.round(Number(sourceCoverage.bookmakerCoverage || 0) * 100)}% voor de actuele speeldag.`,
      action: "Verbred internationale oddsfallbacks en gebruik historische closing-signalen als live odds ontbreken.",
      priority: "medium",
    });
  }
  const matchesWithRefereeNames = todayMatches.filter((match) => String(match?.refereeProfile?.name || "").trim()).length;
  if (sourceCoverage && matchesWithRefereeNames >= 3 && Number(sourceCoverage.refereeCoverage || 0) < 0.65) {
    issues.push({
      title: "Referee-matchrate verhogen",
      summary: `Historische referee-dekking staat op ${Math.round(Number(sourceCoverage.refereeCoverage || 0) * 100)}%.`,
      action: "Gebruik bredere aliasvarianten en gecombineerde referee-archieven per land/competitiefamilie.",
      priority: "medium",
    });
  }
  if (sourceCoverage && Number(sourceCoverage.h2hCoverage || 0) < 0.75) {
    issues.push({
      title: "H2H fallback verbreden",
      summary: `H2H-dekking staat op ${Math.round(Number(sourceCoverage.h2hCoverage || 0) * 100)}% voor de actuele speeldag.`,
      action: "Blijf competitiebackfill combineren met neutrale onderlinge fallback buiten de live bron.",
      priority: "medium",
    });
  }

  const exactReviews = Object.values(store.postMatchReviews || {});
  const exactHitRate =
    exactReviews.length > 0
      ? exactReviews.filter((item) => item.exactHit).length / exactReviews.length
      : 0;
  issues.push({
    title: "Modelkalibratie",
    summary: `Exact-score hitrate staat op ${Math.round(exactHitRate * 100)}% over ${exactReviews.length} reviews.`,
    action: "Gebruik deze score om ensemble- en closing-gewichten te blijven finetunen.",
    priority: exactHitRate < 0.14 ? "high" : "low",
  });

  const diagnostics = store.featureDiagnostics || null;
  const topFailure = diagnostics?.topFailureSignals?.[0] || null;
  if (topFailure) {
    if (topFailure.signal !== "low_model_agreement") {
      issues.push({
        title: "Top faalsignaal",
        summary: `${topFailure.signal} kwam ${topFailure.count} keer terug in de reviewdata.`,
        action: "Gebruik dit signaal om de modelweging of brondekking gericht te verbeteren.",
        priority: topFailure.count >= 8 ? "high" : "medium",
      });
    }
  }

  if (diagnostics?.probabilityOutcomeHitRate != null) {
    issues.push({
      title: "Topkans versus scoremodel",
      summary: `Topkans-hit staat op ${Math.round(Number(diagnostics.probabilityOutcomeHitRate || 0) * 100)}% tegenover ${Math.round(Number(diagnostics.outcomeHitRate || 0) * 100)}% score-uitkomsthit.`,
      action: "Gebruik dit verschil om te bepalen of het model te agressief op exacte score of juist te voorzichtig op 1X2 zit.",
      priority:
        Number(diagnostics.probabilityOutcomeHitRate || 0) - Number(diagnostics.outcomeHitRate || 0) >= 0.12
          ? "medium"
          : "low",
    });
  }

  const topConfidence = diagnostics?.topConfidence || null;
  if (topConfidence && Number(topConfidence.matches || 0) > 0) {
    if (Number(topConfidence.matches || 0) >= 40) {
      issues.push({
        title: "Top 5 zekere tips monitoren",
        summary: `Top-5 tips scoren ${Math.round(Number(topConfidence.exactHitRate || 0) * 100)}% exact en ${Math.round(Number(topConfidence.outcomeHitRate || 0) * 100)}% op winnaar/gelijk over ${topConfidence.matches} reviews.`,
        action:
          Number(topConfidence.versusOverallOutcomeDelta || 0) < -0.08
            ? "Nieuwe selectie blijft na voldoende nieuwe reviews achter. Herweeg scoreselectie opnieuw met bronkwaliteit/marktdekking/modelagreement."
            : "Nieuwe selectie wordt bewaakt; pas opnieuw bij voldoende nieuwe reviewdata.",
        priority: Number(topConfidence.versusOverallOutcomeDelta || 0) < -0.08 ? "high" : "medium",
      });
    }
  }

  const topFailureSignals = diagnostics?.topFailureSignals || [];
  const modelAgreementFailure = topFailureSignals.find((item) => item.signal === "low_model_agreement");
  if (modelAgreementFailure && Number(modelAgreementFailure.count || 0) >= 150) {
    issues.push({
      title: "Modelen zitten te vaak uit elkaar",
      summary: `Low model agreement kwam ${modelAgreementFailure.count} keer terug in reviewdata.`,
      action: "De eerste penalty is geinstalleerd. Heropen alleen als dit signaal na nieuwe reviews blijft oplopen.",
      priority: modelAgreementFailure.count >= 5 ? "high" : "medium",
    });
  }
  const h2hSignalFailure = topFailureSignals.find((item) => item.signal === "h2h_signal");
  if (h2hSignalFailure) {
    issues.push({
      title: "H2H-signaal herwegen",
      summary: `H2H-signal kwam ${h2hSignalFailure.count} keer terug als faalsignaal.`,
      action: "Gebruik H2H alleen zwaar als het recent, voldoende gevuld en competitietype-vergelijkbaar is.",
      priority: "medium",
    });
  }
  const clubEloFailure = topFailureSignals.find((item) => item.signal === "clubelo_misread");
  if (clubEloFailure) {
    issues.push({
      title: "ClubElo interlands strakker scheiden",
      summary: `ClubElo/sterktesprong zat ${clubEloFailure.count} keer mis in de reviews.`,
      action: "Splits interland- en clubkracht nog strakker en temper ClubElo bij nationale teams.",
      priority: "medium",
    });
  }

  if (sourceCoverage && Number(sourceCoverage.understatCoverage || 0) < 0.35 && Number(sourceCoverage.todayMatches || 0) > 0) {
    issues.push({
      title: "Understat xG-dekking bewaken",
      summary: `Understat verrijkt ${Math.round(Number(sourceCoverage.understatCoverage || 0) * 100)}% van de actuele speeldag.`,
      action: "Gebruik Understat vooral op Big-5 competities en blijf Sofascore/FBref gebruiken als xG-backup waar Understat geen competitie ondersteunt.",
      priority: "low",
    });
  }
  if (sourceCoverage && Number(sourceCoverage.fbrefCoverage || 0) < 0.35 && Number(sourceCoverage.todayMatches || 0) > 0) {
    issues.push({
      title: "FBref shot-snapshotdekking bewaken",
      summary: `FBref verrijkt ${Math.round(Number(sourceCoverage.fbrefCoverage || 0) * 100)}% van de actuele speeldag.`,
      action: "Houd FBref via release-snapshots draaien en gebruik de shot/splitvelden als correctielaag wanneer live teamstats dun zijn.",
      priority: "low",
    });
  }

  return issues;
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
  const today = toAmsterdamDateKey(new Date());
  const yesterday = addDaysToDateKey(today, -1);
  const tomorrow = addDaysToDateKey(today, 1);
  const dayAfterTomorrow = addDaysToDateKey(today, 2);
  // Houd bewust een extra dag vooruit vast. Als een geplande worker-run een
  // keer wordt overgeslagen, blijft "morgen" in de app alsnog gevuld.
  const dates = [yesterday, today, tomorrow, dayAfterTomorrow];

  if (!store.knockoutOverview) store.knockoutOverview = {};
  if (!store.cupSheets) store.cupSheets = {};
  if (!store.marketProfiles) store.marketProfiles = {};
  if (!store.marketProfilesUpdated) store.marketProfilesUpdated = {};
  if (!store.postMatchReviews) store.postMatchReviews = {};
  if (!store.teamLearning) store.teamLearning = {};
  if (!store.leagueReliability) store.leagueReliability = {};
  if (!store.phaseReliability) store.phaseReliability = {};
  purgeExcludedContent(store);
  await repairStoredLogos(store);
  repairStoredPredictionScoreSelections(store);
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
    
    // Handle different possible API response structures
    let apiEvents = [];
    if (Array.isArray(json)) {
      apiEvents = json;
    } else if (json?.events && Array.isArray(json.events)) {
      apiEvents = json.events;
    } else if (json?.data && Array.isArray(json.data)) {
      apiEvents = json.data;
    }
    
    if (apiEvents.length > 0) {
      console.log(`[worker] ${date}: ${apiEvents.length} events van API, filtering...`);
    }
    
    let events = apiEvents
      .filter((event) => {
        const key = event?.startTimestamp
          ? toAmsterdamDateKey(new Date(Number(event.startTimestamp) * 1000))
          : null;
        return key === date;
      })
      .filter((event) => getLeagueInfo(event));

    const fallbackEvents = await fetchFallbackScheduledEventsFromMarket(date);
    const sportsDbEvents = await fetchSportsDbScheduledEvents(date);
    const espnEvents = await fetchEspnScoreboardEvents(date);
    const openLigaDbEvents = await fetchOpenLigaDbScheduledEvents(date);
    const bbcEvents = await fetchBbcScheduledEvents(date);
    const curatedEvents = fetchCuratedFixtureBackfill(date);
    const combinedFallbacks = dedupeFallbackEvents([
      ...events,
      ...fallbackEvents,
      ...sportsDbEvents,
      ...espnEvents,
      ...openLigaDbEvents,
      ...bbcEvents,
      ...curatedEvents,
    ]);

    if (fallbackEvents.length) {
      console.log(`[worker] ${date}: ${fallbackEvents.length} fallback events uit football-data.co.uk`);
    }
    if (sportsDbEvents.length) {
      console.log(`[worker] ${date}: ${sportsDbEvents.length} fallback events uit TheSportsDB`);
    }
    if (espnEvents.length) {
      console.log(`[worker] ${date}: ${espnEvents.length} fallback events uit ESPN scoreboard`);
    }
    if (openLigaDbEvents.length) {
      console.log(`[worker] ${date}: ${openLigaDbEvents.length} fallback events uit OpenLigaDB`);
    }
    if (bbcEvents.length) {
      console.log(`[worker] ${date}: ${bbcEvents.length} fallback events uit BBC fixtures`);
    }
    if (curatedEvents.length) {
      console.log(`[worker] ${date}: ${curatedEvents.length} fallback events uit curated fixtures`);
    }
    if (combinedFallbacks.length) {
      events = combinedFallbacks.map((event) => applyCuratedResultBackfill(event, date));
    }
    
    if (events.length > 0) {
      console.log(`[worker] ${date}: ${events.length} events na filtering (${apiEvents.length} totaal)`);
    } else if (apiEvents.length > 0) {
      console.warn(`[worker] ${date}: WAARSCHUWING - ${apiEvents.length} API events maar 0 na filtering!`);
    }
    
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
          label: leagueInfo.label,
        });
      }
      if (awayId && tournamentId && seasonId) {
        teamTournamentMap.set(awayId, {
          tournamentId,
          seasonId,
          teamName: awayName,
          tournamentName: event?.tournament?.name || event?.uniqueTournament?.name || "",
          label: leagueInfo.label,
        });
      }
      if (tournamentId && seasonId && leagueInfo) {
        tournamentsMap.set(`${tournamentId}_${seasonId}`, { tournamentId, seasonId, label: leagueInfo.label });
      }
    }
  }

  const allActiveLeagueLabels = [
    ...new Set(
      Object.values(allEvents)
        .flat()
        .map((event) => getLeagueInfo(event)?.label)
        .filter(Boolean)
    ),
  ];
  const activeLeagueLabels = [
    ...new Set([
      ...allActiveLeagueLabels.filter((label) => MARKET_LEAGUE_CODES[label]),
      ...TEAM_FORM_HISTORY_LEAGUES,
    ]),
  ];

  for (const leagueLabel of activeLeagueLabels) {
    const existingMarketProfile = store.marketProfiles[leagueLabel] || null;
    const missingHistoricalStats =
      existingMarketProfile?.teams &&
      !Object.values(existingMarketProfile.teams || {}).some((team) => team?.historicalStats?.statsRows);
    const missingHistoricalTeamForm =
      existingMarketProfile?.teams &&
      !Object.values(existingMarketProfile.teams || {}).some(
        (team) => Array.isArray(team?.recentMatches) && team.recentMatches.length
      );
    if (
      !existingMarketProfile ||
      missingHistoricalStats ||
      missingHistoricalTeamForm ||
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

  for (const leagueLabel of allActiveLeagueLabels) {
    const existingOpenFootballProfile = store.openfootballProfiles[leagueLabel] || null;
    const missingOpenFootballTeamForm =
      existingOpenFootballProfile?.h2hPairs &&
      !Object.values(existingOpenFootballProfile.teams || {}).some(
        (team) => Array.isArray(team?.recentMatches) && team.recentMatches.length
      );
    if (
      OPENFOOTBALL_COMPETITIONS[leagueLabel] &&
      (!store.openfootballProfiles[leagueLabel] ||
        missingOpenFootballTeamForm ||
        now - Number(store.openfootballProfilesUpdated?.[leagueLabel] || 0) > OPENFOOTBALL_TTL)
    ) {
      const openfootballProfile = await fetchOpenfootballProfile(leagueLabel, today);
      if (openfootballProfile) {
        store.openfootballProfiles[leagueLabel] = openfootballProfile;
        store.openfootballProfilesUpdated[leagueLabel] = now;
        await sleep(40);
      }
    }

    if (
      UNDERSTAT_LEAGUE_CODES[leagueLabel] &&
      (!store.understatSnapshots[leagueLabel] ||
        now - Number(store.understatSnapshotsUpdated?.[leagueLabel] || 0) > SNAPSHOT_TTL)
    ) {
      const understatSnapshot = await fetchUnderstatSnapshot(leagueLabel, today);
      if (understatSnapshot) {
        store.understatSnapshots[leagueLabel] = understatSnapshot;
        store.understatSnapshotsUpdated[leagueLabel] = now;
        await sleep(80);
      }
    }

    if (
      FBREF_RELEASE_CODES[leagueLabel] &&
      (!store.fbrefSnapshots[leagueLabel] ||
        now - Number(store.fbrefSnapshotsUpdated?.[leagueLabel] || 0) > SNAPSHOT_TTL)
    ) {
      const fbrefSnapshot = await fetchFbrefSnapshot(leagueLabel, today);
      if (fbrefSnapshot) {
        store.fbrefSnapshots[leagueLabel] = fbrefSnapshot;
        store.fbrefSnapshotsUpdated[leagueLabel] = now;
        await sleep(80);
      }
    }
  }

  const globalRefereeArchive = mergeRefereeArchives(Object.values(store.marketProfiles || {}));

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
      store.teamInjuries[teamId] = await fetchInjuries(teamId, teamTournamentMap.get(teamId) || {});
      store.teamInjuriesUpdated[teamId] = now;
      await sleep(70);
    }
    const seasonInfo = teamTournamentMap.get(teamId);
    if (seasonInfo) {
      const existingSeasonStats = store.teamSeasonStats[teamId] || null;
      const seasonStatsStale =
        !existingSeasonStats || now - Number(store.teamSeasonStatsUpdated?.[teamId] || 0) > SEASON_TTL;
      const hasSnapshotMatch = Boolean(
        lookupSnapshotTeam(store.understatSnapshots?.[seasonInfo.label], seasonInfo.teamName) ||
          lookupSnapshotTeam(store.fbrefSnapshots?.[seasonInfo.label], seasonInfo.teamName)
      );
      const existingSources = Array.isArray(existingSeasonStats?.externalSources)
        ? existingSeasonStats.externalSources.map((source) => String(source).toLowerCase())
        : [];
      const missingSnapshotMerge =
        hasSnapshotMatch && !existingSources.some((source) => source === "understat" || source === "fbref");

      if (seasonStatsStale || missingSnapshotMerge) {
        const baseSeasonStats = seasonStatsStale
          ? await fetchSeasonStats(teamId, seasonInfo.tournamentId, seasonInfo.seasonId)
          : existingSeasonStats;
        store.teamSeasonStats[teamId] = mergeSeasonStatsWithSnapshots(
          baseSeasonStats,
          seasonInfo.teamName,
          seasonInfo.label,
          store
        );
        store.teamSeasonStatsUpdated[teamId] = now;
        if (seasonStatsStale) await sleep(70);
      }
    }
  }

  const standingsByTournament = {};
  for (const [key, info] of tournamentsMap.entries()) {
    if (!isStandingLeagueLabel(info.label)) continue;
    const cached = store.standings[key];
    const cachedIsOverlay = String(cached?.source || "").includes("live-match-overlay");
    if (cached?.rows?.length && !cachedIsOverlay && now - Number(cached.updated || 0) <= STANDINGS_TTL) {
      standingsByTournament[key] = cached;
      continue;
    }
    const fresh = await fetchStandings(info.tournamentId, info.seasonId, info.label, today);
    if (fresh) {
      store.standings[key] = fresh;
      store.standings[`label:${info.label}`] = fresh;
      standingsByTournament[key] = fresh;
      standingsByTournament[`label:${info.label}`] = fresh;
      await sleep(60);
    }
  }

  for (const leagueLabel of allActiveLeagueLabels.filter(isStandingLeagueLabel)) {
    const labelKey = `label:${leagueLabel}`;
    const cached = store.standings[labelKey];
    const cachedIsOverlay = String(cached?.source || "").includes("live-match-overlay");
    if (cached?.rows?.length && !cachedIsOverlay && now - Number(cached.updated || 0) <= STANDINGS_TTL) {
      standingsByTournament[labelKey] = cached;
      continue;
    }
    const fresh = await fetchStandings(null, null, leagueLabel, today);
    if (fresh) {
      store.standings[labelKey] = fresh;
      standingsByTournament[labelKey] = fresh;
      await sleep(40);
    }
  }

  for (const date of dates) {
    const dayMatches = [];
    const dayPredictions = [];

    for (const event of allEvents[date] || []) {
      const leagueInfo = getLeagueInfo(event);
      if (!leagueInfo) continue;
      const isFallbackEvent = String(event?.source || "").includes("fallback");

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
      const labelStandingKey = `label:${leagueInfo.label}`;
      const standing = standingsByTournament[standingsKey] || store.standings[standingsKey] || standingsByTournament[labelStandingKey] || store.standings[labelStandingKey] || null;
      const standingMeta = standing?.meta || null;
      const homeStandingRow = findStandingRow(standing, homeId, homeName);
      const awayStandingRow = findStandingRow(standing, awayId, awayName);
      const homePos = homeStandingRow?.pos ?? null;
      const awayPos = awayStandingRow?.pos ?? null;

      getTeam(store.teams, homeId, homeName);
      getTeam(store.teams, awayId, awayName);

      let eventDetails = isFallbackEvent ? null : store.eventCache?.[event.id] || null;
      if (!isFallbackEvent && (!eventDetails || now - Number(store.eventCacheUpdated?.[event.id] || 0) > EVENT_TTL)) {
        eventDetails = await fetchEventDetails(event.id);
        if (eventDetails) {
          store.eventCache[event.id] = eventDetails;
          store.eventCacheUpdated[event.id] = now;
        }
        await sleep(60);
      }

      const lineupSummary = isFallbackEvent ? null : await fetchLineupSummary(event.id);

      const h2hKey = `${event.id}_${homeId}_${awayId}`;
      let h2h = isFallbackEvent ? null : store.h2hCache?.[h2hKey]?.data || null;
      if (!isFallbackEvent && (!h2h || now - Number(store.h2hCache?.[h2hKey]?.updated || 0) > H2H_TTL)) {
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

      const leagueMarketProfile = store.marketProfiles[leagueInfo.label] || null;
      const openFootballProfile = store.openfootballProfiles[leagueInfo.label] || null;
      const globalTeamFormProfiles = [
        ...Object.values(store.marketProfiles || {}),
        ...Object.values(store.openfootballProfiles || {}),
      ];
      let homeRecent = mergeTeamFormWithHistorical(
        store.teamStats[homeId] || null,
        leagueMarketProfile,
        openFootballProfile,
        homeName,
        globalTeamFormProfiles
      );
      let awayRecent = mergeTeamFormWithHistorical(
        store.teamStats[awayId] || null,
        leagueMarketProfile,
        openFootballProfile,
        awayName,
        globalTeamFormProfiles
      );
      if (homeId && (homeRecent?.recentMatches || []).length > (store.teamStats[homeId]?.recentMatches || []).length) {
        store.teamStats[homeId] = homeRecent;
        store.teamStatsUpdated[homeId] = now;
      }
      if (awayId && (awayRecent?.recentMatches || []).length > (store.teamStats[awayId]?.recentMatches || []).length) {
        store.teamStats[awayId] = awayRecent;
        store.teamStatsUpdated[awayId] = now;
      }
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
      const aggregatePreviousLeg = buildH2HFromAggregateMeta(event, homeId, awayId, homeName, awayName, date);
      const h2hFallbackLegs = [fallbackPreviousLeg, aggregatePreviousLeg].filter(Boolean);
      h2h = buildH2HAgentProfile({
        baseH2H: h2h,
        fallbackLegs: h2hFallbackLegs,
        marketProfile: leagueMarketProfile,
        openFootballProfile,
        homeName,
        awayName,
        homeId,
        awayId,
      });
      homeRecent = supplementTeamFormWithH2H(homeRecent, h2h, homeName);
      awayRecent = supplementTeamFormWithH2H(awayRecent, h2h, awayName);
      if (homeId && (homeRecent?.recentMatches || []).length > (store.teamStats[homeId]?.recentMatches || []).length) {
        store.teamStats[homeId] = homeRecent;
        store.teamStatsUpdated[homeId] = now;
      }
      if (awayId && (awayRecent?.recentMatches || []).length > (store.teamStats[awayId]?.recentMatches || []).length) {
        store.teamStats[awayId] = awayRecent;
        store.teamStatsUpdated[awayId] = now;
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
      const homeMarketProfile = lookupMarketTeamProfile(leagueMarketProfile, homeName);
      const awayMarketProfile = lookupMarketTeamProfile(leagueMarketProfile, awayName);
      const homeLearning = store.teamLearning[homeId ? `id:${homeId}` : `name:${normalizeName(homeName)}`] || null;
      const awayLearning = store.teamLearning[awayId ? `id:${awayId}` : `name:${normalizeName(awayName)}`] || null;
      const leagueReliability = store.leagueReliability?.[leagueInfo.label] || null;
      const roundLabel = extractRoundLabel(eventDetails);
      const phaseBucket = getReliabilityBucket({
        league: leagueInfo.label,
        leagueType: leagueInfo.type,
        aggregate,
        context,
        roundLabel,
      });
      const phaseReliability = store.phaseReliability?.[phaseBucket] || null;

      const minuteState = resolveMinuteState(event, eventDetails);
      const homeSeasonStats = mergeSeasonStatsWithSnapshots(
        store.teamSeasonStats[homeId] || null,
        homeName,
        leagueInfo.label,
        store
      );
      const awaySeasonStats = mergeSeasonStatsWithSnapshots(
        store.teamSeasonStats[awayId] || null,
        awayName,
        leagueInfo.label,
        store
      );
      if (homeId && homeSeasonStats?.externalSources?.length) store.teamSeasonStats[homeId] = homeSeasonStats;
      if (awayId && awaySeasonStats?.externalSources?.length) store.teamSeasonStats[awayId] = awaySeasonStats;

      const homeTeamProfile = buildTeamProfile({
        teamName: homeName,
        recent: homeRecent,
        seasonStats: homeSeasonStats,
        injuries: store.teamInjuries[homeId] || null,
        clubElo: homeClubElo,
        standingPos: homePos,
      });
      const awayTeamProfile = buildTeamProfile({
        teamName: awayName,
        recent: awayRecent,
        seasonStats: awaySeasonStats,
        injuries: store.teamInjuries[awayId] || null,
        clubElo: awayClubElo,
        standingPos: awayPos,
      });
      const referee = extractReferee(eventDetails);
      const historicalRefereeProfile = lookupHistoricalRefereeProfile(leagueMarketProfile, referee?.name, globalRefereeArchive);
      let supplementalOdds = null;
      if (
        !isFallbackEvent &&
        (
          String(leagueInfo.label || "").toLowerCase().includes("qualification") ||
          String(leagueInfo.label || "").toLowerCase().includes("friendly") ||
          String(leagueInfo.label || "").toLowerCase().includes("international")
        )
      ) {
        supplementalOdds = await fetchEventBookmakerOdds(event.id);
      }
      const marketCalibration = buildMarketCalibration({
        homeMarketProfile,
        awayMarketProfile,
        homeTeamProfile,
        awayTeamProfile,
        leagueMarketProfile,
        supplementalOdds,
      });
      const refereeProfile = buildRefereeProfile(
        referee,
        homeRecent,
        awayRecent,
        marketCalibration,
        historicalRefereeProfile
      );

      const prediction = predict({
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeTeamName: homeName,
        awayTeamName: awayName,
        homeRecent,
        awayRecent,
        homeSeasonStats,
        awaySeasonStats,
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
        homeStandingPos: homePos,
        awayStandingPos: awayPos,
        standingTotalTeams: standing?.rows?.length || 20,
        matchImportance,
        homeMarketProfile,
        awayMarketProfile,
        homeLearning,
        awayLearning,
        leagueReliability,
        phaseReliability,
        marketCalibration,
        refereeProfile,
      });

      const matchId = `ss-${event.id}`;
      const score =
        event.homeScore?.current != null && event.awayScore?.current != null
          ? `${event.homeScore.current}-${event.awayScore.current}`
          : null;
      const homeScore = event.homeScore?.current != null ? Number(event.homeScore.current) : null;
      const awayScore = event.awayScore?.current != null ? Number(event.awayScore.current) : null;
      const appStatus = inferPostKickoffStatus(event, resolveAppStatus(event), score, now);
      const match = {
        id: matchId,
        sofaId: event.id,
        dataSource: String(event.source || "sofascore"),
        date,
        kickoff,
        league: leagueInfo.label,
        homeTeamId: homeId,
        awayTeamId: awayId,
        homeTeamName: homeName,
        awayTeamName: awayName,
        homeLogo: resolveTeamLogoUrl(event.homeTeam, homeId, homeName, event.source),
        awayLogo: resolveTeamLogoUrl(event.awayTeam, awayId, awayName, event.source),
        status: appStatus,
        score,
        homeScore,
        awayScore,
        minute: minuteState.minute,
        minuteValue: minuteState.minuteValue,
        extraTime: minuteState.extraTime,
        period: minuteState.period,
        liveUpdatedAt: appStatus === "LIVE" || appStatus === "HT" ? now : null,
        homeForm: homeRecent?.form || "",
        awayForm: awayRecent?.form || "",
        homeRecent,
        awayRecent,
        homeSeasonStats,
        awaySeasonStats,
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
        phaseReliability: prediction.modelEdges?.phaseReliability || null,
        refereeProfile: prediction.modelEdges?.refereeProfile || refereeProfile || null,
        aggregate,
        homeClubElo,
        awayClubElo,
        homePos,
        awayPos,
        matchImportance,
        roundLabel,
        context,
        modelEdges: prediction.modelEdges,
      };

      dayMatches.push(match);
      dayPredictions.push({
        matchId,
        dataSource: String(event.source || "sofascore"),
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
        phaseReliability: prediction.modelEdges?.phaseReliability || null,
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
          roundLabel,
          stakes: context.stakes,
          matchId,
          kickoff,
          homeTeamName: homeName,
          awayTeamName: awayName,
          aggregate,
          score,
          status: appStatus,
        };

        store.knockoutOverview[date].push(knockoutItem);

        if (!store.cupSheets[leagueInfo.label]) {
          store.cupSheets[leagueInfo.label] = {
            league: leagueInfo.label,
            rounds: {},
          };
        }
        const roundKey = String(roundLabel || "Knock-out");
        if (!store.cupSheets[leagueInfo.label].rounds[roundKey]) {
          store.cupSheets[leagueInfo.label].rounds[roundKey] = [];
        }
        store.cupSheets[leagueInfo.label].rounds[roundKey].push(knockoutItem);
      }

      await sleep(40);
    }

    assignTopConfidenceRanks(dayMatches, dayPredictions);
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
    const liveStatus = resolveAppStatus(live);

    match.status = liveStatus === "NS" ? "LIVE" : liveStatus;
    match.score =
      live.homeScore?.current != null && live.awayScore?.current != null
        ? `${live.homeScore.current}-${live.awayScore.current}`
        : match.score;
    match.minute = minuteState.minute || match.minute;
    match.minuteValue = minuteState.minuteValue || match.minuteValue || null;
    match.extraTime = minuteState.extraTime || null;
    match.period = minuteState.period || match.period || null;
    match.liveUpdatedAt = match.status === "LIVE" || match.status === "HT" ? Date.now() : match.liveUpdatedAt;
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

  applyLiveStandingsOverlay(store);
  compactStore(store, today, now);
  rebuildReviewsAndLearning(store);
  store.sourceCoverage = buildSourceCoverage(store, today);
  store.dataScout = buildDataScoutReport(store, today);
  store.aiAdvice = buildAiRecommendations(store, today);
  store.lastRun = Date.now();
  store.workerVersion = "v18-score-data-scout";
  
  // Log summary
  const totalMatches = Object.values(store.matches || {}).flat().length;
  console.log(`[worker] Totaal ${totalMatches} wedstrijden opgeslagen`);
  console.log(`[worker] Vandaag: ${(store.matches?.[today] || []).length} wedstrijden`);
  console.log(`[worker] Morgen: ${(store.matches?.[tomorrow] || []).length} wedstrijden`);
  
  fs.mkdirSync(path.dirname(TRAINING_SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(TRAINING_SNAPSHOT_FILE, JSON.stringify(buildTrainingSnapshot(store)));
  fs.writeFileSync(DATA_FILE, JSON.stringify(store));
  console.log("[worker] klaar");
}

main();




