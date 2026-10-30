#!/usr/bin/env node

// Modelrapport: kalibratie, tijdsgewijze validatie, marktbaseline (favoriet én
// kansniveau), datakwaliteit, odds-versheid, lege invoerbronnen, de clubsterkte
// met tijdsverval, de opslagintegriteit, het marktgewicht-advies en één
// gezondheidsoordeel over het geheel.
// Gebruik: node scripts/model-report.js
// Schrijft monitor/model-report.json en print een samenvatting.

import fs from "node:fs";
import path from "node:path";
import { loadMatchStore } from "../shared/matchStore.js";
import { sanitizeMatchStore } from "../shared/matchStoreIntegrity.js";
import {
  calibrationReport,
  dataQualityReport,
  marketBaselineReport,
  sourceHealthReport,
  temporalReport,
} from "../shared/modelMetrics.js";
import { selectCalibration } from "../shared/calibrationFit.js";
import { buildStrengthModel, strengthRows } from "../shared/clubStrength.js";
import { adviseMarketWeight } from "../shared/ensembleWeightPolicy.js";
import { fitMarketWeightBlend, fitMarketWeightByCompetition } from "../shared/ensembleWeightFit.js";
import { assessModelHealth } from "../shared/modelHealth.js";

const dataDir = path.join(process.cwd(), "data");
const monitorDir = path.join(process.cwd(), "monitor");

const { store, fresh, sourceFingerprint } = loadMatchStore(dataDir);
// Dezelfde integriteitscontrole als de build (shared/matchStoreIntegrity.js),
// zodat build en rapportage niet van mening verschillen over een geldig record.
const records = Object.values(store.matches || {});

let meta = {};
try {
  meta = JSON.parse(fs.readFileSync(path.join(dataDir, "meta.json"), "utf8"));
} catch {
  meta = {};
}

let backtest = null;
try {
  backtest = JSON.parse(fs.readFileSync(path.join(monitorDir, "strength-backtest.json"), "utf8"));
} catch {
  backtest = null;
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

// De opslag is de bron van alle cijfers hierboven; leg vast of die zelf schoon
// is, anders rapporteert het model over een vervuilde historie.
const integrity = sanitizeMatchStore(store).report;
report.integrity = integrity;
const weightFit = fitMarketWeightBlend(records);
report.marketWeightFit = {
  available: weightFit.available,
  sample: weightFit.sample,
  trainSample: weightFit.trainSample ?? null,
  holdoutSample: weightFit.holdoutSample ?? null,
  bestWeight: weightFit.bestWeight ?? null,
  holdoutLogLoss: weightFit.holdoutLogLoss ?? null,
  currentHoldoutLogLoss: weightFit.currentHoldoutLogLoss ?? null,
  baselineHoldoutLogLoss: weightFit.baselineHoldoutLogLoss ?? null,
  improvement: weightFit.improvement ?? null,
  holdoutImproves: Boolean(weightFit.holdoutImproves),
  // Paren die afvielen omdat de odds te oud waren: anders lijkt de steekproef
  // groter dan de data die de fit werkelijk droeg.
  droppedStaleOdds: weightFit.droppedStaleOdds ?? 0,
  maxOddsAgeHours: weightFit.maxOddsAgeHours ?? null,
};
report.marketWeight = adviseMarketWeight(report.marketBaseline.probability, { fit: weightFit });
// Per-competitie-fit: gemeten, afgedwongen met dezelfde holdout-poort en
// shrinkage, maar het advies blijft rapportage — de live worker past het niet
// stil aan.
const weightFitByCompetition = fitMarketWeightByCompetition(records);
report.marketWeightFitByCompetition = {
  currentWeight: weightFitByCompetition.currentWeight,
  shrink: weightFitByCompetition.shrink,
  sample: weightFitByCompetition.sample,
  competitionsAgreed: weightFitByCompetition.competitionsAgreed,
  competitionsTotal: weightFitByCompetition.competitionsTotal,
  confirmedCompetitions: weightFitByCompetition.confirmedCompetitions,
  competitions: weightFitByCompetition.competitions,
};
report.health = assessModelHealth({
  store: { matches: records.length },
  integrity,
  calibration: report.calibration,
  dataQuality: report.dataQuality,
  marketBaseline: report.marketBaseline,
  backtest,
});

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
console.log(`Opslagintegriteit: ${integrity.kept} van ${integrity.total} records geldig (${integrity.dropped} verwijderd)`);
console.log(`Lege invoerbronnen: ${report.sourceHealth.empty.join(", ") || "geen"}`);
console.log(`Dunne invoerbronnen: ${report.sourceHealth.thin.join(", ") || "geen"}`);
console.log(`Clubsterkte: ${report.strengths.teams} clubs, basis ${report.strengths.baseGoals} goals/team, thuisvoordeel x${report.strengths.homeAdvantage}`);
console.log(`Marktgewicht-advies: ${report.marketWeight.advised} (huidig ${report.marketWeight.current}, ${report.marketWeight.reason}, n=${report.marketWeight.sample})`);
console.log(
  report.marketWeightFit.available
    ? `Marktgewicht-fit: beste ${report.marketWeightFit.bestWeight} op holdout ${report.marketWeightFit.holdoutLogLoss} tegen ${report.marketWeightFit.currentHoldoutLogLoss} bij huidig gewicht (${report.marketWeightFit.holdoutImproves ? "bevestigd" : "niet bevestigd"}, n=${report.marketWeightFit.holdoutSample})`
    : `Marktgewicht-fit: nog geen meting (${report.marketWeightFit.sample} paren, minimaal 150 nodig)`,
);
console.log(`Per-competitie-fit: ${report.marketWeightFitByCompetition.competitionsAgreed} van ${report.marketWeightFitByCompetition.competitionsTotal} haalt de holdout-poort${report.marketWeightFitByCompetition.confirmedCompetitions.length ? " (" + report.marketWeightFitByCompetition.confirmedCompetitions.map((entry) => `${entry.league}: ${entry.weight}`).join(", ") + ")" : ""}`);
console.log(`Gezondheid: ${report.health.status}${report.health.summary.length ? ` (${report.health.summary.join("; ")})` : ""}`);
for (const entry of report.temporal.periods) {
  console.log(`Periode ${entry.period}: ${entry.decided} beoordeeld, 1X2 ${entry.hitPct}%, exact ${entry.exactPct}%`);
}
