// Backtest: over 2.5 en BTTS met en zonder xG-shrinkage naar het gemiddelde.
// Gebruik: node scripts/backtest-over-btts-shrinkage.js [pad-naar-ledger.json.gz]
// Standaard: data/recovery/prediction-snapshot-ledger.json.gz
//
// Shrinkage: lambda' = mean + k * (lambda - mean). mean = gemiddelde xG per team
// in de TRAINset (eerste 60% op datum), zodat de holdout niet meekijkt.
// k=1 is ongewijzigd, k=0 is volledig vlak.
// Marktkansen worden Poisson-berekend uit de xG: over 2.5 = P(som > 2.5),
// BTTS = P(thuis > 0) * P(uit > 0). De "opgeslagen" variant gebruikt de kansen
// uit de ledger zelf als referentie.

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.resolve(here, "..", "data", "recovery", "prediction-snapshot-ledger.json.gz");
const ledgerPath = path.resolve(process.argv[2] || defaultPath);
const SHRINK_VALUES = [1, 0.7, 0.5, 0.3, 0];
const EPS = 1e-6;

function loadLedger(file) {
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
  return JSON.parse(text);
}

// P(X <= k) voor X ~ Poisson(lambda)
function poissonCdfUpTo(lambda, k) {
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= k; i += 1) {
    term *= lambda / i;
    sum += term;
  }
  return sum;
}

function marketProbs(homeXG, awayXG) {
  return {
    over25: 1 - poissonCdfUpTo(homeXG + awayXG, 2),
    btts: (1 - Math.exp(-homeXG)) * (1 - Math.exp(-awayXG)),
  };
}

function logLoss(p, y) {
  const q = Math.min(Math.max(p, EPS), 1 - EPS);
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
}

function auc(items) {
  const pos = items.filter((x) => x.y === 1);
  const neg = items.filter((x) => x.y === 0);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const a of pos) {
    for (const b of neg) {
      if (a.p > b.p) wins += 1;
      else if (a.p === b.p) wins += 0.5;
    }
  }
  return wins / (pos.length * neg.length);
}

function metrics(items) {
  if (!items.length) return null;
  let ll = 0;
  let br = 0;
  for (const { p, y } of items) {
    ll += logLoss(p, y);
    br += (p - y) ** 2;
  }
  const a = auc(items);
  return {
    n: items.length,
    auc: a == null ? "n/a" : a.toFixed(3),
    logloss: (ll / items.length).toFixed(4),
    brier: (br / items.length).toFixed(4),
  };
}

function buildRows(ledger) {
  const snapshots = new Map(
    Object.values(ledger.predictionSnapshots || {}).map((s) => [s.predictionId, s])
  );
  const seen = new Set();
  const rows = [];
  for (const review of Object.values(ledger.postMatchReviews || {})) {
    if (seen.has(review.predictionId)) continue;
    seen.add(review.predictionId);
    const snap = snapshots.get(review.predictionId);
    if (!snap) continue;
    const p = snap.prediction || {};
    const values = [p.homeXG, p.awayXG, p.over25, p.btts].map(Number);
    if (!values.every(Number.isFinite)) continue;
    if (typeof review.actualOver25 !== "boolean" || typeof review.actualBtts !== "boolean") continue;
    const league = String(review.league || snap.league || "");
    rows.push({
      date: String(review.date || snap.kickoff || ""),
      league,
      friendly: /friendl/i.test(league),
      homeXG: values[0],
      awayXG: values[1],
      storedOver25: values[2],
      storedBtts: values[3],
      y25: review.actualOver25 ? 1 : 0,
      yBtts: review.actualBtts ? 1 : 0,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

function leagueMeanXG(rows) {
  return rows.reduce((sum, r) => sum + r.homeXG + r.awayXG, 0) / (rows.length * 2);
}

function shrinkFn(mean, k) {
  return (xg) => Math.max(0.05, mean + k * (xg - mean));
}

function main() {
  const rows = buildRows(loadLedger(ledgerPath));
  if (rows.length < 20) throw new Error(`Te weinig gekoppelde wedstrijden: ${rows.length}`);

  const cut = Math.floor(rows.length * 0.6);
  const train = rows.slice(0, cut);
  const holdout = rows.slice(cut);
  const mean = leagueMeanXG(train);

  console.log(`Ledger: ${ledgerPath}`);
  console.log(`Gekoppeld: ${rows.length} (train ${train.length}, holdout ${holdout.length}); gemiddelde xG train=${mean.toFixed(3)}`);
  console.log(`Vriendschappelijk: ${rows.filter((r) => r.friendly).length}`);
  console.log("");

  const variants = [
    { name: "opgeslagen", probsOf: (r) => ({ over25: r.storedOver25, btts: r.storedBtts }) },
    ...SHRINK_VALUES.map((k) => {
      const shrink = shrinkFn(mean, k);
      return {
        name: `poisson k=${k}`,
        probsOf: (r) => marketProbs(shrink(r.homeXG), shrink(r.awayXG)),
      };
    }),
  ];

  const sets = {
    holdout,
    volledig: rows,
    vriendschappelijk: rows.filter((r) => r.friendly),
    overig: rows.filter((r) => !r.friendly),
  };

  for (const [setName, set] of Object.entries(sets)) {
    if (!set.length) continue;
    console.log(`== ${setName} ==`);
    for (const market of ["over25", "btts"]) {
      const yKey = market === "over25" ? "y25" : "yBtts";
      for (const variant of variants) {
        const items = set.map((r) => ({ p: variant.probsOf(r)[market], y: r[yKey] }));
        const m = metrics(items);
        console.log(
          `${market.padEnd(7)} ${variant.name.padEnd(16)} n=${m.n} auc=${m.auc} logloss=${m.logloss} brier=${m.brier}`
        );
      }
    }
    console.log("");
  }
}

main();
