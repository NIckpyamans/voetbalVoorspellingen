#!/usr/bin/env node

// Clubanalyse op de compacte wedstrijdopslag.
// Gebruik: node scripts/club-analysis.js [minimum-beoordeelde-voorspellingen=8] [afwijking-in-procentpunten=15]
// Gebruikt loadMatchStore: de gegenereerde data/match-store.json telt alleen als
// die nieuwer is dan de brondata (data/history-summary.json + data/days); anders
// wordt de store opnieuw gebouwd. Zo raakt de analyse nooit verouderd.
// Schrijft daarnaast monitor/club-analysis.md + monitor/club-analysis.json, zodat
// de vaste sectie 3.6 van het verslag automatisch gevuld kan worden.

import fs from "node:fs";
import path from "node:path";
import {
  aggregateClubPerformance,
  loadMatchStore,
} from "../shared/matchStore.js";

const minMatches = Number(process.argv[2] ?? 8);
const deviation = Number(process.argv[3] ?? 15);
const dataDir = path.join(process.cwd(), "data");
const monitorDir = path.join(process.cwd(), "monitor");

const { store, index } = loadMatchStore(dataDir);

let decided = 0;
let hit = 0;
let exact = 0;
for (const record of Object.values(store.matches)) {
  if (typeof record.hit === "boolean") {
    decided += 1;
    if (record.hit) hit += 1;
  }
  if (record.ex === true) exact += 1;
}
const overallHit = decided ? (hit / decided) * 100 : 0;

const rows = aggregateClubPerformance(store, index, { minMatches })
  .map((row) => ({
    ...row,
    diff: row.hitPct - overallHit,
    flag: Math.abs(row.hitPct - overallHit) >= deviation ? "AFWIJKEND" : "",
  }));

const summary = {
  matches: Object.keys(store.matches).length,
  decided,
  overallHitPct: Math.round(overallHit * 10) / 10,
  exactPct: decided ? Math.round((exact / decided) * 1000) / 10 : 0,
  minMatches,
  deviation,
  clubs: rows,
};

console.log(`Wedstrijden in store: ${summary.matches} | voorspellingen beoordeeld: ${decided} | 1X2 algemeen: ${summary.overallHitPct.toFixed(1)}% | exact: ${summary.exactPct.toFixed(1)}%`);
console.log(`Clubs met >= ${minMatches} beoordeelde voorspellingen: ${rows.length} (afwijking-drempel ${deviation} procentpunten)`);
console.log("");
console.log("| Club | Competitie | Wedstrijden | Beoordeeld | Thuis | Uit | 1X2% | Exact% | Gem. doelpuntfout | Verschil | Vlag |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const row of rows) {
  console.log(
    `| ${row.name} | ${row.league || ""} | ${row.matches} | ${row.n} | ${row.home} | ${row.away} | ${row.hitPct.toFixed(1)} | ${row.exactPct.toFixed(1)} | ${row.goalErr.toFixed(2)} | ${row.diff >= 0 ? "+" : ""}${row.diff.toFixed(1)} | ${row.flag} |`
  );
}

// Monitor-uitvoer voor verslag-sectie 3.6 en de CI-workflow.
fs.mkdirSync(monitorDir, { recursive: true });
const markdown = [
  "# Clubanalyse",
  "",
  `Wedstrijden in store: ${summary.matches} | voorspellingen beoordeeld: ${decided} | 1X2 algemeen: ${summary.overallHitPct.toFixed(1)}% | exact: ${summary.exactPct.toFixed(1)}%`,
  "",
  `Clubs met >= ${minMatches} beoordeelde voorspellingen: ${rows.length} (afwijking-drempel ${deviation} procentpunten)`,
  "",
  "| Club | Competitie | Wedstrijden | Beoordeeld | Thuis | Uit | 1X2% | Exact% | Gem. doelpuntfout | Verschil | Vlag |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(
    (row) => `| ${row.name} | ${row.league || ""} | ${row.matches} | ${row.n} | ${row.home} | ${row.away} | ${row.hitPct.toFixed(1)} | ${row.exactPct.toFixed(1)} | ${row.goalErr.toFixed(2)} | ${row.diff >= 0 ? "+" : ""}${row.diff.toFixed(1)} | ${row.flag} |`,
  ),
  "",
].join("\n");
fs.writeFileSync(path.join(monitorDir, "club-analysis.md"), markdown);
fs.writeFileSync(path.join(monitorDir, "club-analysis.json"), `${JSON.stringify(summary)}\n`);
