#!/usr/bin/env node

// Meet het marktgewicht van het ensemble op de eigen wedstrijdgeschiedenis en
// schrijft het resultaat naar monitor/market-weight-fit.json.
// Gebruik: node scripts/fit-market-weight.js
//
// Dit script verandert niets aan de live worker. Het levert de meting waarop
// shared/ensembleWeightPolicy.js zijn advies baseert, zodat het gewicht niet
// langer een aanname is.

import fs from "node:fs";
import path from "node:path";
import { loadMatchStore } from "../shared/matchStore.js";
import { fitMarketWeightBlend, fitMarketWeightByCompetition } from "../shared/ensembleWeightFit.js";
import { DEFAULT_MARKET_WEIGHT } from "../shared/ensembleWeightPolicy.js";

const dataDir = path.join(process.cwd(), "data");
const monitorDir = path.join(process.cwd(), "monitor");

const { store } = loadMatchStore(dataDir);
const records = Object.values(store.matches || {});
const fit = fitMarketWeightBlend(records, { current: DEFAULT_MARKET_WEIGHT });
const byCompetition = fitMarketWeightByCompetition(records, { current: DEFAULT_MARKET_WEIGHT });

const result = {
  generatedAt: new Date().toISOString(),
  matches: records.length,
  ...fit,
  byCompetition,
};

fs.mkdirSync(monitorDir, { recursive: true });
fs.writeFileSync(path.join(monitorDir, "market-weight-fit.json"), `${JSON.stringify(result)}\n`);

if (!fit.available) {
  console.log(`Marktgewicht: geen meting (${fit.reason}, ${fit.sample} paren van ${fit.minSample} nodig).`);
  process.exit(0);
}

console.log(
  `Marktgewicht: beste ${fit.bestWeight} op ${fit.trainSample} train-duels; `
  + `holdout ${fit.holdoutLogLoss} tegen ${fit.currentHoldoutLogLoss} bij huidig ${fit.currentWeight} `
  + `(model zonder markt ${fit.baselineHoldoutLogLoss}, n=${fit.holdoutSample}).`,
);
console.log(
  fit.holdoutImproves
    ? `Advies: gewicht naar ${fit.recommendedWeight} (holdout ${fit.improvement} logloss beter).`
    : `Advies: gewicht houden op ${fit.recommendedWeight}; de holdout bevestigt geen verbetering.`,
);
console.log(
  `Per competitie: ${byCompetition.competitionsAgreed} van ${byCompetition.competitionsTotal} haalt de holdout-poort`
  + `${byCompetition.confirmedCompetitions.length ? " (" + byCompetition.confirmedCompetitions.map((entry) => `${entry.league}: ${entry.weight}`).join(", ") + ")" : ""}.`
  + ` Competitieverslecht ${byCompetition.currentWeight} prior met ${byCompetition.shrink}x shrinkage en 0,35 grens.`
  + ` Competities zonder de poort blijven ${byCompetition.currentWeight}.`
);
