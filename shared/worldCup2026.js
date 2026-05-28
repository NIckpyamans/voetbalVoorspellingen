const WORLD_CUP_LEAGUE = "World - FIFA World Cup 2026";
const WORLD_FRIENDLY_LEAGUE = "World - International Friendly";

const SOURCE = {
  name: "FIFA official match schedule, Sky Sports day-by-day schedule",
  fifaScheduleUrl:
    "https://digitalhub.fifa.com/m/1be9ce37eb98fcc5/original/FWC26-Match-Schedule_English.pdf",
  skyScheduleUrl:
    "https://www.skysports.com/football/news/11095/13481245/world-cup-2026-fixture-schedule-and-uk-kick-off-times-day-by-day-breakdown-of-all-104-matches-including-england-scotland",
  verifiedAt: "2026-05-28",
  note:
    "Fixtures, groups, dates and venues are seeded from published schedules. Squads, player form, injuries and friendly results must come from live providers before kickoff.",
};

const TEAMS = {
  MEX: { name: "Mexico", group: "A", strength: 74, host: true },
  RSA: { name: "South Africa", group: "A", strength: 63 },
  KOR: { name: "South Korea", group: "A", strength: 72 },
  CZE: { name: "Czech Republic", group: "A", strength: 73 },
  CAN: { name: "Canada", group: "B", strength: 70, host: true },
  BIH: { name: "Bosnia & Herzegovina", group: "B", strength: 68 },
  QAT: { name: "Qatar", group: "B", strength: 66 },
  SUI: { name: "Switzerland", group: "B", strength: 78 },
  BRA: { name: "Brazil", group: "C", strength: 88 },
  MAR: { name: "Morocco", group: "C", strength: 80 },
  HAI: { name: "Haiti", group: "C", strength: 58 },
  SCO: { name: "Scotland", group: "C", strength: 72 },
  USA: { name: "USA", group: "D", strength: 76, host: true },
  PAR: { name: "Paraguay", group: "D", strength: 72 },
  AUS: { name: "Australia", group: "D", strength: 71 },
  TUR: { name: "Turkey", group: "D", strength: 77 },
  GER: { name: "Germany", group: "E", strength: 84 },
  CUW: { name: "Curacao", group: "E", strength: 59 },
  CIV: { name: "Ivory Coast", group: "E", strength: 75 },
  ECU: { name: "Ecuador", group: "E", strength: 77 },
  NED: { name: "Netherlands", group: "F", strength: 85 },
  JPN: { name: "Japan", group: "F", strength: 78 },
  SWE: { name: "Sweden", group: "F", strength: 76 },
  TUN: { name: "Tunisia", group: "F", strength: 70 },
  BEL: { name: "Belgium", group: "G", strength: 82 },
  EGY: { name: "Egypt", group: "G", strength: 75 },
  IRN: { name: "Iran", group: "G", strength: 74 },
  NZL: { name: "New Zealand", group: "G", strength: 61 },
  ESP: { name: "Spain", group: "H", strength: 89 },
  CPV: { name: "Cape Verde", group: "H", strength: 65 },
  KSA: { name: "Saudi Arabia", group: "H", strength: 68 },
  URU: { name: "Uruguay", group: "H", strength: 83 },
  FRA: { name: "France", group: "I", strength: 88 },
  SEN: { name: "Senegal", group: "I", strength: 78 },
  IRQ: { name: "Iraq", group: "I", strength: 67 },
  NOR: { name: "Norway", group: "I", strength: 77 },
  ARG: { name: "Argentina", group: "J", strength: 88 },
  ALG: { name: "Algeria", group: "J", strength: 74 },
  AUT: { name: "Austria", group: "J", strength: 78 },
  JOR: { name: "Jordan", group: "J", strength: 63 },
  POR: { name: "Portugal", group: "K", strength: 86 },
  COD: { name: "DR Congo", group: "K", strength: 70 },
  UZB: { name: "Uzbekistan", group: "K", strength: 68 },
  COL: { name: "Colombia", group: "K", strength: 80 },
  ENG: { name: "England", group: "L", strength: 87 },
  CRO: { name: "Croatia", group: "L", strength: 79 },
  GHA: { name: "Ghana", group: "L", strength: 72 },
  PAN: { name: "Panama", group: "L", strength: 67 },
};

const FIXTURE_ROWS = [
  "1|2026-06-11|20:00|A|Mexico|South Africa|Mexico City, Mexico",
  "2|2026-06-12|03:00|A|South Korea|Czech Republic|Zapopan, Mexico",
  "3|2026-06-12|20:00|B|Canada|Bosnia & Herzegovina|Toronto, Canada",
  "4|2026-06-13|02:00|D|USA|Paraguay|Los Angeles, USA",
  "8|2026-06-13|20:00|B|Qatar|Switzerland|Santa Clara, USA",
  "7|2026-06-13|23:00|C|Brazil|Morocco|New Jersey, USA",
  "5|2026-06-14|02:00|C|Haiti|Scotland|Foxborough, USA",
  "6|2026-06-14|05:00|D|Australia|Turkey|Vancouver, Canada",
  "10|2026-06-14|18:00|E|Germany|Curacao|Houston, USA",
  "11|2026-06-14|21:00|F|Netherlands|Japan|Arlington, USA",
  "9|2026-06-15|00:00|E|Ivory Coast|Ecuador|Philadelphia, USA",
  "12|2026-06-15|03:00|F|Sweden|Tunisia|Guadalupe, Mexico",
  "14|2026-06-15|17:00|H|Spain|Cape Verde|Atlanta, USA",
  "16|2026-06-15|20:00|G|Belgium|Egypt|Seattle, USA",
  "13|2026-06-15|23:00|H|Saudi Arabia|Uruguay|Miami, USA",
  "15|2026-06-16|02:00|G|Iran|New Zealand|Los Angeles, USA",
  "17|2026-06-16|20:00|I|France|Senegal|New Jersey, USA",
  "18|2026-06-16|23:00|I|Iraq|Norway|Foxborough, USA",
  "19|2026-06-17|02:00|J|Argentina|Algeria|Kansas City, USA",
  "20|2026-06-17|05:00|J|Austria|Jordan|Santa Clara, USA",
  "23|2026-06-17|18:00|K|Portugal|DR Congo|Houston, USA",
  "22|2026-06-17|21:00|L|England|Croatia|Arlington, USA",
  "21|2026-06-18|00:00|L|Ghana|Panama|Toronto, Canada",
  "24|2026-06-18|03:00|K|Uzbekistan|Colombia|Mexico City, Mexico",
  "25|2026-06-18|17:00|A|Czech Republic|South Africa|Atlanta, USA",
  "26|2026-06-18|20:00|B|Switzerland|Bosnia & Herzegovina|Los Angeles, USA",
  "27|2026-06-18|23:00|B|Canada|Qatar|Vancouver, Canada",
  "28|2026-06-19|02:00|A|Mexico|South Korea|Zapopan, Mexico",
  "32|2026-06-19|20:00|D|USA|Australia|Seattle, USA",
  "30|2026-06-19|23:00|C|Scotland|Morocco|Foxborough, USA",
  "29|2026-06-20|01:30|C|Brazil|Haiti|Philadelphia, USA",
  "31|2026-06-20|04:00|D|Turkey|Paraguay|Santa Clara, USA",
  "35|2026-06-20|18:00|F|Netherlands|Sweden|Houston, USA",
  "33|2026-06-20|21:00|E|Germany|Ivory Coast|Toronto, Canada",
  "34|2026-06-21|01:00|E|Ecuador|Curacao|Kansas City, USA",
  "36|2026-06-21|05:00|F|Tunisia|Japan|Guadalupe, Mexico",
  "38|2026-06-21|17:00|H|Spain|Saudi Arabia|Atlanta, USA",
  "39|2026-06-21|20:00|G|Belgium|Iran|Los Angeles, USA",
  "37|2026-06-21|23:00|H|Uruguay|Cape Verde|Miami, USA",
  "40|2026-06-22|02:00|G|New Zealand|Egypt|Vancouver, Canada",
  "43|2026-06-22|18:00|J|Argentina|Austria|Arlington, USA",
  "42|2026-06-22|22:00|I|France|Iraq|Philadelphia, USA",
  "41|2026-06-23|01:00|I|Norway|Senegal|Toronto, Canada",
  "44|2026-06-23|04:00|J|Jordan|Algeria|Santa Clara, USA",
  "47|2026-06-23|18:00|K|Portugal|Uzbekistan|Houston, USA",
  "45|2026-06-23|21:00|L|England|Ghana|Foxborough, USA",
  "46|2026-06-24|00:00|L|Panama|Croatia|Foxborough, USA",
  "48|2026-06-24|03:00|K|Colombia|DR Congo|Zapopan, Mexico",
  "51|2026-06-24|20:00|B|Switzerland|Canada|Vancouver, Canada",
  "52|2026-06-24|20:00|B|Bosnia & Herzegovina|Qatar|Seattle, USA",
  "50|2026-06-24|23:00|C|Morocco|Haiti|Atlanta, USA",
  "49|2026-06-24|23:00|C|Scotland|Brazil|Miami, USA",
  "54|2026-06-25|02:00|A|South Africa|South Korea|Guadalupe, Mexico",
  "53|2026-06-25|02:00|A|Czech Republic|Mexico|Mexico City, Mexico",
  "55|2026-06-25|21:00|E|Curacao|Ivory Coast|Philadelphia, USA",
  "56|2026-06-25|21:00|E|Ecuador|Germany|New Jersey, USA",
  "58|2026-06-26|00:00|F|Tunisia|Netherlands|Kansas City, USA",
  "57|2026-06-26|00:00|F|Japan|Sweden|Arlington, USA",
  "59|2026-06-26|03:00|D|Turkey|USA|Los Angeles, USA",
  "60|2026-06-26|03:00|D|Paraguay|Australia|Santa Clara, USA",
  "61|2026-06-26|20:00|I|Norway|France|Foxborough, USA",
  "62|2026-06-26|20:00|I|Senegal|Iraq|Toronto, Canada",
  "65|2026-06-27|01:00|H|Cape Verde|Saudi Arabia|Houston, USA",
  "66|2026-06-27|01:00|H|Uruguay|Spain|Zapopan, Mexico",
  "64|2026-06-27|04:00|G|New Zealand|Belgium|Vancouver, Canada",
  "63|2026-06-27|04:00|G|Egypt|Iran|Seattle, USA",
  "67|2026-06-27|22:00|L|Panama|England|New Jersey, USA",
  "68|2026-06-27|22:00|L|Croatia|Ghana|Philadelphia, USA",
  "71|2026-06-28|00:30|K|Colombia|Portugal|Miami, USA",
  "72|2026-06-28|00:30|K|DR Congo|Uzbekistan|Atlanta, USA",
  "69|2026-06-28|03:00|J|Algeria|Austria|Kansas City, USA",
  "70|2026-06-28|03:00|J|Jordan|Argentina|Arlington, USA",
  "73|2026-06-28|20:00|Round of 32|Runner-up Group A|Runner-up Group B|Los Angeles, USA",
  "76|2026-06-29|18:00|Round of 32|Winner Group C|Runner-up Group F|Houston, USA",
  "74|2026-06-29|21:30|Round of 32|Winner Group E|Third-place Group A/B/C/D/F|Foxborough, USA",
  "75|2026-06-30|02:00|Round of 32|Winner Group F|Runner-up Group C|Guadalupe, Mexico",
  "78|2026-06-30|18:00|Round of 32|Runner-up Group E|Runner-up Group I|Arlington, USA",
  "77|2026-06-30|22:00|Round of 32|Winner Group I|Third-place Group C/D/F/G/H|New Jersey, USA",
  "79|2026-07-01|02:00|Round of 32|Winner Group A|Third-place Group C/E/F/H/I|Mexico City, Mexico",
  "80|2026-07-01|17:00|Round of 32|Winner Group L|Third-place Group E/H/I/J/K|Atlanta, USA",
  "82|2026-07-01|21:00|Round of 32|Winner Group G|Third-place Group A/E/H/I/J|Seattle, USA",
  "81|2026-07-02|01:00|Round of 32|Winner Group D|Third-place Group B/E/F/I/J|Santa Clara, USA",
  "84|2026-07-02|20:00|Round of 32|Winner Group H|Runner-up Group J|Los Angeles, USA",
  "83|2026-07-03|00:00|Round of 32|Runner-up Group K|Runner-up Group L|Toronto, Canada",
  "85|2026-07-03|04:00|Round of 32|Winner Group B|Third-place Group E/F/G/I/J|Vancouver, Canada",
  "88|2026-07-03|19:00|Round of 32|Runner-up Group D|Runner-up Group G|Arlington, USA",
  "86|2026-07-03|23:00|Round of 32|Winner Group J|Runner-up Group H|Miami, USA",
  "87|2026-07-04|02:30|Round of 32|Winner Group K|Third-place Group D/E/I/J/L|Kansas City, USA",
  "90|2026-07-04|18:00|Round of 16|Winner Match 73|Winner Match 75|Houston, USA",
  "89|2026-07-04|22:00|Round of 16|Winner Match 74|Winner Match 77|Philadelphia, USA",
  "91|2026-07-05|21:00|Round of 16|Winner Match 76|Winner Match 78|New Jersey, USA",
  "92|2026-07-06|01:00|Round of 16|Winner Match 79|Winner Match 80|Mexico City, Mexico",
  "93|2026-07-06|20:00|Round of 16|Winner Match 83|Winner Match 84|Arlington, USA",
  "94|2026-07-07|01:00|Round of 16|Winner Match 81|Winner Match 82|Seattle, USA",
  "95|2026-07-07|17:00|Round of 16|Winner Match 86|Winner Match 88|Atlanta, USA",
  "96|2026-07-07|21:00|Round of 16|Winner Match 85|Winner Match 87|Vancouver, Canada",
  "97|2026-07-09|21:00|Quarter-final|Winner Match 89|Winner Match 90|Foxborough, USA",
  "98|2026-07-10|20:00|Quarter-final|Winner Match 93|Winner Match 94|Los Angeles, USA",
  "99|2026-07-11|22:00|Quarter-final|Winner Match 91|Winner Match 92|Miami, USA",
  "100|2026-07-12|02:00|Quarter-final|Winner Match 95|Winner Match 96|Kansas City, USA",
  "101|2026-07-14|20:00|Semi-final|Winner Match 97|Winner Match 98|Arlington, USA",
  "102|2026-07-15|20:00|Semi-final|Winner Match 99|Winner Match 100|Atlanta, USA",
  "103|2026-07-18|22:00|Third Place Playoff|Loser Match 101|Loser Match 102|Miami, USA",
  "104|2026-07-19|20:00|Final|Winner Match 101|Winner Match 102|New Jersey, USA",
];

const TEAM_BY_NAME = new Map(
  Object.entries(TEAMS).map(([code, team]) => [normalizeTeamName(team.name), { code, ...team }])
);

function normalizeTeamName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseFixtureRow(row) {
  const [matchNumber, date, ukTime, group, home, away, venue] = row.split("|");
  return {
    matchNumber: Number(matchNumber),
    date,
    ukTime,
    group,
    home,
    away,
    venue,
  };
}

function ukKickoffToIso(dateKey, time) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 1, minute)).toISOString();
}

function toCode(name) {
  return TEAM_BY_NAME.get(normalizeTeamName(name))?.code || null;
}

function isGroupFixture(fixture) {
  return /^[A-L]$/.test(fixture.group);
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildPrediction(match) {
  const home = TEAM_BY_NAME.get(normalizeTeamName(match.homeTeamName));
  const away = TEAM_BY_NAME.get(normalizeTeamName(match.awayTeamName));
  const isPlayable = !!home && !!away;
  const homeStrength = Number(home?.strength || 70) + (home?.host ? 2 : 0);
  const awayStrength = Number(away?.strength || 70) + (away?.host ? 2 : 0);
  const diff = homeStrength - awayStrength;
  const homeWin = clamp(sigmoid(diff / 11) * 0.68, 0.18, 0.72);
  const awayWin = clamp(sigmoid(-diff / 11) * 0.68, 0.18, 0.72);
  const draw = isPlayable ? clamp(0.29 - Math.min(Math.abs(diff), 24) * 0.004, 0.18, 0.31) : 0.27;
  const total = homeWin + draw + awayWin;
  const homeProb = Number((homeWin / total).toFixed(3));
  const drawProb = Number((draw / total).toFixed(3));
  const awayProb = Number((awayWin / total).toFixed(3));
  const homeXG = isPlayable ? clamp(1.25 + diff / 32 + (home?.host ? 0.1 : 0), 0.45, 2.65) : 1.1;
  const awayXG = isPlayable ? clamp(1.15 - diff / 34 + (away?.host ? 0.1 : 0), 0.45, 2.55) : 1.1;
  const predHomeGoals = Math.max(0, Math.round(homeXG));
  const predAwayGoals = Math.max(0, Math.round(awayXG));

  return {
    matchId: match.id,
    predictionId: `wk2026-seed-${match.matchNumber}`,
    date: match.date,
    dataSource: "world-cup-2026-fixture-seed",
    homeTeam: match.homeTeamName,
    awayTeam: match.awayTeamName,
    league: match.league,
    predHomeGoals,
    predAwayGoals,
    homeProb,
    drawProb,
    awayProb,
    homeXG: Number(homeXG.toFixed(2)),
    awayXG: Number(awayXG.toFixed(2)),
    btts: Number((Math.min(homeXG, awayXG) / 2.1).toFixed(3)),
    over25: Number((clamp((homeXG + awayXG - 1.8) / 2.2, 0.2, 0.72)).toFixed(3)),
    confidence: isPlayable ? Number(Math.max(homeProb, drawProb, awayProb).toFixed(3)) : 0.42,
    exactProb: isPlayable ? 0.11 : 0.06,
    modelVersion: "wk2026-seed-country-strength-v1",
    featureSchemaVersion: "wk2026-fixture-seed-v1",
    generatedAt: SOURCE.verifiedAt,
    cutoffAt: SOURCE.verifiedAt,
    dataCompletenessScore: isPlayable ? 0.44 : 0.18,
    dataCompleteness: {
      score: isPlayable ? 0.44 : 0.18,
      missing: [
        "official_final_squad_snapshot",
        "current_player_top_form",
        "injuries_suspensions",
        "confirmed_lineups",
        "live_odds_closing_odds",
        "recent_friendlies_provider_feed",
      ],
      available: ["official_fixture", "official_group", "venue", "country_strength_seed"],
    },
    modelEdges: {
      model: "wk2026-seed-country-strength-v1",
      riskProfile: isPlayable ? "middel" : "hoog",
      modelAgreement: isPlayable ? 0.46 : 0.18,
      clubEloDiff: diff,
      dataCompleteness: {
        score: isPlayable ? 0.44 : 0.18,
        status: isPlayable ? "fixture_seed_needs_live_enrichment" : "knockout_placeholder",
      },
      teamAiSummary: {
        home: {
          teamName: match.homeTeamName,
          strengths: isPlayable ? [`landensterkte ${homeStrength}`] : [],
          risks: ["selectie en actuele spelersvorm nog live koppelen"],
          summary: isPlayable
            ? `${match.homeTeamName}: seed op landensterkte; selectie/topvorm nog niet bevestigd.`
            : "Knock-out placeholder: teams pas bekend na groepsfase.",
        },
        away: {
          teamName: match.awayTeamName,
          strengths: isPlayable ? [`landensterkte ${awayStrength}`] : [],
          risks: ["selectie en actuele spelersvorm nog live koppelen"],
          summary: isPlayable
            ? `${match.awayTeamName}: seed op landensterkte; selectie/topvorm nog niet bevestigd.`
            : "Knock-out placeholder: teams pas bekend na groepsfase.",
        },
      },
      leakageGuard: {
        snapshotStatus: "pre_tournament_seed",
        cutoffBeforeKickoff: true,
        risk: "low_for_fixture_seed_high_for_missing_player_context",
      },
    },
    worldCup2026: {
      source: SOURCE,
      matchNumber: match.matchNumber,
      group: match.group,
      squadStatus: "not_verified_in_app",
      playerTopFormStatus: "provider_required",
      friendlyCoverageStatus: "worker_will_collect_when_provider_has_fixtures",
    },
  };
}

function buildMatch(fixture) {
  const homeCode = toCode(fixture.home);
  const awayCode = toCode(fixture.away);
  const playable = !!homeCode && !!awayCode;
  const roundLabel = isGroupFixture(fixture) ? `Group ${fixture.group}` : fixture.group;
  const match = {
    id: `wk2026-${fixture.matchNumber}`,
    matchNumber: fixture.matchNumber,
    dataSource: "world-cup-2026-fixture-seed",
    date: fixture.date,
    kickoff: ukKickoffToIso(fixture.date, fixture.ukTime),
    league: WORLD_CUP_LEAGUE,
    homeTeamId: homeCode ? `country-${homeCode}` : `wk2026-placeholder-${fixture.matchNumber}-home`,
    awayTeamId: awayCode ? `country-${awayCode}` : `wk2026-placeholder-${fixture.matchNumber}-away`,
    homeTeamName: fixture.home,
    awayTeamName: fixture.away,
    homeLogo: "",
    awayLogo: "",
    status: "NS",
    score: null,
    homeForm: "",
    awayForm: "",
    homeClubElo: homeCode ? TEAMS[homeCode].strength * 20 : null,
    awayClubElo: awayCode ? TEAMS[awayCode].strength * 20 : null,
    homePos: null,
    awayPos: null,
    roundLabel,
    matchImportance: isGroupFixture(fixture) ? 1.18 : 1.45,
    phaseBucket: isGroupFixture(fixture) ? "world_cup_group" : "world_cup_knockout",
    leagueType: "international",
    venue: { name: fixture.venue },
    context: {
      type: isGroupFixture(fixture) ? "world_cup_group" : "world_cup_knockout",
      summary: isGroupFixture(fixture) ? `WK 2026 groep ${fixture.group}` : `WK 2026 ${fixture.group}`,
      stakes: isGroupFixture(fixture) ? "groepsfase, top 2 plus beste nummers 3" : "knock-out",
    },
    h2h: {
      played: 0,
      homeWins: 0,
      draws: 0,
      awayWins: 0,
      status: playable ? "not_seeded_provider_required" : "placeholder",
      results: [],
    },
    h2hStatus: playable ? "not_seeded_provider_required" : "placeholder",
    dataCompletenessScore: playable ? 0.44 : 0.18,
    dataCompleteness: {
      score: playable ? 0.44 : 0.18,
      missing: [
        "official_final_squad_snapshot",
        "current_player_top_form",
        "injuries_suspensions",
        "confirmed_lineups",
        "live_odds_closing_odds",
        "recent_friendlies_provider_feed",
      ],
    },
    worldCup2026: {
      source: SOURCE,
      matchNumber: fixture.matchNumber,
      group: fixture.group,
      homeCode,
      awayCode,
      squadStatus: "not_verified_in_app",
      playerTopFormStatus: "provider_required",
      previousMatchesStatus: "provider_required",
      friendlyCoverageStatus: "worker_will_collect_when_provider_has_fixtures",
    },
  };

  const prediction = buildPrediction(match);
  return {
    ...match,
    predictionId: prediction.predictionId,
    predictionGeneratedAt: prediction.generatedAt,
    predictionCutoffAt: prediction.cutoffAt,
    modelEdges: prediction.modelEdges,
    homeTeamProfile: {
      teamName: match.homeTeamName,
      countryStrength: homeCode ? TEAMS[homeCode].strength : null,
      squadStatus: match.worldCup2026.squadStatus,
      topFormStatus: match.worldCup2026.playerTopFormStatus,
    },
    awayTeamProfile: {
      teamName: match.awayTeamName,
      countryStrength: awayCode ? TEAMS[awayCode].strength : null,
      squadStatus: match.worldCup2026.squadStatus,
      topFormStatus: match.worldCup2026.playerTopFormStatus,
    },
  };
}

const FIXTURES = FIXTURE_ROWS.map(parseFixtureRow).map(buildMatch);
const PREDICTIONS = FIXTURES.map(buildPrediction);

function dateKeyFromValue(value) {
  return String(value || "").slice(0, 10);
}

export function isWorldCup2026League(league) {
  return String(league || "") === WORLD_CUP_LEAGUE;
}

export function isWorldCup2026Team(name) {
  return TEAM_BY_NAME.has(normalizeTeamName(name));
}

export function getWorldCup2026Teams() {
  return Object.entries(TEAMS).map(([code, team]) => ({ code, ...team }));
}

export function getWorldCup2026Fixtures() {
  return FIXTURES.map((match) => ({ ...match }));
}

export function buildWorldCup2026DayData(dateKey) {
  const matches = FIXTURES.filter((match) => dateKeyFromValue(match.date) === dateKey).map((match) => ({ ...match }));
  const matchIds = new Set(matches.map((match) => match.id));
  const predictions = PREDICTIONS.filter((prediction) => matchIds.has(prediction.matchId)).map((prediction) => ({ ...prediction }));
  return {
    ok: true,
    date: dateKey,
    matches,
    predictions,
    total: matches.length,
    source: matches.length ? "world-cup-2026-fixture-seed" : "none",
    worldCup2026: {
      league: WORLD_CUP_LEAGUE,
      friendlyLeague: WORLD_FRIENDLY_LEAGUE,
      fixtureCount: FIXTURES.length,
      teamCount: Object.keys(TEAMS).length,
      source: SOURCE,
      dataStatus: {
        fixtures: "available",
        countries: "available",
        countryStrength: "seeded",
        officialSquads: "not_verified_in_app",
        playerTopForm: "provider_required",
        previousMatches: "provider_required",
        friendlies: "provider_required",
      },
    },
  };
}

export { WORLD_CUP_LEAGUE, WORLD_FRIENDLY_LEAGUE };
