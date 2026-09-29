// Marktsterkte en CLV/ROI-tracking: overround (bookmakersmarge) per competitie
// en closing-line-value op basis van timestamped oddsparen. Publicatie van
// ROI/CLV-waarden blijft geblokkeerd totdat er genoeg paren zijn, zodat kleine
// steekproeven geen betrouwbaar signaal suggereren.

export function overroundOf(home, draw, away) {
  const values = [Number(home), Number(draw), Number(away)];
  if (!values.every((value) => Number.isFinite(value) && value > 1.01)) return 0;
  return (1 / values[0] + 1 / values[1] + 1 / values[2]) - 1;
}

// Verwijdert de bookmakersmarge zodat implied probabilities optellen tot 1.
export function removeVig(home, draw, away) {
  const total = (1 / Number(home)) + (1 / Number(draw)) + (1 / Number(away));
  if (!(total > 0)) return { home: 0, draw: 0, away: 0 };
  return {
    home: Number((1 / Number(home) / total).toFixed(4)),
    draw: Number((1 / Number(draw) / total).toFixed(4)),
    away: Number((1 / Number(away) / total).toFixed(4)),
  };
}

// rows: [{ league, home, draw, away, closingHome, closingDraw, closingAway }]
export function buildOverroundProfiles(rows = []) {
  const byLeague = new Map();
  for (const row of rows) {
    const league = String(row?.league || "onbekend");
    const entry = byLeague.get(league) || { league, samples: 0, closingSamples: 0, overroundSum: 0, closingOverroundSum: 0 };
    const overround = overroundOf(row?.home, row?.draw, row?.away);
    if (overround > 0) {
      entry.samples += 1;
      entry.overroundSum += overround;
    }
    const closingOverround = overroundOf(row?.closingHome, row?.closingDraw, row?.closingAway);
    if (closingOverround > 0) {
      entry.closingSamples += 1;
      entry.closingOverroundSum += closingOverround;
    }
    byLeague.set(league, entry);
  }
  return [...byLeague.values()].map((entry) => ({
    league: entry.league,
    samples: entry.samples,
    closingSamples: entry.closingSamples,
    avgOverround: entry.samples ? Number((entry.overroundSum / entry.samples).toFixed(4)) : null,
    avgClosingOverround: entry.closingSamples ? Number((entry.closingOverroundSum / entry.closingSamples).toFixed(4)) : null,
  })).sort((left, right) => right.closingSamples - left.closingSamples || right.samples - left.samples);
}

// rows: evaluaties met rolgetelde odds: [{ league, roi, clv, hasTimestampedPair }]
export function buildClvTracker(rows = [], options = {}) {
  const minPairs = Math.max(1, Number(options.minPairs || 100));
  const pairs = rows.filter((row) => row?.clv != null);
  const roiRows = rows.filter((row) => row?.roi != null);
  const active = pairs.length >= minPairs;
  const byLeague = {};
  for (const row of pairs) {
    const league = String(row?.league || "onbekend");
    const entry = byLeague[league] || { league, pairs: 0, clvSum: 0 };
    entry.pairs += 1;
    entry.clvSum += Number(row.clv);
    byLeague[league] = entry;
  }
  return {
    status: active ? "active" : "collecting",
    minPairs,
    timestampedPairs: pairs.length,
    roiSamples: roiRows.length,
    pairGap: Math.max(0, minPairs - pairs.length),
    avgClv: active ? Number((pairs.reduce((sum, row) => sum + Number(row.clv), 0) / pairs.length).toFixed(4)) : null,
    avgRoi: active && roiRows.length ? Number((roiRows.reduce((sum, row) => sum + Number(row.roi), 0) / roiRows.length).toFixed(4)) : null,
    byLeague: Object.values(byLeague)
      .map((entry) => ({ league: entry.league, pairs: entry.pairs, avgClv: Number((entry.clvSum / entry.pairs).toFixed(4)) }))
      .sort((left, right) => right.pairs - left.pairs),
    policy: active
      ? "ROI/CLV publiceerbaar; timestamped paren boven de drempel."
      : "Verzamelfase: ROI/CLV nog niet publiceerbaar totdat er genoeg timestamped paren zijn.",
  };
}
