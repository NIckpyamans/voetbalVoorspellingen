// Het marktgewicht van het ensemble fitten op de eigen geschiedenis.
//
// Het marktgewicht stond op 0,16 zonder dat iemand had gemeten of dat klopt.
// Deze module doet die meting wel, op de eigen opgeslagen wedstrijden:
//
//   p(gemengd) = (1 - w) * p(model) + w * p(markt)
//
// Voor elke wedstrijd met een marktkans (mp) en de modelzekerheid van de eigen
// pick (cf) is dat één getal: de kans die het model aan zijn eigen voorspelde
// uitkomst geeft, gemengd met de kans die de markt aan diezelfde uitkomst geeft.
// De logloss van die gemengde kans is de fout die we minimaliseren.
//
// Bewuste beperking, en daarom staat hij hier: alleen de kans op de gekozen
// uitkomst wordt gemengd. De massa op de andere twee uitkomsten zit niet in de
// compacte opslag (alleen de marktverdeling wordt bewaard), dus dit is een
// *partiële* fit. Hij is streng genoeg om te meten of de markt meer of minder
// gewicht verdient, maar niet om de volledige verdeling te herschrijven.
//
// De fit is chronologisch: fitten op de eerste 70% op datum, beoordelen op de
// laatste 30%. Een gewicht dat alleen in-sample beter is, telt niet.

const EPS = 1e-9;
const OUTCOME_INDEX = { H: 0, D: 1, A: 2 };

export const DEFAULT_WEIGHT_GRID = Array.from({ length: 31 }, (_, index) => index / 50); // 0,00 t/m 0,60
// Net begrensd raster voor fits per competitie: met ~75-150 duels per competitie
// is het bovenste deel van het raster (0,4+) ruis. De prior (0,16) en de
// shrinkage vullen de rest aan.
export const PER_COMPETITION_WEIGHT_GRID = Array.from({ length: 19 }, (_, index) => index / 50); // 0,00 t/m 0,36 -> gevormd met de limiet van 0,35
const MIN_SAMPLE = 150;
const MIN_SAMPLE_PER_COMPETITION = 100;
const MAX_PER_COMPETITION_WEIGHT = 0.35;
const SHRINK_TOWARD_CURRENT = 0.5;

function clampProbability(value) {
  return Math.min(1 - EPS, Math.max(EPS, Number(value)));
}

function meanLogLoss(rows, weight) {
  if (!rows.length) return null;
  let total = 0;
  for (const row of rows) {
    const blended = (1 - weight) * row.modelProbability + weight * row.marketProbability;
    total += -Math.log(clampProbability(blended));
  }
  return total / rows.length;
}

function round(value, digits = 4) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? null
    : Math.round(Number(value) * 10 ** digits) / 10 ** digits;
}

// Zet records om naar meetbare rijen. Records zonder marktkans of zonder
// modelzekerheid vallen af; ze kunnen niets over het gewicht zeggen.
export function weightFitRows(records = []) {
  const rows = [];
  for (const record of records || []) {
    if (!record) continue;
    const outcome = OUTCOME_INDEX[String(record.po || "").toUpperCase()];
    if (outcome === undefined) continue;
    const market = Array.isArray(record.mp) ? record.mp.map(Number) : null;
    if (!market || market.length !== 3) continue;
    const marketProbability = market[outcome];
    if (!Number.isFinite(marketProbability) || marketProbability <= 0 || marketProbability >= 1) continue;
    const modelProbability = Number(record.cf);
    if (!Number.isFinite(modelProbability) || modelProbability <= 0 || modelProbability >= 1) continue;
    rows.push({
      date: String(record.d || ""),
      league: String(record.lg || "onbekend"),
      outcome: String(record.po).toUpperCase(),
      hit: typeof record.hit === "boolean" ? record.hit : null,
      modelProbability,
      marketProbability,
    });
  }
  return rows.sort((left, right) => left.date.localeCompare(right.date));
}

// Zoekt het gewicht met de laagste logloss op de trainingsset en toetst dat op
// de holdout. `holdoutImproves` is alleen waar wanneer de holdout er ook op
// vooruitgaat; zonder dat is het gevonden gewicht niet meer dan een vermoeden.
export function fitMarketWeightBlend(records = [], options = {}) {
  const minSample = Math.max(1, Number(options.minSample || MIN_SAMPLE));
  const trainShare = Math.min(0.9, Math.max(0.5, Number(options.trainShare || 0.7)));
  const grid = Array.isArray(options.grid) && options.grid.length
    ? options.grid.map(Number).filter((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    : DEFAULT_WEIGHT_GRID;
  const currentWeight = Number.isFinite(Number(options.current)) ? Number(options.current) : 0.16;

  const rows = weightFitRows(records);
  if (rows.length < minSample) {
    return { sample: rows.length, minSample, available: false, reason: "te-weinig-paren", currentWeight };
  }

  const cut = Math.max(1, Math.min(rows.length - 1, Math.floor(rows.length * trainShare)));
  const train = rows.slice(0, cut);
  const holdout = rows.slice(cut);

  const curve = grid.map((weight) => ({
    weight: round(weight, 3),
    trainLogLoss: round(meanLogLoss(train, weight)),
    holdoutLogLoss: round(meanLogLoss(holdout, weight)),
  }));

  let best = curve[0];
  for (const point of curve) {
    if (point.trainLogLoss !== null && point.trainLogLoss < best.trainLogLoss) best = point;
  }

  const baselineLogLoss = meanLogLoss(holdout, 0);
  const currentLogLoss = meanLogLoss(holdout, currentWeight);
  const bestHoldoutLogLoss = best.holdoutLogLoss;
  // Een verschil van minder dan 0,002 logloss is ruis bij deze steekproeven.
  const improvement = currentLogLoss === null || bestHoldoutLogLoss === null
    ? null
    : currentLogLoss - bestHoldoutLogLoss;

  return {
    sample: rows.length,
    trainSample: train.length,
    holdoutSample: holdout.length,
    minSample,
    available: true,
    grid: grid.length,
    currentWeight: round(currentWeight, 3),
    bestWeight: best.weight,
    trainLogLoss: best.trainLogLoss,
    holdoutLogLoss: bestHoldoutLogLoss,
    currentHoldoutLogLoss: round(currentLogLoss),
    baselineHoldoutLogLoss: round(baselineLogLoss),
    improvement: round(improvement),
    holdoutImproves: improvement !== null && improvement >= 0.002,
    // Het gemeten gewicht is pas een advies als de holdout het bevestigt.
    recommendedWeight: improvement !== null && improvement >= 0.002 ? best.weight : round(currentWeight, 3),
    curve,
  };
}

// Per-competitie-fit met een overfitting-poort.
//
// De globale fit is sterk, maar het model wint per competitie duidelijk uiteen
// (Eredivisie +8,3 procentpunt vs Portugal -20). Fitten per competitie is dus
// zinvol, maar met ~40-160 paren per competitie is het rechtstreeks nemen van
// het best gefitte gewicht overfitten. Er staan daarom vier remmen op:
//
//   1. chronologische splitsing per competitie (zelfde 70/30 als globaal);
//   2. het raster stopt bij 0,35 — nooit gokken op een gewicht dat de data
//      niet ondersteunt;
//   3. shrinkage: het gefitte gewicht gaat halfweg naar de prior (0,16);
//   4. holdout-poort: de shrunk-versie moet op de holdout van die competitie
//      minimaal 0,002 logloss beter zijn dan de vaste prior, anders valt
//      die competitie terug op de prior.
export function fitMarketWeightByCompetition(records = [], options = {}) {
  const minSample = Math.max(1, Number(options.minSamplePerCompetition || MIN_SAMPLE_PER_COMPETITION));
  const trainShare = Math.min(0.9, Math.max(0.5, Number(options.trainShare || 0.7)));
  const grid = Array.isArray(options.grid) && options.grid.length
    ? options.grid.map(Number).filter((value) => Number.isFinite(value) && value >= 0 && value <= 0.5)
    : PER_COMPETITION_WEIGHT_GRID.map((value) => Math.min(value, MAX_PER_COMPETITION_WEIGHT));
  const currentWeight = Number.isFinite(Number(options.current)) ? Number(options.current) : 0.16;
  const shrink = Math.min(1, Math.max(0, Number(options.shrink ?? SHRINK_TOWARD_CURRENT)));

  const rows = weightFitRows(records);
  const byLeague = new Map();
  for (const row of rows) {
    const entry = byLeague.get(row.league) || [];
    entry.push(row);
    byLeague.set(row.league, entry);
  }

  const competitions = [];
  for (const [league, leagueRows] of [...byLeague.entries()].sort((left, right) => right[1].length - left[1].length)) {
    if (leagueRows.length < minSample) {
      competitions.push({
        league,
        sample: leagueRows.length,
        minSample,
        available: false,
        reason: "te-weinig-paren",
        weight: round(currentWeight, 3),
        prior: round(currentWeight, 3),
      });
      continue;
    }
    const cut = Math.max(1, Math.min(leagueRows.length - 1, Math.floor(leagueRows.length * trainShare)));
    const train = leagueRows.slice(0, cut);
    const holdout = leagueRows.slice(cut);

    const curve = grid.map((weight) => ({
      weight: round(weight, 3),
      trainLogLoss: round(meanLogLoss(train, weight)),
      holdoutLogLoss: round(meanLogLoss(holdout, weight)),
    }));
    let best = curve[0];
    for (const point of curve) {
      if (point.trainLogLoss !== null && point.trainLogLoss < best.trainLogLoss) best = point;
    }

    // Shrinkage naar de prior en begrenzing bovenop het raster.
    const rawBest = Number(best.weight);
    const shrunk = Math.min(
      MAX_PER_COMPETITION_WEIGHT,
      Math.max(0, round(currentWeight + (rawBest - currentWeight) * shrink, 3)),
    );
    const priorLogLoss = meanLogLoss(holdout, currentWeight);
    const shrunkLogLoss = meanLogLoss(holdout, shrunk);
    const improvement = priorLogLoss === null || shrunkLogLoss === null
      ? null
      : priorLogLoss - shrunkLogLoss;
    const gatePasses = improvement !== null && improvement >= 0.002;

    competitions.push({
      league,
      sample: leagueRows.length,
      trainSample: train.length,
      holdoutSample: holdout.length,
      minSample,
      available: true,
      bestWeight: best.weight,
      rawBestWeight: round(rawBest, 3),
      shrunkWeight: round(shrunk, 3),
      priorLogLoss: round(priorLogLoss),
      shrunkHoldoutLogLoss: round(shrunkLogLoss),
      improvement: round(improvement),
      gate: gatePasses ? "gehaald" : "niet-gehaald",
      // Zonder poort is het gefitte gewicht een vermoeden, dus niet adverteren.
      recommendedWeight: gatePasses ? round(shrunk, 3) : round(currentWeight, 3),
      holdoutImproves: gatePasses,
    });
  }

  const withFit = competitions.filter((entry) => entry.available);
  const confirmed = withFit.filter((entry) => entry.holdoutImproves);
  return {
    currentWeight: round(currentWeight, 3),
    minSample,
    shrink,
    sample: rows.length,
    competitions,
    competitionsAgreed: confirmed.length,
    competitionsTotal: withFit.length,
    confirmedCompetitions: confirmed.map((entry) => ({
      league: entry.league,
      weight: entry.recommendedWeight,
      improvement: entry.improvement,
      holdoutSample: entry.holdoutSample,
    })),
  };
}
