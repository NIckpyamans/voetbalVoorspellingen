// Klein gradient-boosting-ensemble in puur JavaScript: decision-stumps op de
// sterkste featurevectoren uit de snapshot-historie. Getraind offline door
// scripts/train-ml-ensemble.js (of in GitHub Actions), uitgelezen door de worker.
//
// Modelformat (JSON):
// {
//   version, featureSchema, classes: ["H","D","A"],
//   base: [p_H, p_D, p_A],          // log-odds-baseline per klasse
//   stumps: [{ feature, threshold, left: [dH,dD,dA], right: [dH,dD,dA], gain }],
//   trainingMeta: { rows, trainedAt, validationBrier, baselineBrier }
// }
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value || 0)));

export const ML_ENSEMBLE_VERSION = "ml-ensemble-v1";
export const ML_FEATURES = [
  "ppg_diff",
  "club_elo_diff",
  "squad_rating_diff",
  "rest_diff",
  "h2h_reliability",
  "h2h_balance",
  "lineups_confirmed",
  "home_injuries",
  "away_injuries",
  "recency_weighted_xg_diff",
];

function softmax(values) {
  const max = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(value - max));
  const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  return exponentials.map((value) => value / total);
}

function featureValue(featureVector, feature) {
  const value = Number(featureVector?.[feature]);
  return Number.isFinite(value) ? value : 0;
}

export function predictWithMlEnsemble(featureVector, model) {
  if (!model || model.version !== ML_ENSEMBLE_VERSION || !Array.isArray(model.stumps) || !model.stumps.length) {
    return null;
  }
  const scores = [0, 1, 2].map((index) => Number(model.base?.[index] || 0));
  for (const stump of model.stumps) {
    const value = featureValue(featureVector, stump.feature);
    const delta = value <= Number(stump.threshold) ? stump.left : stump.right;
    for (let index = 0; index < 3; index += 1) scores[index] += Number(delta?.[index] || 0);
  }
  const probabilities = softmax(scores);
  return {
    homeProb: Number(clamp(probabilities[0], 0.01, 0.97).toFixed(4)),
    drawProb: Number(clamp(probabilities[1], 0.01, 0.97).toFixed(4)),
    awayProb: Number(clamp(probabilities[2], 0.01, 0.97).toFixed(4)),
    version: model.version,
    trainingMeta: model.trainingMeta || null,
  };
}
