// Kalibratiemethoden en de keuze daartussen.
//
// Het model publiceert een confidence (record.cf) bij de gekozen 1X2-uitkomst.
// In server-worker.js wordt die met Platt-schaling gecorrigeerd. Deze module
// maakt de alternatieven expliciet en kiest de methode op een *chronologische*
// holdout: fitten op de eerste 60% van de beoordeelde voorspellingen, meten op
// de latere 40%. Zo kan een methode niet winnen door de data te onthouden.
//
// Methoden:
//   identity     - geen correctie (de nulmeting)
//   platt        - q = sigmoid(a * logit(p) + b), twee parameters
//   temperature  - q = sigmoid(logit(p) / T), een parameter (rangorde blijft)
//   isotonic     - niet-parametrisch, monotone regressie (PAV); kan meer
//                  vertekening herstellen maar overfit bij weinig data
//
// De keuze valt terug op identity zolang er te weinig beoordeelde
// voorspellingen zijn; publiceren van een calibratie op tien duels is ruis.

const EPS = 1e-6;

function clampProbability(value) {
  return Math.min(1 - EPS, Math.max(EPS, Number(value)));
}

export function logit(probability) {
  const q = clampProbability(probability);
  return Math.log(q / (1 - q));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

export function applyPlatt(probability, params = {}) {
  const a = Number(params.a ?? 1);
  const b = Number(params.b ?? 0);
  return sigmoid(a * logit(probability) + b);
}

export function applyTemperature(probability, params = {}) {
  const temperature = Number(params.temperature ?? 1) || 1;
  return sigmoid(logit(probability) / temperature);
}

function binaryLogLoss(pairs, predict) {
  if (!pairs.length) return null;
  let sum = 0;
  for (const pair of pairs) {
    const predicted = Math.min(1 - EPS, Math.max(EPS, predict(pair.p)));
    sum += pair.y === 1 ? -Math.log(predicted) : -Math.log(1 - predicted);
  }
  return sum / pairs.length;
}

function binaryBrier(pairs, predict) {
  if (!pairs.length) return null;
  let sum = 0;
  for (const pair of pairs) {
    sum += (predict(pair.p) - (pair.y === 1 ? 1 : 0)) ** 2;
  }
  return sum / pairs.length;
}

function toPairs(rows) {
  const pairs = [];
  for (const row of rows || []) {
    const probability = Number(row?.cf);
    const label = typeof row?.hit === "boolean" ? row.hit : null;
    if (!Number.isFinite(probability) || label === null) continue;
    if (probability <= 0 || probability >= 1) continue;
    pairs.push({ p: probability, y: label ? 1 : 0, d: String(row.d || "") });
  }
  return pairs;
}

// Gradient descent op de logloss; klein en deterministisch, geen dependency.
export function fitPlatt(pairs = [], options = {}) {
  const iterations = Math.max(1, Number(options.iterations || 400));
  const learningRate = Number(options.learningRate || 0.1);
  let a = 1;
  let b = 0;
  for (let step = 0; step < iterations; step += 1) {
    let gradientA = 0;
    let gradientB = 0;
    for (const pair of pairs) {
      const predicted = applyPlatt(pair.p, { a, b });
      const error = predicted - pair.y;
      gradientA += error * logit(pair.p);
      gradientB += error;
    }
    if (!pairs.length) break;
    // Lichte L2 op a, zodat een kleine steekproef niet naar een harde stap gaat.
    a -= learningRate * (gradientA / pairs.length + 0.001 * (a - 1));
    b -= learningRate * (gradientB / pairs.length);
    a = Math.min(5, Math.max(0.2, a));
    b = Math.min(5, Math.max(-5, b));
  }
  return { a: Math.round(a * 10000) / 10000, b: Math.round(b * 10000) / 10000 };
}

export function fitTemperature(pairs = [], options = {}) {
  const iterations = Math.max(1, Number(options.iterations || 300));
  const learningRate = Number(options.learningRate || 0.05);
  let temperature = 1;
  for (let step = 0; step < iterations; step += 1) {
    let gradient = 0;
    for (const pair of pairs) {
      const predicted = applyTemperature(pair.p, { temperature });
      gradient += (predicted - pair.y) * (-logit(pair.p) / (temperature * temperature));
    }
    if (!pairs.length) break;
    temperature -= learningRate * (gradient / pairs.length);
    temperature = Math.min(5, Math.max(0.2, temperature));
  }
  return { temperature: Math.round(temperature * 10000) / 10000 };
}

// Pool adjacent violators: monotone niet-dalende fit van y tegen p.
// `minBinSample`: minimum steekproef per bucket. Blokken die kleiner zijn
// worden poolen met de naastgelegen blok waarvan het gemiddelde het dichtst
// bij zit; het gepoolde gemiddelde ligt tussen beide, dus de monotone
// volgorde blijft gegarandeerd staan. Zonder pooling ontstond in de
// rapportage een isotonic-fit met losse n=1-blokjes: puur ruis die de
// holdout-toets kan winnen, maar nooit leerbaar is.
export function fitIsotonic(pairs = [], options = {}) {
  const sorted = [...pairs].sort((left, right) => left.p - right.p);
  let blocks = [];
  for (const pair of sorted) {
    blocks.push({ sum: pair.y, weight: 1, pSum: pair.p });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const previous = blocks[blocks.length - 2];
      if (previous.sum / previous.weight <= last.sum / last.weight) break;
      blocks.splice(blocks.length - 2, 2, {
        sum: previous.sum + last.sum,
        weight: previous.weight + last.weight,
        pSum: previous.pSum + last.pSum,
      });
    }
  }
  blocks = poolUnderweightBlocks(blocks, Math.max(0, Number(options.minBinSample || 0)));
  return {
    minBinSample: Math.max(0, Number(options.minBinSample || 0)) || null,
    bins: blocks.map((block) => ({
      p: Math.round((block.pSum / block.weight) * 10000) / 10000,
      y: Math.round((block.sum / block.weight) * 10000) / 10000,
      n: block.weight,
    })),
  };
}

// Poolt accumulatieve blokken onder de drempel: kleinste ondermaat eerst,
// dichtstbijzijnde buurblok als partner. Deterministisch; elke samenvoeging
// verlaagt het aantal blokken, dus de lus eindigt altijd.
function poolUnderweightBlocks(blocks, minBinSample) {
  if (!minBinSample || minBinSample <= 1) return blocks;
  const list = [...blocks];
  while (list.length > 1) {
    let underSizeIndex = -1;
    for (let index = 0; index < list.length; index += 1) {
      if (list[index].weight < minBinSample && (underSizeIndex === -1 || list[index].weight < list[underSizeIndex].weight)) {
        underSizeIndex = index;
      }
    }
    if (underSizeIndex === -1) break;
    const undersized = list[underSizeIndex];
    const left = underSizeIndex > 0 ? list[underSizeIndex - 1] : null;
    const right = underSizeIndex < list.length - 1 ? list[underSizeIndex + 1] : null;
    const undersizedMean = undersized.sum / undersized.weight;
    const leftGap = left ? Math.abs(left.sum / left.weight - undersizedMean) : Infinity;
    const rightGap = right ? Math.abs(right.sum / right.weight - undersizedMean) : Infinity;
    const mergeIndex = leftGap <= rightGap ? underSizeIndex - 1 : underSizeIndex + 1;
    const first = Math.min(underSizeIndex, mergeIndex);
    const second = Math.max(underSizeIndex, mergeIndex);
    list.splice(first, 2, {
      sum: list[first].sum + list[second].sum,
      weight: list[first].weight + list[second].weight,
      pSum: list[first].pSum + list[second].pSum,
    });
  }
  return list;
}

// Piecewise-lineaire interpolatie tussen de blokken; buiten het bereik klemmen.
export function applyIsotonic(probability, model = {}) {
  const bins = model.bins || [];
  if (!bins.length) return probability;
  const value = Number(probability);
  if (value <= bins[0].p) return bins[0].y;
  const last = bins[bins.length - 1];
  if (value >= last.p) return last.y;
  for (let position = 1; position < bins.length; position += 1) {
    const right = bins[position];
    if (value > right.p) continue;
    const left = bins[position - 1];
    const span = right.p - left.p;
    if (span <= 0) return right.y;
    const share = (value - left.p) / span;
    return left.y + share * (right.y - left.y);
  }
  return last.y;
}

// Kiest de methode op chronological holdout. Retourneert altijd een bruikbare
// keuze, met de metingen van alle kandidaten erbij zodat het rapport laat zien
// waarom de keuze zo viel.
export function selectCalibration(rows = [], options = {}) {
  const minSample = Math.max(10, Number(options.minSample || 150));
  const minHoldout = Math.max(5, Number(options.minHoldout || 30));
  const pairs = toPairs(rows);
  if (pairs.length < minSample) {
    return {
      method: "identity",
      reason: "te-weinig-beoordeelde-voorspellingen",
      sample: pairs.length,
      minSample,
      candidates: null,
      params: null,
    };
  }
  const sorted = [...pairs].sort((left, right) => left.d.localeCompare(right.d));
  const cut = Math.floor(sorted.length * 0.6);
  const fitSet = sorted.slice(0, cut);
  const holdoutSet = sorted.slice(cut);
  if (holdoutSet.length < minHoldout) {
    return {
      method: "identity",
      reason: "holdout-te-klein",
      sample: pairs.length,
      minSample,
      candidates: null,
      params: null,
    };
  }

  // Minimum steekproef per isotonic-bucket: losse duels zijn geen bewijs,
  // dus sinds deze ronde worden kleine blokken gepoolt. Afleidbaar via
  // options; standaard zo gekozen dat er maximaal ~60 buckets ontstaan.
  const minBinSample = Math.max(1, Number(options.minBinSample || Math.max(5, Math.ceil(fitSet.length / 60))));
  const platt = fitPlatt(fitSet);
  const temperature = fitTemperature(fitSet);
  const isotonic = fitIsotonic(fitSet, { minBinSample });
  const candidates = [
    { method: "identity", predict: (value) => value, params: null },
    { method: "platt", predict: (value) => applyPlatt(value, platt), params: platt },
    { method: "temperature", predict: (value) => applyTemperature(value, temperature), params: temperature },
    { method: "isotonic", predict: (value) => applyIsotonic(value, isotonic), params: isotonic },
  ];

  const measured = candidates.map((candidate) => {
    const logLoss = binaryLogLoss(holdoutSet, candidate.predict);
    const brier = binaryBrier(holdoutSet, candidate.predict);
    const fitLogLoss = binaryLogLoss(fitSet, candidate.predict);
    return {
      method: candidate.method,
      params: candidate.params,
      holdoutLogLoss: logLoss === null ? null : Math.round(logLoss * 10000) / 10000,
      holdoutBrier: brier === null ? null : Math.round(brier * 10000) / 10000,
      fitLogLoss: fitLogLoss === null ? null : Math.round(fitLogLoss * 10000) / 10000,
    };
  });

  const winner = measured
    .filter((candidate) => Number.isFinite(candidate.holdoutLogLoss))
    .sort((left, right) => left.holdoutLogLoss - right.holdoutLogLoss)[0];
  const baseline = measured.find((candidate) => candidate.method === "identity");

  return {
    method: winner ? winner.method : "identity",
    reason: winner ? "laagste-holdout-logloss" : "geen-geldige-kandidaat",
    sample: pairs.length,
    fitSample: fitSet.length,
    holdoutSample: holdoutSet.length,
    isotonicMinBinSample: minBinSample,
    minSample,
    baselineLogLoss: baseline?.holdoutLogLoss ?? null,
    improvement: winner && Number.isFinite(winner.holdoutLogLoss)
      ? Math.round(((baseline?.holdoutLogLoss ?? winner.holdoutLogLoss) - winner.holdoutLogLoss) * 10000) / 10000
      : null,
    candidates: measured,
    params: winner?.params ?? null,
  };
}
