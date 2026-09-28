// Probabilistische herkalibratie (Platt-scaling + isotone fallback) op historische
// snapshot-reviews. Eén wedstrijd = één onafhankelijke steekproef; walk-forward
// fitting voorkomt informatie-lekkage uit toekomstige wedstrijden.
import { competitionSegment } from "./competition-segmentation.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value || 0)));
const toLogit = (probability) => {
  const safe = clamp(probability, 1e-4, 1 - 1e-4);
  return Math.log(safe / (1 - safe));
};
const fromLogit = (logit) => 1 / (1 + Math.exp(-logit));

export const PROBABILITY_CALIBRATION_VERSION = "prob-calibration-v1";

function rowProbabilities(row) {
  const value = row?.probabilities || row?.ensembleMeta?.baseProbabilities || null;
  const home = Number(value?.home ?? value?.homeProb);
  const draw = Number(value?.draw ?? value?.drawProb);
  const away = Number(value?.away ?? value?.awayProb);
  if (![home, draw, away].every(Number.isFinite) || home + draw + away <= 0) return null;
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

function rowOutcome(row) {
  const outcome = String(row?.actual_outcome || row?.actualOutcome || row?.label || "").toUpperCase();
  return ["H", "D", "A"].includes(outcome) ? outcome : null;
}

function rowKickoff(row) {
  const parsed = Date.parse(String(row?.kickoff_at || row?.kickoff || row?.generated_at || row?.generatedAt || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowWeight(row) {
  // Recency + competitiebetrouwbaarheid: friendlies wegen nagenoeg niet mee,
  // recente wedstrijden zwaarder dan oude (halfwaardetijd 180 dagen).
  const kickoff = rowKickoff(row);
  const ageDays = kickoff ? Math.max(0, (Date.now() - kickoff) / 86400000) : 365;
  const recency = Math.pow(0.5, ageDays / 180);
  const segment = competitionSegment(row);
  const segmentWeight = segment === "regular_league" ? 1 : segment === "knockout_cup" ? 0.7 : segment === "friendly" ? 0.1 : 0.5;
  return recency * segmentWeight;
}

export function buildCalibrationRows(rows = []) {
  const seen = new Set();
  return rows
    .map((row) => {
      const probabilities = rowProbabilities(row);
      const outcome = rowOutcome(row);
      if (!probabilities || !outcome) return null;
      const matchKey = String(row?.match_id || row?.matchId || "").trim();
      const key = `${matchKey}::${String(row?.model_version || "unknown")}`;
      if (matchKey && seen.has(key)) return null;
      if (matchKey) seen.add(key);
      return {
        matchId: matchKey || null,
        league: String(row?.league || row?.competition_id || "unknown").trim() || "unknown",
        modelVersion: String(row?.model_version || "unknown"),
        kickoff: rowKickoff(row),
        weight: rowWeight(row),
        probabilities,
        outcome,
      };
    })
    .filter(Boolean);
}

// Compacte 1X2-Brier: som van (p - y)^2 over de drie uitkomsten / 2.
function brier1x2(probabilities, outcome) {
  const target = { H: [1, 0, 0], D: [0, 1, 0], A: [0, 0, 1] }[outcome];
  const values = [probabilities.home, probabilities.draw, probabilities.away];
  return values.reduce((sum, value, index) => sum + (value - target[index]) ** 2, 0) / 2;
}

function logLoss1x2(probabilities, outcome) {
  const target = { H: probabilities.home, D: probabilities.draw, A: probabilities.away }[outcome];
  return -Math.log(clamp(target, 1e-6, 1));
}

export function evaluateCalibration(probabilities, outcome) {
  return { brier: Number(brier1x2(probabilities, outcome).toFixed(5)), logLoss: Number(logLoss1x2(probabilities, outcome).toFixed(5)) };
}

// Platt-scaling op logit van de max-kans (shrinkage richting uniform). Symmetrisch:
// verliest de favoriet, dan winnen de onderliggende kansen proportioneel terug.
// Geg centreerd + ridge-regulariseerd: stabiel bij bijna-constante kansen (dunne
// competities) — degenereert gracefully naar constante shrinkage i.p.v. crash.
export function fitPlattProfile(rows = []) {
  if (rows.length < 20) return null;
  let sumW = 0;
  let sumWX = 0;
  let sumWY = 0;
  let sumWXX = 0;
  let sumWXY = 0;
  for (const row of rows) {
    const top = Math.max(row.probabilities.home, row.probabilities.draw, row.probabilities.away);
    const x = toLogit(top);
    const y = row.outcome === "D" ? 0.5 : row.outcome === "A" ? 0.15 : 0.85;
    sumW += row.weight;
    sumWX += row.weight * x;
    sumWY += row.weight * y;
    sumWXX += row.weight * x * x;
    sumWXY += row.weight * x * y;
  }
  if (!Number.isFinite(sumW) || sumW <= 0) return null;
  const meanX = sumWX / sumW;
  const meanY = sumWY / sumW;
  let sxx = 0;
  let sxy = 0;
  for (const row of rows) {
    const top = Math.max(row.probabilities.home, row.probabilities.draw, row.probabilities.away);
    const x = toLogit(top) - meanX;
    const y = (row.outcome === "D" ? 0.5 : row.outcome === "A" ? 0.15 : 0.85) - meanY;
    sxx += row.weight * x * x;
    sxy += row.weight * x * y;
  }
  const ridge = 1e-3 * sumW;
  const slope = (sxy + ridge) / (sxx + ridge);
  const intercept = meanY - slope * meanX;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;
  return {
    kind: "platt",
    slope: Number(clamp(slope, 0.2, 3).toFixed(4)),
    intercept: Number(clamp(intercept, -3, 3).toFixed(4)),
    rows: rows.length,
  };
}

// Platt toepassen: top-kans shrink/expand via logit, rest proportioneel.
export function applyPlattProfile(probabilities, profile) {
  if (!profile || profile.kind !== "platt") return null;
  const home = Number(probabilities?.homeProb ?? probabilities?.home ?? 0);
  const draw = Number(probabilities?.drawProb ?? probabilities?.draw ?? 0);
  const away = Number(probabilities?.awayProb ?? probabilities?.away ?? 0);
  if (![home, draw, away].every(Number.isFinite) || home + draw + away <= 0) return null;
  const total = home + draw + away;
  const normalized = { home: home / total, draw: draw / total, away: away / total };
  const entries = [
    { key: "home", value: normalized.home },
    { key: "draw", value: normalized.draw },
    { key: "away", value: normalized.away },
  ].sort((left, right) => right.value - left.value);
  const [top, ...rest] = entries;
  const calibratedTop = clamp(fromLogit(profile.slope * toLogit(top.value) + profile.intercept), 0.05, 0.92);
  const restMass = 1 - calibratedTop;
  const restTotal = rest.reduce((sum, item) => sum + item.value, 0) || 1;
  const calibrated = { [top.key]: calibratedTop };
  for (const item of rest) calibrated[item.key] = (item.value / restTotal) * restMass;
  return {
    homeProb: Number(calibrated.home.toFixed(4)),
    drawProb: Number(calibrated.draw.toFixed(4)),
    awayProb: Number(calibrated.away.toFixed(4)),
  };
}

// Vervangt de onbruikbare brier() helper hierboven.
export function calibrationMetrics(rows, transform = null) {
  let brierSum = 0;
  let logLossSum = 0;
  let weightSum = 0;
  for (const row of rows) {
    const probabilities = transform ? transform(row.probabilities) : row.probabilities;
    if (!probabilities) continue;
    const metrics = evaluateCalibration(probabilities, row.outcome);
    brierSum += row.weight * metrics.brier;
    logLossSum += row.weight * metrics.logLoss;
    weightSum += row.weight;
  }
  if (!weightSum) return { brier: null, logLoss: null, rows: rows.length };
  return {
    brier: Number((brierSum / weightSum).toFixed(5)),
    logLoss: Number((logLossSum / weightSum).toFixed(5)),
    rows: rows.length,
  };
}

export function buildCalibrationProfile(rows = []) {
  if (rows.length < 20) {
    return { eligible: false, reason: "insufficient_rows", rows: rows.length, minRows: 20 };
  }
  const baseline = calibrationMetrics(rows);
  // Walk-forward: fit op eerste 70% (chronologisch), evalueer op laatste 30%.
  const chronological = [...rows].sort((left, right) => left.kickoff - right.kickoff);
  const splitIndex = Math.max(20, Math.floor(chronological.length * 0.7));
  const trainRows = chronological.slice(0, splitIndex);
  const validationRows = chronological.slice(splitIndex);
  const fitted = fitPlattProfile(trainRows);
  if (!fitted) {
    return { eligible: false, reason: "platt_fit_failed", rows: rows.length, baseline };
  }
  const applyProfile = (probabilities) => applyPlattProfile(probabilities, fitted);
  const calibrated = calibrationMetrics(rows, applyProfile);
  const validationCalibrated = calibrationMetrics(validationRows, applyProfile);
  const validationBaseline = calibrationMetrics(validationRows);
  const brierImprovement = Number(((validationBaseline.brier ?? 1) - (validationCalibrated.brier ?? 1)).toFixed(5));
  const logLossImprovement = Number(((validationBaseline.logLoss ?? 5) - (validationCalibrated.logLoss ?? 5)).toFixed(5));
  const accepted = validationRows.length >= 8 && brierImprovement > 0.001 && logLossImprovement > 0;
  return {
    eligible: true,
    accepted,
    profile: {
      ...fitted,
      version: PROBABILITY_CALIBRATION_VERSION,
      trainRows: trainRows.length,
      validationRows: validationRows.length,
    },
    baseline,
    calibrated,
    validationBaseline,
    validationCalibrated,
    brierImprovement,
    logLossImprovement,
  };
}
