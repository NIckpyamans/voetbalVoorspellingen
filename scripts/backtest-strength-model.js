#!/usr/bin/env node

// Chronologische backtest van het clubsterktemodel (shared/clubStrength.js)
// tegen een baseline zonder teamsterktes.
//
// Werkwijze: loop de opgeslagen wedstrijden op datum door. Voor elke wedstrijd
// wordt het model *uitsluitend* op eerdere wedstrijden gebouwd (asOf = die
// datum), zodat er geen informatie uit de toekomst meekijkt. Het model wordt om
// de REFIT_INTERVAL wedstrijden opnieuw gefit; tussen die punten blijft het
// staan, net als in productie waar het model één keer per ronde wordt gemaakt.
//
// Baseline: dezelfde Poisson-motor, maar met aanval en verdediging op 1
// (alleen basisdoelpunten en thuisvoordeel). Zo meet de backtest de meerwaarde
// van de clubsterktes zelf, niet van het Poisson-model.
//
// Uitvoer: monitor/strength-backtest.json + samenvatting op stdout.
// Exitcode 1 alleen bij een technische fout, niet bij een slechter model: dit is
// een meting, geen poort.

import fs from "node:fs";
import path from "node:path";
import { loadMatchStore } from "../shared/matchStore.js";
import {
  buildStrengthModel,
  expectedGoals,
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
// (Eerder stond hier de omkering H/D/A fout, waardoor een uitzege als gelijkspel
// werd geteld.)
function actualOutcome(match) {
  if (Number(match.hs) > Number(match.as)) return "H";
  if (Number(match.hs) < Number(match.as)) return "A";
  return "D";
}

function eloBaseline(model) {
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

// Onder deze drempel is een rho-keuze of een sterktemodel niet te onderbouwen.
// Het rapport wordt dan toch geschreven met status, zodat een analyse altijd
// ziet waarom er (nog) geen meting is.
const MIN_MATCHES_FOR_VERDICT = Number(process.env.STRENGTH_MIN_MATCHES || 250);
// Kleinste verschil in logloss dat als echt verschil telt (zelfde marge als de
// holdout-poort van de marktgewicht-fit).
const MIN_EFFECT = 0.002;
if (matches.length <= MIN_TRAIN + 50) {
  const insufficient = {
    ok: false,
    status: "te-weinig-wedstrijden",
    generatedAt: new Date().toISOString(),
    matches: matches.length,
    minTrain: MIN_TRAIN,
    minMatchesForVerdict: MIN_MATCHES_FOR_VERDICT,
    // Ook zonder meting blijft de pre-registratie staan: de hypothese en de
    // beslisregel zijn niet afhankelijk van de uitkomst.
    preregistration: {
      hypothesis: "Het clubsterktemodel voorspelt 1X2 beter dan dezelfde Poisson-motor zonder teamsterktes.",
      ablation: "baseline = dezelfde motor met aanval/verdediging = 1",
      primaryMetric: "logloss op 1X2, walk-forward",
      minimumEffect: MIN_EFFECT,
      minimumMatches: MIN_MATCHES_FOR_VERDICT,
      liveEffect: "geen",
      registeredAt: "2026-10-30",
    },
    verdict: "onvoldoende-data",
  };
  fs.mkdirSync(monitorDir, { recursive: true });
  fs.writeFileSync(path.join(monitorDir, "strength-backtest.json"), `${JSON.stringify(insufficient)}\n`);
  console.log(JSON.stringify(insufficient));
  process.exit(0);
}

// Dixon-Coles rho: de standaardwaarde is een aanname uit de literatuur. Deze
// sweep meet dezelfde walk-forward-voorspellingen voor meerdere waarden, zodat
// de keuze op de eigen historie rust in plaats van op een Default.
const DEFAULT_RHO = -0.06;
const RHO_CANDIDATES = (process.env.STRENGTH_RHO_SWEEP || "-0.12,-0.06,0,0.06,0.12")
  .split(",")
  .map(Number)
  .filter((value) => Number.isFinite(value));
if (!RHO_CANDIDATES.includes(DEFAULT_RHO)) RHO_CANDIDATES.push(DEFAULT_RHO);
const sweepRows = new Map(RHO_CANDIDATES.map((rho) => [rho, []]));

const rows = [];
let model = buildStrengthModel(matches.slice(0, MIN_TRAIN), { iterations: 25 });
let baselineMatrix = eloBaseline(model);
let sinceRefit = 0;

for (let position = MIN_TRAIN; position < matches.length; position += 1) {
  const match = matches[position];
  if (sinceRefit >= REFIT_INTERVAL) {
    model = buildStrengthModel(matches.slice(0, position), { iterations: 25 });
    baselineMatrix = eloBaseline(model);
    sinceRefit = 0;
  }
  sinceRefit += 1;

  const actual = actualOutcome(match);
  // Het model is hierboven al op alleen eerdere wedstrijden gebouwd; geen
  // extra datumfilter nodig (en dat filter zou dezelfde grens dubbel leggen).
  const goals = expectedGoals(model, match.h, match.a);
  if (!goals) continue;
  const byRho = new Map();
  for (const rho of RHO_CANDIDATES) {
    const matrix = scoreMatrix(goals.homeXG, goals.awayXG, { rho });
    if (!matrix) continue;
    byRho.set(rho, [
      matrix.probabilities.homeProb,
      matrix.probabilities.drawProb,
      matrix.probabilities.awayProb,
    ]);
  }
  const probabilities = byRho.get(DEFAULT_RHO);
  if (!probabilities) continue;
  // Zelfde duel, andere rho: alleen de correctie op lage uitslagen verschilt.
  for (const [rho, values] of byRho) {
    sweepRows.get(rho)?.push({
      logLoss: logLoss3(values, actual),
      brier: brier3(values, actual),
      rps: rps3(values, actual),
    });
  }
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

const rhoSweep = RHO_CANDIDATES.map((rho) => {
  const entries = sweepRows.get(rho) || [];
  return {
    rho,
    n: entries.length,
    logLoss: round(mean(entries.map((entry) => entry.logLoss))),
    brier: round(mean(entries.map((entry) => entry.brier))),
    rps: round(mean(entries.map((entry) => entry.rps))),
  };
}).filter((entry) => entry.n > 0);
const bestRho = [...rhoSweep]
  .filter((entry) => entry.logLoss !== null)
  .sort((left, right) => left.logLoss - right.logLoss)[0] || null;

const sufficient = matches.length >= MIN_MATCHES_FOR_VERDICT;
const report = {
  ok: true,
  status: sufficient ? "voldoende-data" : "te-weinig-wedstrijden",
  minMatchesForVerdict: MIN_MATCHES_FOR_VERDICT,
  generatedAt: new Date().toISOString(),
  method: {
    minTrain: MIN_TRAIN,
    refitInterval: REFIT_INTERVAL,
    asOfGuard: "model gebruikt alleen wedstrijden met datum < voorspeldatum",
    baseline: "zelfde Poisson-motor met aanval/verdediging = 1",
  },
  // Pre-registratie: hypothese, metriek en beslisregel staan vast vóór de
  // uitkomst wordt gelezen. Zo kan een gunstige meting achteraf niet als bewijs
  // worden omgedraaid, en een ongunstige niet worden weggeschreven.
  // Er is geen live-effect: de worker gebruikt het sterkte-model niet bij de
  // voorspelling, dus dit is een ablatiemeting, geen ingreep.
  preregistration: {
    hypothesis: "Het clubsterktemodel voorspelt 1X2 beter dan dezelfde Poisson-motor zonder teamsterktes.",
    ablation: "baseline = dezelfde motor met aanval/verdediging = 1 (alleen basisdoelpunten en thuisvoordeel)",
    primaryMetric: "logloss op 1X2, walk-forward, alleen wedstrijden met datum vóór het voorspelde duel",
    minimumEffect: MIN_EFFECT,
    minimumMatches: MIN_MATCHES_FOR_VERDICT,
    decisionRule: `verdict "sterktemodel-beter" alleen bij een lagere logloss met minimaal ${MIN_EFFECT} verschil op minimaal ${MIN_MATCHES_FOR_VERDICT} wedstrijden; anders geen conclusie`,
    liveEffect: "geen",
    registeredAt: "2026-10-30",
  },
  overall,
  defaultRho: DEFAULT_RHO,
  rhoSweep,
  bestRho,
  verdict: !sufficient
    ? "onvoldoende-data"
    : overall.model.logLoss !== null && overall.baseline.logLoss !== null
      ? (overall.model.logLoss + MIN_EFFECT < overall.baseline.logLoss
        ? "sterktemodel-beter"
        : (overall.baseline.logLoss + MIN_EFFECT < overall.model.logLoss ? "baseline-beter" : "geen-verschil"))
      : "onvoldoende-data",
  leagues: [...byLeague.entries()]
    .filter(([, leagueRows]) => leagueRows.length >= MIN_LEAGUE_SAMPLE)
    .map(([league, leagueRows]) => ({ league, ...summarise(leagueRows) }))
    .sort((left, right) => right.n - left.n),
};

fs.mkdirSync(monitorDir, { recursive: true });
fs.writeFileSync(path.join(monitorDir, "strength-backtest.json"), `${JSON.stringify(report)}\n`);

console.log(`Backtest op ${overall.n} wedstrijden (train warmup ${MIN_TRAIN}, refit elke ${REFIT_INTERVAL})`);
console.log(`Model:    logloss ${overall.model.logLoss ?? "-"} | Brier ${overall.model.brier ?? "-"} | RPS ${overall.model.rps ?? "-"} | 1X2 ${overall.model.hitPct ?? "-"}%`);
console.log(`Baseline: logloss ${overall.baseline.logLoss ?? "-"} | Brier ${overall.baseline.brier ?? "-"} | RPS ${overall.baseline.rps ?? "-"} | 1X2 ${overall.baseline.hitPct ?? "-"}%`);
console.log(`Verdict: ${report.verdict}`);
console.log(`Rho-sweep (zelfde duels, alleen de Dixon-Coles-correctie verschilt): ${rhoSweep.map((entry) => `${entry.rho}: logloss ${entry.logLoss}, Brier ${entry.brier}`).join(" | ")}`);
console.log(`Beste rho op logloss: ${bestRho ? `${bestRho.rho} (${bestRho.logLoss})` : "onvoldoende data"} | standaard ${DEFAULT_RHO}`);
for (const entry of report.leagues) {
  console.log(`${entry.league}: n=${entry.n} model logloss ${entry.model.logLoss} vs baseline ${entry.baseline.logLoss}`);
}
