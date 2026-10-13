const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeOutcomeProbabilities(probabilities = {}) {
  const values = {
    homeProb: Math.max(0, Number(probabilities.homeProb || 0)),
    drawProb: Math.max(0, Number(probabilities.drawProb || 0)),
    awayProb: Math.max(0, Number(probabilities.awayProb || 0)),
  };
  const total = values.homeProb + values.drawProb + values.awayProb || 1;
  return {
    homeProb: Number((values.homeProb / total).toFixed(4)),
    drawProb: Number((values.drawProb / total).toFixed(4)),
    awayProb: Number((values.awayProb / total).toFixed(4)),
  };
}

// Power-methode: zoek exponent k met sum(q_i^k) = 1. In tegenstelling tot de
// proportionele methode haalt die de marge vooral bij de favorieten weg, zodat
// outsiders niet overgewaardeerd worden (favoriet-outsider-bias). Zonder
// marge (sum <= 1) valt het terug op proportioneel normaliseren.
export function powerDevig(impliedProbabilities = []) {
  const values = impliedProbabilities.map(Number);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!values.every((value) => Number.isFinite(value) && value > 0)) return null;
  if (total <= 1) return values.map((value) => value / total);
  let low = 1;
  let high = 10;
  for (let step = 0; step < 80; step += 1) {
    const middle = (low + high) / 2;
    const mass = values.reduce((sum, value) => sum + Math.pow(value, middle), 0);
    if (mass > 1) low = middle;
    else high = middle;
  }
  const exponent = (low + high) / 2;
  const raw = values.map((value) => Math.pow(value, exponent));
  const rawTotal = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / rawTotal);
}

export function devigThreeWayOdds(odds = {}, kickoff = null) {
  const home = Number(odds.home ?? odds.homeWin ?? 0);
  const draw = Number(odds.draw ?? 0);
  const away = Number(odds.away ?? odds.awayWin ?? 0);
  if (![home, draw, away].every((value) => Number.isFinite(value) && value > 1.01)) return null;

  const capturedAt = Date.parse(String(odds.capturedAt || odds.lastUpdated || ""));
  const kickoffAt = Date.parse(String(kickoff || ""));
  if (Number.isFinite(kickoffAt) && (!Number.isFinite(capturedAt) || capturedAt >= kickoffAt)) return null;

  const overround = 1 / home + 1 / draw + 1 / away;
  if (!Number.isFinite(overround) || overround <= 0) return null;
  const [homeProb, drawProb, awayProb] = powerDevig([1 / home, 1 / draw, 1 / away]);
  return {
    ...normalizeOutcomeProbabilities({ homeProb, drawProb, awayProb }),
    overround: Number(overround.toFixed(4)),
    bookmaker: odds.bookmaker || null,
    capturedAt: odds.capturedAt || odds.lastUpdated || null,
  };
}

export function buildMarketConsensus(odds = {}, kickoff = null) {
  const offers = [
    ...(Array.isArray(odds?.bookmakers) ? odds.bookmakers : []),
    ...(Array.isArray(odds?.offers) ? odds.offers : []),
    ...(Array.isArray(odds?.prematchOffers) ? odds.prematchOffers : []),
  ];
  if (!offers.length) offers.push(odds);
  const valid = offers.map((offer) => devigThreeWayOdds({ ...offer, capturedAt: offer?.capturedAt || odds?.capturedAt }, kickoff)).filter(Boolean);
  if (!valid.length) return null;
  const average = (key) => valid.reduce((sum, item) => sum + Number(item[key] || 0), 0) / valid.length;
  const probabilities = normalizeOutcomeProbabilities({
    homeProb: average("homeProb"),
    drawProb: average("drawProb"),
    awayProb: average("awayProb"),
  });
  const disagreement = valid.reduce((sum, item) => sum + ["homeProb", "drawProb", "awayProb"]
    .reduce((inner, key) => inner + Math.abs(Number(item[key]) - Number(probabilities[key])), 0) / 3, 0) / valid.length;
  const opening = devigThreeWayOdds({
    home: odds?.openingHome,
    draw: odds?.openingDraw,
    away: odds?.openingAway,
    capturedAt: odds?.openingCapturedAt,
  }, kickoff);
  return {
    ...probabilities,
    overround: Number(average("overround").toFixed(4)),
    bookmaker: valid.length === 1 ? valid[0].bookmaker : `${valid.length}-bookmaker-consensus`,
    bookmakers: valid.length,
    capturedAt: odds?.capturedAt || valid.map((item) => item.capturedAt).filter(Boolean).sort().at(-1) || null,
    disagreement: Number(disagreement.toFixed(4)),
    movement: opening ? {
      home: Number((probabilities.homeProb - opening.homeProb).toFixed(4)),
      draw: Number((probabilities.drawProb - opening.drawProb).toFixed(4)),
      away: Number((probabilities.awayProb - opening.awayProb).toFixed(4)),
      openingCapturedAt: opening.capturedAt,
    } : null,
  };
}

export function buildEloOutcomeModel(homeElo, awayElo, options = {}) {
  const home = Number(homeElo || 0);
  const away = Number(awayElo || 0);
  if (!(home > 0 && away > 0)) return null;
  // club_elo_scale tempert interland-duels waarin ClubElo slechts een proxy is
  // (clubelo_misread 141x): pas hier dezelfde tempering toe als in de
  // feature-heuristiek zodat component en heuristiek elkaar niet tegenspreken.
  const scale = clamp(Number(options.scale ?? 1), 0.1, 1);
  const difference = clamp((home - away) * scale + 65, -650, 650);
  const drawProb = clamp(0.29 - Math.abs(difference) / 4200, 0.15, 0.29);
  const decisiveHome = 1 / (1 + Math.pow(10, -difference / 400));
  return normalizeOutcomeProbabilities({
    homeProb: decisiveHome * (1 - drawProb),
    drawProb,
    awayProb: (1 - decisiveHome) * (1 - drawProb),
  });
}

export function buildLineupOutcomeModel(featureVector = {}, confirmed = false) {
  if (!confirmed) return null;
  const edge = clamp(
    Number(featureVector.lineups_avg_rating_diff || 0) * 0.32 +
      Number(featureVector.keeper_rating_diff || 0) * 0.2 +
      (Number(featureVector.home_lineup_continuity || 0) - Number(featureVector.away_lineup_continuity || 0)) * 0.45 +
      Number(featureVector.availability_diff || 0) * 0.08,
    -1.2,
    1.2,
  );
  // Basislijn: bij gelijke ploegen (edge 0) moet gelijkspel rond 27% liggen.
  // De oude waarde (0.18) gaf ~37%, dus het model overschatte gelijkspel.
  const drawScore = -0.3 - Math.abs(edge) * 0.06;
  return normalizeOutcomeProbabilities({
    homeProb: Math.exp(edge),
    drawProb: Math.exp(drawScore),
    awayProb: Math.exp(-edge),
  });
}

export function buildSquadStrengthOutcomeModel(featureVector = {}) {
  const home = Number(featureVector.home_squad_rating || 0);
  const away = Number(featureVector.away_squad_rating || 0);
  if (!(home > 0 && away > 0) || (home === 50 && away === 50)) return null;
  const reliability = featureVector.club_rating_active ? Math.sqrt(Number(featureVector.club_rating_reliability || 0)) : 1;
  const edge = clamp((home - away + 1.5) / 12, -2.5, 2.5) * reliability;
  const drawProb = clamp(0.27 - Math.abs(edge) * 0.025, 0.22, 0.27);
  const decisiveHome = 1 / (1 + Math.exp(-edge));
  return normalizeOutcomeProbabilities({
    homeProb: decisiveHome * (1 - drawProb),
    drawProb,
    awayProb: (1 - decisiveHome) * (1 - drawProb),
  });
}

export function buildTwoLegContextModel(featureVector = {}) {
  if (!Number(featureVector.aggregate_active || 0)) return null;
  const goalDiff = clamp(Number(featureVector.aggregate_goal_diff || 0), -4, 4);
  const drawProb = clamp(0.31 + Math.abs(goalDiff) * 0.012, 0.31, 0.35);
  const leaderEdge = clamp(goalDiff * 0.12, -0.48, 0.48);
  const decisiveHome = 1 / (1 + Math.exp(-leaderEdge));
  return normalizeOutcomeProbabilities({
    homeProb: decisiveHome * (1 - drawProb),
    drawProb,
    awayProb: (1 - decisiveHome) * (1 - drawProb),
  });
}

function ensembleAgreement(components, probabilities) {
  const active = components.filter((component) => component.active);
  if (active.length < 2) return 0.5;
  const difference = active.reduce((sum, component) => {
    return sum + ["homeProb", "drawProb", "awayProb"].reduce(
      (inner, key) => inner + Math.abs(Number(component.probabilities[key]) - Number(probabilities[key])),
      0,
    ) / 3;
  }, 0) / active.length;
  return Number(clamp(1 - difference * 3.5, 0, 1).toFixed(3));
}

// Ensemblegewichten, herbalanceerd op de geregistreerde reviewdiagnose
// (data/meta.json -> featureDiagnostics.topFailureSignals):
// - clubelo_misread (141x): de club-rating/Elo-component is een expliciete
//   heuristiek en geen backtest (docs/club-strength-source-policy.md), dus die
//   krijgt minder gewicht.
// - het Dixon-Coles/Poisson-doelpuntenmodel is het meest stabiele onderdeel en
//   krijgt dat gewicht erbij.
// - markt_misread (274x) gaat over het markt-overperformance-feature in de
//   heuristiek, niet over de gede-vigde consensus; die consensus blijft het
//   sterkste signaal zodra er pre-kickoff odds zijn.
// Wordt de markt of het boosting-model niet geleverd, dan hernormaliseren de
// overige gewichten automatisch.
const OUTCOME_ENSEMBLE_WEIGHTS = {
  dixon_coles_poisson: 0.37,
  feature_score_model: 0.22,
  monte_carlo: 0.14,
  club_elo: 0.05,
  de_vig_market: 0.16,
  confirmed_lineup: 0.05,
  squad_strength: 0.12,
  two_leg_context: 0.05,
  gradient_boosting: 0.2,
};

export function buildOutcomeEnsemble({
  poisson,
  heuristic,
  monteCarlo,
  gradientBoosting = null,
  oddsAtPrediction = null,
  kickoff = null,
  homeElo = null,
  awayElo = null,
  featureVector = {},
  lineupConfirmed = false,
} = {}) {
  const market = buildMarketConsensus(oddsAtPrediction || {}, kickoff);
  const elo = featureVector.club_rating_active ? null : buildEloOutcomeModel(homeElo, awayElo, { scale: featureVector.club_elo_scale });
  const lineup = buildLineupOutcomeModel(featureVector, lineupConfirmed);
  const squadStrength = buildSquadStrengthOutcomeModel(featureVector);
  const twoLegContext = buildTwoLegContextModel(featureVector);
  const definitions = [
    ["dixon_coles_poisson", poisson, OUTCOME_ENSEMBLE_WEIGHTS.dixon_coles_poisson],
    ["feature_score_model", heuristic, OUTCOME_ENSEMBLE_WEIGHTS.feature_score_model],
    ["monte_carlo", monteCarlo, OUTCOME_ENSEMBLE_WEIGHTS.monte_carlo],
    ["club_elo", elo, OUTCOME_ENSEMBLE_WEIGHTS.club_elo],
    ["de_vig_market", market, OUTCOME_ENSEMBLE_WEIGHTS.de_vig_market],
    ["confirmed_lineup", lineup, OUTCOME_ENSEMBLE_WEIGHTS.confirmed_lineup],
    ["squad_strength", squadStrength, OUTCOME_ENSEMBLE_WEIGHTS.squad_strength],
    ["two_leg_context", twoLegContext, OUTCOME_ENSEMBLE_WEIGHTS.two_leg_context],
    ["gradient_boosting", gradientBoosting, OUTCOME_ENSEMBLE_WEIGHTS.gradient_boosting],
  ];
  const components = definitions.map(([key, value, requestedWeight]) => ({
    key,
    active: !!value,
    requestedWeight,
    probabilities: value ? normalizeOutcomeProbabilities(value) : null,
    reason: value ? null : key === "gradient_boosting" ? "geen leakage-vrij gepromoveerd modelartefact" : "signaal ontbreekt",
  }));
  const active = components.filter((component) => component.active);
  const totalWeight = active.reduce((sum, component) => sum + Number(component.requestedWeight || 0), 0) || 1;
  const combined = { homeProb: 0, drawProb: 0, awayProb: 0 };
  for (const component of active) {
    component.weight = Number((component.requestedWeight / totalWeight).toFixed(4));
    for (const key of ["homeProb", "drawProb", "awayProb"]) {
      combined[key] += Number(component.probabilities[key]) * component.weight;
    }
  }
  let probabilities = normalizeOutcomeProbabilities(combined);
  const agreement = ensembleAgreement(components, probabilities);
  // Lage model-agreement is het grootste geregistreerde faalsignaal (390x in
  // data/meta.json). Trek de kansen in dat geval naar de gede-vigde
  // marktconsensus: zodra er pre-kickoff odds zijn is dat de sterkste
  // afzonderlijke bron en dempt dit een uitschieter in het ensemble.
  let marketShrink = 0;
  if (market && agreement < 0.55) {
    marketShrink = Number(Math.min(0.25, (0.55 - agreement) * 0.8).toFixed(3));
    probabilities = normalizeOutcomeProbabilities({
      homeProb: probabilities.homeProb * (1 - marketShrink) + market.homeProb * marketShrink,
      drawProb: probabilities.drawProb * (1 - marketShrink) + market.drawProb * marketShrink,
      awayProb: probabilities.awayProb * (1 - marketShrink) + market.awayProb * marketShrink,
    });
  }
  return {
    probabilities,
    agreement,
    marketShrink,
    components,
    market: market ? {
      overround: market.overround,
      bookmaker: market.bookmaker,
      bookmakers: market.bookmakers,
      capturedAt: market.capturedAt,
      disagreement: market.disagreement,
      movement: market.movement,
    } : null,
    version: "outcome-ensemble-v3",
  };
}

export function summarizeScoreCoverage(scoreMatrix = {}) {
  const topScores = Object.entries(scoreMatrix)
    .map(([score, probability]) => ({ score, probability: Number(probability || 0) }))
    .filter((item) => item.probability > 0)
    .sort((left, right) => right.probability - left.probability);
  const sum = (limit) => Number(topScores.slice(0, limit).reduce((total, item) => total + item.probability, 0).toFixed(4));
  return {
    topScores: topScores.slice(0, 5),
    top1: sum(1),
    top3: sum(3),
    top5: sum(5),
  };
}
