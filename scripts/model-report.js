#!/usr/bin/env node

// Modelrapport: kalibratie, tijdsgewijze validatie, marktbaseline, datakwaliteit
// en lege invoerbronnen, uitgerekend over de compacte wedstrijdopslag.
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

const dataDir = path.join(process.cwd(), "data");
const monitorDir = path.join(process.cwd(), "monitor");

const { store } = loadMatchStore(dataDir);
const records = Object.values(store.matches || {});

let meta = {};
try {
  meta = JSON.parse(fs.readFileSync(path.join(dataDir, "meta.json"), "utf8"));
} catch {
  meta = {};
}

const report = {
  matches: records.length,
  calibration: calibrationReport(records),
  temporal: temporalReport(records),
  marketBaseline: marketBaselineReport(records),
  dataQuality: dataQualityReport(records),
  sourceHealth: sourceHealthReport(meta),
};

fs.mkdirSync(monitorDir, { recursive: true });
fs.writeFileSync(path.join(monitorDir, "model-report.json"), `${JSON.stringify(report)}\n`);

console.log(`Wedstrijden in store: ${report.matches}`);
console.log(`Kalibratie: hit ${report.calibration.hitPct}% bij gemiddeld vertrouwen ${report.calibration.avgConfidence} (ECE ${report.calibration.ece})`);
console.log(`Marktbaseline: model ${report.marketBaseline.modelHitPct}% vs markt ${report.marketBaseline.marketHitPct}% (${report.marketBaseline.n} met odds)`);
console.log(`Datakwaliteit: odds beschikbaar op ${report.dataQuality.oddsAvailablePct}% van ${report.dataQuality.withDq} reviews`);
console.log(`Lege invoerbronnen: ${report.sourceHealth.empty.join(", ") || "geen"}`);
console.log(`Dunne invoerbronnen: ${report.sourceHealth.thin.join(", ") || "geen"}`);
for (const entry of report.temporal.periods) {
  console.log(`Periode ${entry.period}: ${entry.decided} beoordeeld, 1X2 ${entry.hitPct}%, exact ${entry.exactPct}%`);
}
