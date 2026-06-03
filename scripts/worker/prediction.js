export const PREDICTION_MODULE = {
  name: "prediction",
  owns: ["feature vector construction", "Poisson score matrix", "ensemble probabilities", "confidence calibration"],
};

export function factorial(n) {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

export function poisson(lambda, k) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

export function dixonColesAdjustment(h, a, homeXG, awayXG, rho = -0.13) {
  if (h === 0 && a === 0) return 1 - homeXG * awayXG * rho;
  if (h === 0 && a === 1) return 1 + homeXG * rho;
  if (h === 1 && a === 0) return 1 + awayXG * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

export function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildPoissonScoreModel(homeXG, awayXG, options = {}) {
  const maxGoals = Number(options.maxGoals ?? 6);
  const minMatrixProbability = Number(options.minMatrixProbability ?? 0.01);
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

  for (let homeGoals = 0; homeGoals <= maxGoals; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= maxGoals; awayGoals += 1) {
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
      if (probability > minMatrixProbability) scoreMatrix[`${homeGoals}-${awayGoals}`] = Number(probability.toFixed(4));
    }
  }

  const totalProb = homeProb + drawProb + awayProb || 1;
  return {
    homeProb: homeProb / totalProb,
    drawProb: drawProb / totalProb,
    awayProb: awayProb / totalProb,
    over15,
    over25,
    over35,
    btts,
    bestScore,
    bestProb,
    bestByOutcome,
    scoreMatrix,
  };
}
