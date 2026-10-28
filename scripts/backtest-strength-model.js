#!/usr/bin/env node

// Chronologische backtest van het clubsterktemodel (shared/clubStrength.js)
// tegen een baseline zonder teamsterktes.
//
// Werkwijze: loop de opgeslagen wedstrijden op datum door. Voor elke wedstrijd
// wordt het model uitsluitend op eerdere wedstrijden gebouwd, zodat er geen
// informatie uit de toekomst meekijkt. Het model wordt om de REFIT_INTERVAL
// wedstrijden opnieuw gefit; tussen die punten blijft het staan, net als in
// productie waar het model een keer per ronde wordt gemaakt.
//
// Baseline: dezelfde Poisson-motor, maar met aanval en verdediging op 1 (alleen
// basisdoelpunten en thuisvoordeel). Zo meet de backtest de meerwaarde van de
// clubsterktes zelf, niet van het Poisson-model.
//
// Uitvoer: monitor/strength-backtest.json + samenvatting op stdout.
// Exitcode 1 alleen bij een technische fout, niet bij een slechter model: dit is
// een meting, geen poort.

import fs from "node:fs";
import path from "node:path";
import { loadMatchStore } from "../shared/matchStore.js";
import {
  buildStrengthModel,
  predictFromStrength,
  scoreMatrix,
} from "../shared/clubStrength.js";
import { brier3, logLoss3, rps3 } from "../shared/marketBenchmark.js";

const dataDir = path.join(process.cwd(), "data");
const monitorDir = path.join(process.cwd(), "monitor");

const MIN_TRAIN = Number(process.env.STRENGTH_MIN_TRAIN || 200);
const REFIT_INTERVAL = Number(process.env.STRENGTH_REFIT_INTERVAL || 40);
const MIN_LEAGUE_SAMPLE = Number(process.env.STRENGTH_MIN_LEAGUE_SAMPLE || 50);

const { store } = loadMatchStore(dataDir);

const matches = Object.values(store.matches || {})
  .filter((record) => record && record.d && record.h && record.a)
  .filter((record) => Number.isFinite(Number(record.hs)) && Number.isFinite(Number(record.as)))
  .sort((left, right) => String(left.d).localeCompare(String(right.d)));

// De uitslag volgt uit de doelpunten; het ao-veld is alleen een controle.
function actualOutcome(match) {
  if (Number(match.hs) > Number(match.as)) return "H";
  if (Number(match.hs) < Number(match.as)) return "A";
  return "D";
}

function baselineMatrixOf(model) {
  // Baseline zonder teamsterkte: alleen basisdoelpunten en thuisvoordeel.
  return scoreMatrix(
    (model.baseGoals || 1.35) * (model.homeAdvantage || 1.1),
    model.baseGoals || 1.35,
  );
}

function mean(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function round(value, digits = 4) {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

function summarise(rows) {
  return {
    n: rows.length,
    model: {
      logLoss: round(mean(rows.map((row) => row.model.logLoss))),
      brier: round(mean(rows.map((row) => row.model.brier))),
      rps: round(mean(rows.map((row) => row.model.rps))),
      hitPct: round((rows.filter((row) => row.model.hit).length / Math.max(1, rows.length)) * 100, 1),
    },
    baseline: {
      logLoss: round(mean(rows.map((row) => row.baseline.logLoss))),
      brier: round(mean(rows.map((row) => row.baseline.brier))),
      rps: round(mean(rows.map((row) => row.baseline.rps))),
      hitPct: round((rows.filter((row) => row.baseline.hit).length / Math.max(1, rows.length)) * 100, 1),
    },
  };
}

if (matches.length <= MIN_TRAIN + 50) {
  console.error(JSON.stringify({ ok: false, reason: "te-weinig-wedstrijden", matches: matches.length, minTrain: MIN_TRAIN }));
  process.exit(0);
}

const rows = [];
let model = buildStrengthModel(matches.slice(0, MIN_TRAIN), { iterations: 25 });
let baselineMatrix = baselineMatrixOf(model);
let sinceRefit = 0;

for (let position = MIN_TRAIN; position < matches.length; position += 1) {
  const match = matches[position];
  if (sinceRefit >= REFIT_INTERVAL) {
    model = buildStrengthModel(matches.slice(0, position), { iterations: 25 });
    baselineMatrix = baselineMatrixOf(model);
    sinceRefit = 0;
  }
  sinceRefit += 1;

  const actual = actualOutcome(match);
  const prediction = predictFromStrength(model, match.h, match.a);
  if (!prediction) continue;
  const probabilities = [
    prediction.probabilities.homeProb,
    prediction.probabilities.drawProb,
    prediction.probabilities.awayProb,
  ];
  const baseline = [
    baselineMatrix.probabilities.homeProb,
    baselineMatrix.probabilities.drawProb,
    baselineMatrix.probabilities.awayProb,
  ];
  const pickOutcome = (values) => {
    const index = values.indexOf(Math.max(...values));
    return index === 0 ? "H" : index === 1 ? "D" : "A";
  };
  rows.push({
    d: match.d,
    lg: match.lg || "Unknown",
    model: {
      logLoss: logLoss3(probabilities, actual),
      brier: brier3(probabilities, actual),
      rps: rps3(probabilities, actual),
      hit: pickOutcome(probabilities) === actual,
    },
    baseline: {
      logLoss: logLoss3(baseline, actual),
      brier: brier3(baseline, actual),
      rps: rps3(baseline, actual),
      hit: pickOutcome(baseline) === actual,
    },
  });
}

const overall = summarise(rows);
const byLeague = new Map();
for (const row of rows) {
  const entry = byLeague.get(row.lg) || [];
  entry.push(row);
  byLeague.set(row.lg, entry);
}

const report = {
  ok: true,
  generatedAt: new Date().toISOString(),
  method: {
    minTrain: MIN_TRAIN,
    refitInterval: REFIT_INTERVAL,
    asOfGuard: "model gebruikt alleen wedstrijden met datum voor de voorspeldatum",
    baseline: "zelfde Poisson-motor met aanval/verdediging = 1",
  },
  overall,
  verdict: overall.model.logLoss !== null && overall.baseline.logLoss !== null
    ? (overall.model.logLoss < overall.baseline.logLoss ? "sterktemodel-beter" : "baseline-beter")
    : "onvoldoende-data",
  leagues: [...byLeague.entries()]
    .filter(([, leagueRows]) => leagueRows.length >= MIN_LEAGUE_SAMPLE)
    .map(([league, leagueRows]) => ({ league, ...summarise(leagueRows) }))
    .sort((left, right) => right.n - left.n),
};

fs.mkdirSync(monitorDir, { recursive: true });
fs.writeFileSync(path.join(monitorDir, "strength-backtest.json"), `${JSON.stringify(report)}\n`);

console.log(`Backtest op ${overall.n} wedstrijden (warmup ${MIN_TRAIN}, refit elke ${REFIT_INTERVAL})`);
console.log(`Model:    logloss ${overall.model.logLoss ?? "-"} | Brier ${overall.model.brier ?? "-"} | RPS ${overall.model.rps ?? "-"} | 1X2 ${overall.model.hitPct ?? "-"}%`);
console.log(`Baseline: logloss ${overall.baseline.logLoss ?? "-"} | Brier ${overall.baseline.brier ?? "-"} | RPS ${overall.baseline.rps ?? "-"} | 1X2 ${overall.baseline.hitPct ?? "-"}%`);
console.log(`Verdict: ${report.verdict}`);
for (const entry of report.leagues) {
  console.log(`${entry.league}: n=${entry.n} model logloss ${entry.model.logLoss} vs baseline ${entry.baseline.logLoss}`);
}
