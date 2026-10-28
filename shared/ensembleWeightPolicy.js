// Advies voor het marktgewicht in het ensemble, op basis van eigen metingen.
//
// De literatuur is duidelijk: closing odds zijn het scherpste signaal dat gratis
// beschikbaar is. Toch staat het marktgewicht in het ensemble al maanden op 0,16
// zonder dat iemand heeft gemeten of dat klopt. Deze module doet geen aanname
// maar combineert twee eigen metingen:
//
//   1. de kansniveau-benchmark (model vs markt op dezelfde duels);
//   2. de fit uit shared/ensembleWeightFit.js (welk gewicht voorspelt op de
//      holdout het beste).
//
// De fit weegt zwaarder wanneer hij bestaat, want die is direct op de vraag
// gericht. Zonder fit of zonder bevestiging op de holdout blijft het gewicht
// staan. Het advies wordt gerapporteerd, niet stil toegepast.

export const DEFAULT_MARKET_WEIGHT = 0.16;
export const MAX_MARKET_WEIGHT = 0.55;
const MIN_SAMPLE = 150;
const STEPS_PER_EXCESS = 0.8;

function round(value, digits = 3) {
  return Math.round(Number(value) * 10 ** digits) / 10 ** digits;
}

function clampWeight(value, maxWeight) {
  return Math.min(maxWeight, Math.max(0, Number(value)));
}

// benchmark: het `probability`-blok uit shared/modelMetrics.js
//   { n, modelN, model: { logLoss }, market: { logLoss }, delta: { logLoss } }
// fit: het resultaat van fitMarketWeightBlend (mag ontbreken)
export function adviseMarketWeight(benchmark = {}, options = {}) {
  const current = Number.isFinite(Number(options.current))
    ? Number(options.current)
    : DEFAULT_MARKET_WEIGHT;
  const minSample = Math.max(1, Number(options.minSample || MIN_SAMPLE));
  const maxWeight = Math.max(current, Number(options.maxWeight || MAX_MARKET_WEIGHT));
  const fit = options.fit && typeof options.fit === "object" ? options.fit : null;

  const sample = Number(benchmark?.modelN || 0);
  const modelLogLoss = Number(benchmark?.model?.logLoss);
  const marketLogLoss = Number(benchmark?.market?.logLoss);

  const base = {
    current: round(current),
    minSample,
    sample,
    modelLogLoss: Number.isFinite(modelLogLoss) ? round(modelLogLoss, 4) : null,
    marketLogLoss: Number.isFinite(marketLogLoss) ? round(marketLogLoss, 4) : null,
  };

  // De fit is de sterkste meting: hij toetst het gewicht zelf op een holdout.
  if (fit && fit.available && Number.isFinite(Number(fit.recommendedWeight))) {
    const advised = clampWeight(fit.recommendedWeight, maxWeight);
    return {
      ...base,
      source: "holdout-fit",
      sample: Number(fit.sample || 0),
      advised: round(advised),
      change: round(advised - current),
      direction: Math.abs(advised - current) < 0.005 ? "hold" : advised > current ? "up" : "down",
      reason: fit.holdoutImproves ? "gemeten-op-eigen-historie" : "holdout-bevestigt-geen-verbetering",
      holdoutLogLoss: fit.holdoutLogLoss ?? null,
      currentHoldoutLogLoss: fit.currentHoldoutLogLoss ?? null,
      confidence: round(Math.min(1, Number(fit.holdoutSample || 0) / (minSample * 2)), 2),
    };
  }

  if (sample < minSample) {
    return {
      ...base,
      source: "benchmark",
      advised: round(current),
      change: 0,
      direction: "hold",
      reason: "te-weinig-paren",
      confidence: round(Math.min(1, sample / minSample), 2),
    };
  }
  if (!Number.isFinite(modelLogLoss) || !Number.isFinite(marketLogLoss) || marketLogLoss <= 0) {
    return {
      ...base,
      source: "benchmark",
      advised: round(current),
      change: 0,
      direction: "hold",
      reason: "geen-geldige-logloss",
      confidence: 0,
    };
  }

  const ratio = modelLogLoss / marketLogLoss;
  const excess = Math.max(0, ratio - 1);
  if (excess === 0) {
    return {
      ...base,
      source: "benchmark",
      advised: round(current),
      change: 0,
      direction: "hold",
      reason: "model-niet-slechter-dan-markt",
      ratio: round(ratio, 4),
      confidence: round(Math.min(1, sample / (minSample * 3)), 2),
    };
  }

  const advised = Math.min(maxWeight, current + excess * STEPS_PER_EXCESS);
  return {
    ...base,
    source: "benchmark",
    advised: round(advised),
    change: round(advised - current),
    direction: advised > current ? "up" : "hold",
    reason: "model-aantoonbaar-slechter-dan-markt",
    ratio: round(ratio, 4),
    // Een advies op 150 duels is een hint, niet een bewijs.
    confidence: round(Math.min(1, sample / (minSample * 3)), 2),
  };
}
