import { dixonColesAdjustment, seededRandom } from "./prediction.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function samplePoisson(lambda, random) {
  const safeLambda = clamp(Number(lambda || 0), 0.05, 7);
  const threshold = Math.exp(-safeLambda);
  let product = 1;
  let goals = 0;

  // Geen harde bovengrens meer: die schoof de staart (>9 doelpunten) naar 9 en
  // onderschatte zo de scoringskans bij hoge xG. De lus eindigt vanzelf.
  do {
    goals += 1;
    product *= random();
  } while (product > threshold);

  return Math.max(0, goals - 1);
}

export function scoreOutcome(score) {
  const [homeGoals, awayGoals] = String(score || "").split("-").map(Number);
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
  if (homeGoals > awayGoals) return "home";
  if (homeGoals < awayGoals) return "away";
  return "draw";
}

export function runMonteCarloSimulation({ homeXG, awayXG, seed, runs = 10000 }) {
  const safeRuns = Math.max(1000, Math.round(Number(runs || 10000)));
  const lambdaHome = clamp(Number(homeXG || 0), 0.05, 7);
  const lambdaAway = clamp(Number(awayXG || 0), 0.05, 7);
  const random = seededRandom(seed);
  const scoreWeights = {};
  let totalWeight = 0;
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let btts = 0;
  let over25 = 0;
  let over35 = 0;
  let totalHomeGoals = 0;
  let totalAwayGoals = 0;

  for (let i = 0; i < safeRuns; i += 1) {
    const homeGoals = samplePoisson(lambdaHome, random);
    const awayGoals = samplePoisson(lambdaAway, random);
    // Dixon-Coles-correctie als importance weight, zodat lage uitslagen (0-0,
    // 1-0, 0-1, 1-1) hetzelfde gewicht krijgen als in buildPoissonScoreModel.
    // Zonder die correctie onderschatte de simulatie gelijkspel systematisch.
    const weight = dixonColesAdjustment(homeGoals, awayGoals, lambdaHome, lambdaAway);
    const key = `${homeGoals}-${awayGoals}`;
    scoreWeights[key] = (scoreWeights[key] || 0) + weight;
    totalWeight += weight;
    totalHomeGoals += homeGoals * weight;
    totalAwayGoals += awayGoals * weight;

    if (homeGoals > awayGoals) homeWins += weight;
    else if (homeGoals === awayGoals) draws += weight;
    else awayWins += weight;

    if (homeGoals > 0 && awayGoals > 0) btts += weight;
    if (homeGoals + awayGoals > 2.5) over25 += weight;
    if (homeGoals + awayGoals > 3.5) over35 += weight;
  }

  const share = (value) => value / totalWeight;
  const scoreMatrix = {};
  let topScore = "1-1";
  let topScoreWeight = 0;
  for (const [score, weight] of Object.entries(scoreWeights)) {
    const probability = Number(share(weight).toFixed(4));
    if (probability > 0.004) scoreMatrix[score] = probability;
    if (weight > topScoreWeight) {
      topScore = score;
      topScoreWeight = weight;
    }
  }

  const averageHomeGoals = Number((totalHomeGoals / totalWeight).toFixed(3));
  const averageAwayGoals = Number((totalAwayGoals / totalWeight).toFixed(3));
  const averageScore = `${Math.round(averageHomeGoals)}-${Math.round(averageAwayGoals)}`;

  return {
    active: true,
    simulations: safeRuns,
    seed,
    homeProb: Number(share(homeWins).toFixed(4)),
    drawProb: Number(share(draws).toFixed(4)),
    awayProb: Number(share(awayWins).toFixed(4)),
    bttsProb: Number(share(btts).toFixed(4)),
    over25Prob: Number(share(over25).toFixed(4)),
    over35Prob: Number(share(over35).toFixed(4)),
    under25Prob: Number((1 - share(over25)).toFixed(4)),
    averageHomeGoals,
    averageAwayGoals,
    averageScore,
    averageScoreProb: Number(scoreMatrix[averageScore] || 0),
    topScore,
    topScoreProb: Number(share(topScoreWeight).toFixed(4)),
    scoreMatrix,
  };
}
