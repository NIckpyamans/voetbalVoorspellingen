// Marktbenchmark op kansniveau.
//
// De favoriet-hitrate (shared/modelMetrics.js marktbaseline) zegt alleen of de
// laagste odd uitkwam. Dat is robuust maar grof: het negeert hoe zeker de markt
// was. Deze module vergelijkt de volledige kansverdeling van het model met de
// de-vigde marktkansen via logloss, Brier en RPS (ranked probability score).
//
// De-vig-methoden (bron: football-data.co.uk odds + literatuur over
// bookmakersmarges):
//   - multiplicative: q_i = p_i / sum(p). Eenvoudig, standaardbenchmark.
//   - power: zoek k met sum(p_i^k) = 1. Haalt de marge vooral bij de outsiders
//     weg, waardoor de favoriet juist iets stijgt tegenover proportioneel
//     normaliseren; dezelfde methode als powerDevig in worker/outcome-ensemble.js.
//   - shin: q_i = (sqrt(z^2 + 4(1-z)p_i^2/S) - z) / (2(1-z)) met z zo gekozen
//     dat de kansen optellen tot 1 (Jullien & Salanié). Modelleert bewust
//     geïnformeerde wedders; alternatieve aanname, niet per se beter.
//
// Alle functies zijn puur, zodat rapportage lokaal, in CI en in de workflows
// identiek rekent.

const EPS = 1e-9;
const OUTCOME_INDEX = { H: 0, D: 1, A: 2 };

// Ruwe impliciete kansen uit decimale odds; null bij ongeldige odds.
export function impliedProbabilities(odds = []) {
  const values = odds.map(Number);
  if (values.length !== 3) return null;
  if (!values.every((value) => Number.isFinite(value) && value > 1.01)) return null;
  return values.map((value) => 1 / value);
}

export function devigMultiplicative(probabilities = []) {
  const values = probabilities.map(Number);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  return values.map((value) => value / total);
}

export function devigPower(probabilities = []) {
  const values = probabilities.map(Number);
  if (!values.every((value) => Number.isFinite(value) && value > 0)) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
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

// Shin: p_i = (sqrt(z^2 + 4(1-z) * p_i^2 / S) - z) / (2(1-z)), z zo dat
// sum(p_i) = 1. S is de som van de ruwe impliciete kansen (de overround-basis).
export function devigShin(probabilities = []) {
  const values = probabilities.map(Number);
  if (!values.every((value) => Number.isFinite(value) && value > 0)) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 1) return values.map((value) => value / total);
  const shinAt = (z) => {
    const denominator = 2 * (1 - z);
    if (denominator <= EPS) return null;
    return values.map(
      (value) => (Math.sqrt(z * z + (4 * (1 - z) * value * value) / total) - z) / denominator,
    );
  };
  // sum(p_i) daalt met z; bij z=0 is de som de overround (>1).
  let low = 0;
  let high = 0.5;
  for (let step = 0; step < 80; step += 1) {
    const middle = (low + high) / 2;
    const mass = shinAt(middle);
    if (!mass) break;
    const sum = mass.reduce((acc, value) => acc + value, 0);
    if (sum > 1) low = middle;
    else high = middle;
  }
  const result = shinAt((low + high) / 2);
  if (!result) return null;
  const sum = result.reduce((acc, value) => acc + value, 0);
  if (!(sum > 0)) return null;
  return result.map((value) => value / sum);
}

export function devigThreeWay(odds = [], method = "multiplicative") {
  const implied = impliedProbabilities(odds);
  if (!implied) return null;
  const devig = method === "power"
    ? devigPower(implied)
    : method === "shin"
      ? devigShin(implied)
      : devigMultiplicative(implied);
  if (!devig) return null;
  return devig.map((value) => Math.round(value * 1000) / 1000);
}

export function outcomeIndex(outcome) {
  return OUTCOME_INDEX[String(outcome || "").toUpperCase()] ?? null;
}

// Normaliseert zonder een ondergrens op te leggen: een kans van 0 blijft 0.
// Eerder stond hier max(EPS, p), waardoor een perfecte voorspelling [1,0,0] niet
// exact nul scoorde op Brier en RPS (de test legde dat bloot). De logloss klemt
// zijn eigen waarde al tegen EPS, dus daar is de ondergrens niet nodig.
function normalise(probabilities = []) {
  const values = probabilities.map((value) => Math.max(0, Number(value) || 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) {
    const size = Math.max(1, values.length);
    return values.map(() => 1 / size);
  }
  return values.map((value) => value / total);
}

// Logloss van de werkelijk opgetreden uitkomst.
export function logLoss3(probabilities, actual) {
  const index = outcomeIndex(actual);
  if (index === null) return null;
  const values = normalise(probabilities);
  return -Math.log(Math.min(1 - EPS, Math.max(EPS, values[index])));
}

// Brier over alle drie de klassen.
export function brier3(probabilities, actual) {
  const index = outcomeIndex(actual);
  if (index === null) return null;
  const values = normalise(probabilities);
  let sum = 0;
  for (let position = 0; position < 3; position += 1) {
    sum += (values[position] - (position === index ? 1 : 0)) ** 2;
  }
  return sum;
}

// Ranked probability score: straft ook afstand in de ordening (H < D < A).
export function rps3(probabilities, actual) {
  const index = outcomeIndex(actual);
  if (index === null) return null;
  const values = normalise(probabilities);
  let cumulativeForecast = 0;
  let score = 0;
  // RPS vergelijkt twee *cumulatieve* verdelingen: de voorspelling en de
  // uitkomst. De cumulatieve uitkomst is een voorraad (1 vanaf de positie van de
  // werkelijke klasse), geen stroom. Eerder werd hier per stap 1 afgetrokken,
  // waardoor [1,0,0] op H niet nul maar 0,5 scoorde.
  for (let position = 0; position < 2; position += 1) {
    cumulativeForecast += values[position];
    const cumulativeOutcome = index <= position ? 1 : 0;
    const difference = cumulativeForecast - cumulativeOutcome;
    score += difference * difference;
  }
  return score / 2;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 4) {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

// rows: [{ lg, d, mp: [h,d,a] marktkansen, y: "H"|"D"|"A", ll, bs }]
//   mp = gede-vigde marktkansen (verplicht)
//   y  = werkelijke uitkomst (verplicht)
//   ll = model-logloss van diezelfde wedstrijd (optioneel, uit de review)
//   bs = model-Brier (optioneel)
// Vergelijkt per competitie bij voldoende steekproef, zodat kleine aantallen
// geen schijnvoordeel opleveren.
export function benchmarkModelVsMarket(rows = [], options = {}) {
  const minLeagueSample = Math.max(1, Number(options.minLeagueSample || 30));
  const overall = { n: 0, market: [], model: [] };
  const leagueState = new Map();

  for (const row of rows || []) {
    const market = Array.isArray(row?.mp) ? row.mp.map(Number) : null;
    const actual = String(row?.y || "").toUpperCase();
    if (!market || market.length !== 3 || !market.every((value) => value > 0 && value < 1)) continue;
    if (outcomeIndex(actual) === null) continue;
    overall.n += 1;
    overall.market.push({
      ll: logLoss3(market, actual),
      bs: brier3(market, actual),
      rps: rps3(market, actual),
    });
    const modelLogLoss = Number(row.ll);
    const modelBrier = Number(row.bs);
    if (Number.isFinite(modelLogLoss)) {
      overall.model.push({
        ll: modelLogLoss,
        bs: Number.isFinite(modelBrier) ? modelBrier : null,
      });
    }
    const league = String(row.lg || "Unknown");
    if (!leagueState.has(league)) leagueState.set(league, { league, n: 0, market: [], model: [] });
    const entry = leagueState.get(league);
    entry.n += 1;
    entry.market.push({
      ll: logLoss3(market, actual),
      bs: brier3(market, actual),
      rps: rps3(market, actual),
    });
    if (Number.isFinite(modelLogLoss)) {
      entry.model.push({
        ll: modelLogLoss,
        bs: Number.isFinite(modelBrier) ? modelBrier : null,
      });
    }
  }

  const summarise = (state) => {
    const marketLogLoss = mean(state.market.map((item) => item.ll).filter(Number.isFinite));
    const marketBrier = mean(state.market.map((item) => item.bs).filter(Number.isFinite));
    const marketRps = mean(state.market.map((item) => item.rps).filter(Number.isFinite));
    const modelLogLoss = mean(state.model.map((item) => item.ll).filter(Number.isFinite));
    const modelBrier = mean(state.model.map((item) => item.bs).filter(Number.isFinite));
    return {
      ...(state.league ? { league: state.league } : {}),
      n: state.n,
      modelN: state.model.length,
      market: {
        logLoss: round(marketLogLoss),
        brier: round(marketBrier),
        rps: round(marketRps),
      },
      model: {
        logLoss: round(modelLogLoss),
        brier: round(modelBrier),
      },
      // Negatief = model beter dan de markt (lagere fout).
      delta: {
        logLoss: modelLogLoss !== null && marketLogLoss !== null
          ? round(modelLogLoss - marketLogLoss)
          : null,
        brier: modelBrier !== null && marketBrier !== null
          ? round(modelBrier - marketBrier)
          : null,
      },
    };
  };

  const summary = summarise(overall);
  return {
    ...summary,
    veredict: summary.delta.logLoss === null
      ? "onvoldoende-gekoppelde-records"
      : summary.delta.logLoss < 0
        ? "model-beter-dan-markt"
        : "markt-beter-dan-model",
    minLeagueSample,
    leagues: [...leagueState.values()]
      .filter((entry) => entry.n >= minLeagueSample)
      .map(summarise)
      .sort((left, right) => right.n - left.n),
  };
}
