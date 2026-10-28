#!/usr/bin/env node

// Modelrapport: kalibratie, tijdsgewijze validatie, marktbaseline (favoriet en
// kansniveau), datakwaliteit, odds-versheid, lege invoerbronnen en de
// clubsterkte met tijdsverval, allemaal uitgerekend over de compacte
// wedstrijdopslag.
// Gebruik: node scripts/model-report.js
// Schrijft monitor/model-report.json en print een samenvatting.

import fs from "node:fs";
import path from "node:path";
import { loadMatchStore } from "../shared/matchStore.js";
import {
  calibrationReport,
  dataQualityReport,
  marketBaselineReport,
  sourceHealthReport,
  temporalReport,
} from "../shared/modelMetrics.js";
import { selectCalibration } from "../shared/calibrationFit.js";
import { buildStrengthModel, strengthRows } from "../shared/clubStrength.js";

const dataDir = path.join(process.cwd(), "data");
const monitorDir = path.join(process.cwd(), "monitor");

const { store, fresh, sourceFingerprint } = loadMatchStore(dataDir);
const records = Object.values(store.matches || {});

let meta = {};
try {
  meta = JSON.parse(fs.readFileSync(path.join(dataDir, "meta.json"), "utf8"));
} catch {
  meta = {};
}

const strengthModel = buildStrengthModel(records);
const strengths = strengthRows(strengthModel, { minMatches: 5 });

const report = {
  matches: records.length,
  store: {
    schema: store.schema || null,
    fresh,
    sourceFingerprint,
  },
  calibration: calibrationReport(records),
  calibrationSelection: selectCalibration(records),
  temporal: temporalReport(records),
  marketBaseline: marketBaselineReport(records),
  dataQuality: dataQualityReport(records),
  sourceHealth: sourceHealthReport(meta),
  strengths: {
    asOf: strengthModel.asOf,
    baseGoals: strengthModel.baseGoals,
    homeAdvantage: strengthModel.homeAdvantage,
    halfLifeDays: strengthModel.halfLifeDays,
    teams: Object.keys(strengthModel.teams || {}).length,
    topAttack: strengths.slice(0, 10),
    weakestDefence: [...strengths].sort((left, right) => right.defence - left.defence).slice(0, 10),
  },
};

fs.mkdirSync(monitorDir, { recursive: true });
fs.writeFileSync(path.join(monitorDir, "model-report.json"), `${JSON.stringify(report)}\n`);

const probability = report.marketBaseline.probability || {};
console.log(`Wedstrijden in store: ${report.matches} (${fresh ? "store vers" : "store herbouwd"})`);
console.log(`Kalibratie: hit ${report.calibration.hitPct}% bij gemiddeld vertrouwen ${report.calibration.avgConfidence} (ECE ${report.calibration.ece})`);
console.log(`Gekozen kalibratiemethode: ${report.calibrationSelection.method} (${report.calibrationSelection.reason}, n=${report.calibrationSelection.sample})`);
console.log(`Marktbaseline: model ${report.marketBaseline.modelHitPct}% vs markt ${report.marketBaseline.marketHitPct}% (${report.marketBaseline.n} met odds: ${report.marketBaseline.nPreMatch} pre-match, ${report.marketBaseline.nMarketFile} marktbestand)`);
console.log(`Kansniveau: n=${probability.n} modellogloss ${probability.model?.logLoss ?? "-"} vs markt ${probability.market?.logLoss ?? "-"} (${probability.veredict || "n/a"}); RPS markt ${probability.market?.rps ?? "-"}`);
console.log(`Datakwaliteit: odds beschikbaar op ${report.dataQuality.oddsAvailablePct}% van ${report.dataQuality.withDq} reviews; gemiddelde oddsleeftijd ${report.dataQuality.avgOddsAgeHours ?? "-"} uur`);
console.log(`Odds-versheid: ${JSON.stringify(report.dataQuality.freshness)}`);
console.log(`Lege invoerbronnen: ${report.sourceHealth.empty.join(", ") || "geen"}`);
console.log(`Dunne invoerbronnen: ${report.sourceHealth.thin.join(", ") || "geen"}`);
console.log(`Clubsterkte: ${report.strengths.teams} clubs, basis ${report.strengths.baseGoals} goals/team, thuisvoordeel x${report.strengths.homeAdvantage}`);
for (const entry of report.temporal.periods) {
  console.log(`Periode ${entry.period}: ${entry.decided} beoordeeld, 1X2 ${entry.hitPct}%, exact ${entry.exactPct}%`);
}
