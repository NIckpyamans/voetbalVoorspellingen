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
  return {
    ...normalizeOutcomeProbabilities({
      homeProb: (1 / home) / overround,
      drawProb: (1 / draw) / overround,
      awayProb: (1 / away) / overround,
    }),
    overround: Number(overround.toFixed(4)),
    bookmaker: odds.bookmaker || null,
    capturedAt: odds.capturedAt || odds.lastUpdated || null,
  };
}

export function buildEloOutcomeModel(homeElo, awayElo) {
  const home = Number(homeElo || 0);
  const away = Number(awayElo || 0);
  if (!(home > 0 && away > 0)) return null;
  const difference = clamp(home - away + 65, -650, 650);
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
  const drawScore = 0.18 - Math.abs(edge) * 0.06;
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
  const edge = clamp((home - away + 1.5) / 8, -1.4, 1.4);
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
  const market = devigThreeWayOdds(oddsAtPrediction || {}, kickoff);
  const elo = buildEloOutcomeModel(homeElo, awayElo);
  const lineup = buildLineupOutcomeModel(featureVector, lineupConfirmed);
  const squadStrength = buildSquadStrengthOutcomeModel(featureVector);
  const twoLegContext = buildTwoLegContextModel(featureVector);
  const definitions = [
    ["dixon_coles_poisson", poisson, 0.34],
    ["feature_score_model", heuristic, 0.22],
    ["monte_carlo", monteCarlo, 0.14],
    ["club_elo", elo, 0.1],
    ["de_vig_market", market, 0.15],
    ["confirmed_lineup", lineup, 0.05],
    ["squad_strength", squadStrength, 0.12],
    ["two_leg_context", twoLegContext, 0.05],
    ["gradient_boosting", gradientBoosting, 0.2],
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
  const probabilities = normalizeOutcomeProbabilities(combined);
  return {
    probabilities,
    agreement: ensembleAgreement(components, probabilities),
    components,
    market: market ? {
      overround: market.overround,
      bookmaker: market.bookmaker,
      capturedAt: market.capturedAt,
    } : null,
    version: "outcome-ensemble-v2",
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
