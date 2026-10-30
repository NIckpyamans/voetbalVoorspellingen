#!/usr/bin/env node

// Analyse-bot over de gemiste voorspellingen.
// Gebruik: node scripts/miss-review.js
//
// Leest de compacte wedstrijdopslag (data/match-store.json, gegenereerd uit de
// reviews), evalueert per competitie waar het misging en schrijft één rapport:
//
//   monitor/miss-analysis.json
//
// Het script past niets toe. Voorstellen zijn input voor de bestaande poorten
// (marktgewicht-fit met holdout, kalibratie, databron-reparatie); een voorstel
// wordt dus nooit stil werkelijkheid.

import fs from "node:fs";
import path from "node:path";
import { loadMatchStore } from "../shared/matchStore.js";
import { analysePredictionMisses, annotateProposalsWithWeightGate } from "../shared/missAnalysis.js";

const dataDir = path.join(process.cwd(), "data");
const monitorDir = path.join(process.cwd(), "monitor");
const minSample = Number(process.env.MISS_ANALYSIS_MIN_SAMPLE || 20);

// De marktgewicht-poort (holdout) draait vóór dit script in dezelfde workflow.
// Zijn uitkomst wordt aan de voorstellen gehangen zodat een advies niet los van
// de toets gelezen kan worden: "marktgewicht-omhoog" betekent pas iets als de
// holdout die competitie ook doorlaat.
function readWeightGate() {
  const file = path.join(monitorDir, "market-weight-fit.json");
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return raw?.byCompetition || null;
  } catch {
    return null;
  }
}

const { store, fresh } = loadMatchStore(dataDir);
const records = Object.values(store.matches || {});
const analysis = analysePredictionMisses(records, { minSample });
const weightGate = readWeightGate();
annotateProposalsWithWeightGate(analysis, weightGate);

const report = {
  generatedAt: new Date().toISOString(),
  storeFresh: Boolean(fresh),
  ...analysis,
  weightGate: weightGate
    ? {
      available: true,
      minSample: weightGate.minSample ?? null,
      competitionsAgreed: weightGate.competitionsAgreed ?? null,
      competitionsTotal: weightGate.competitionsTotal ?? null,
    }
    : { available: false },
};

fs.mkdirSync(monitorDir, { recursive: true });
fs.writeFileSync(path.join(monitorDir, "miss-analysis.json"), `${JSON.stringify(report)}\n`);

const overall = analysis.overall;
if (!analysis.sample.decided) {
  console.log(`Analyse-bot: nog geen beoordeelde wedstrijden in de opslag (${records.length} records).`);
  process.exit(0);
}

console.log(
  `Analyse-bot: ${analysis.sample.decided} beoordeelde duels in ${analysis.sample.competitions} competities; `
  + `1X2 ${overall.hitPct}% goed, ${overall.misses} misses.`,
);
console.log(
  `Datakwaliteit bij de voorspelling: ${overall.data.sufficiency.voldoende}x voldoende, `
  + `${overall.data.sufficiency.beperkt}x beperkt, ${overall.data.sufficiency.onvoldoende}x onvoldoende, `
  + `${overall.data.sufficiency.onbekend}x onbekend`
  + `${overall.data.avgCompletenessOnMiss !== null ? `; gemiddelde compleetheid op misses ${overall.data.avgCompletenessOnMiss}` : ""}.`,
);
console.log(
  `Misses zonder volledige invoer: ${overall.data.insufficientMisses} van ${overall.misses}`
  + `${overall.data.insufficientMissShare !== null ? ` (${Math.round(overall.data.insufficientMissShare * 100)}%)` : ""}.`,
);
console.log(
  `Marktvergelijking: model logloss ${overall.market.modelLogLoss ?? "-"} tegen markt ${overall.market.marketLogLoss ?? "-"} `
  + `(${overall.market.veredict || "n/a"}); markt had gelijk bij ${overall.market.disagreeButRight} afwijkende duels.`,
);

for (const competition of analysis.competitions.slice(0, 12)) {
  console.log(
    `${competition.league}: n=${competition.decided} 1X2 ${competition.hitPct}% | `
    + `misses ${competition.misses} | voldoende info ${competition.data.sufficiency.voldoende}/${competition.decided} | `
    + `advies ${competition.proposal.code}`,
  );
}

if (analysis.proposals.length) {
  console.log("Voorstellen (niet toegepast):");
  for (const proposal of analysis.proposals) {
    const gate = proposal.gate
      ? ` | poort ${proposal.gate.status}${
        proposal.gate.minSample && proposal.gate.sample !== null
          ? ` (n=${proposal.gate.sample} < ${proposal.gate.minSample})`
          : ""}`
      : "";
    console.log(`- ${proposal.league}: ${proposal.action} [${proposal.code}, ${proposal.confidence}]${gate}`);
  }
} else {
  console.log("Geen gerichte voorstellen: geen competitie haalt de bewijsdrempel.");
}
for (const note of analysis.notes) {
  console.log(`Let op (${note.code}): ${note.message}`);
}
console.log(`Rapport: monitor/miss-analysis.json`);
