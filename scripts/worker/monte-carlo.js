import { seededRandom } from "./prediction.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function samplePoisson(lambda, random) {
  const safeLambda = clamp(Number(lambda || 0), 0.05, 7);
  const threshold = Math.exp(-safeLambda);
  let product = 1;
  let goals = 0;

  do {
    goals += 1;
    product *= random();
  } while (product > threshold && goals < 10);

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
  const random = seededRandom(seed);
  const scoreCounts = {};
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let btts = 0;
  let over25 = 0;
  let over35 = 0;
  let totalHomeGoals = 0;
  let totalAwayGoals = 0;

  for (let i = 0; i < safeRuns; i += 1) {
    const homeGoals = samplePoisson(homeXG, random);
    const awayGoals = samplePoisson(awayXG, random);
    const key = `${homeGoals}-${awayGoals}`;
    scoreCounts[key] = (scoreCounts[key] || 0) + 1;
    totalHomeGoals += homeGoals;
    totalAwayGoals += awayGoals;

    if (homeGoals > awayGoals) homeWins += 1;
    else if (homeGoals === awayGoals) draws += 1;
    else awayWins += 1;

    if (homeGoals > 0 && awayGoals > 0) btts += 1;
    if (homeGoals + awayGoals > 2.5) over25 += 1;
    if (homeGoals + awayGoals > 3.5) over35 += 1;
  }

  const scoreMatrix = {};
  let topScore = "1-1";
  let topScoreCount = 0;
  for (const [score, count] of Object.entries(scoreCounts)) {
    const probability = Number((Number(count || 0) / safeRuns).toFixed(4));
    if (probability > 0.004) scoreMatrix[score] = probability;
    if (Number(count || 0) > topScoreCount) {
      topScore = score;
      topScoreCount = Number(count || 0);
    }
  }

  const averageHomeGoals = Number((totalHomeGoals / safeRuns).toFixed(3));
  const averageAwayGoals = Number((totalAwayGoals / safeRuns).toFixed(3));
  const averageScore = `${Math.round(averageHomeGoals)}-${Math.round(averageAwayGoals)}`;

  return {
    active: true,
    simulations: safeRuns,
    seed,
    homeProb: Number((homeWins / safeRuns).toFixed(4)),
    drawProb: Number((draws / safeRuns).toFixed(4)),
    awayProb: Number((awayWins / safeRuns).toFixed(4)),
    bttsProb: Number((btts / safeRuns).toFixed(4)),
    over25Prob: Number((over25 / safeRuns).toFixed(4)),
    over35Prob: Number((over35 / safeRuns).toFixed(4)),
    under25Prob: Number((1 - over25 / safeRuns).toFixed(4)),
    averageHomeGoals,
    averageAwayGoals,
    averageScore,
    averageScoreProb: Number(scoreMatrix[averageScore] || 0),
    topScore,
    topScoreProb: Number((topScoreCount / safeRuns).toFixed(4)),
    scoreMatrix,
  };
}
