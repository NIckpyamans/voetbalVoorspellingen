#!/usr/bin/env node
// Eenmalige, deterministische bedrading van de gebatchte feature-context-reader.
// De runner heeft een werkende toolchain; deze sessie kan geen processen starten.
//
//   node scripts/apply-feature-context-batch.js
import fs from "node:fs";

const EDITS = [
  {
    file: "shared/database.js",
    before: `function dbAliasKey(value) {`,
    after: `export function dbAliasKey(value) {`,
  },
  {
    file: "shared/database.js",
    before: `function aliasVariants(value) {`,
    after: `export function aliasVariants(value) {`,
  },
  {
    file: "scripts/server-worker.js",
    before: `import { loadLocalEnv, readDatabaseFeatureContext, syncStoreToDatabase } from "../shared/database.js";`,
    after: `import { loadLocalEnv, readDatabaseFeatureContext, syncStoreToDatabase } from "../shared/database.js";
import { readDatabaseFeatureContextBatch } from "../shared/databaseFeatureContextBatch.js";`,
  },
  {
    file: "scripts/server-worker.js",
    before: `    for (const event of allEvents[date] || []) {
      const leagueInfo = getLeagueInfo(event);
      if (!leagueInfo) continue;`,
    after: `    // Één batch per datumvenster in plaats van zes tot acht Neon-queries per
    // wedstrijd. Mislukt de batch, dan valt de lus hieronder terug op de
    // bestaande enkelvoudige read.
    const dbFeatureContextBatch = await readDatabaseFeatureContextBatch(
      (allEvents[date] || []).map((event) => ({
        matchId: \`ss-\${event.id}\`,
        homeClubId: event.homeTeam?.id ? String(event.homeTeam.id) : null,
        awayClubId: event.awayTeam?.id ? String(event.awayTeam.id) : null,
        competitionId: null,
        dateKey: date,
        homeTeamName: event.homeTeam?.name || "Home",
        awayTeamName: event.awayTeam?.name || "Away",
      }))
    ).catch(() => new Map());

    for (const event of allEvents[date] || []) {
      const leagueInfo = getLeagueInfo(event);
      if (!leagueInfo) continue;`,
  },
  {
    file: "scripts/server-worker.js",
    before: `      const dbFeatureContext = await readDatabaseFeatureContext({`,
    after: `      const dbFeatureContext = dbFeatureContextBatch.has(matchId)
        ? dbFeatureContextBatch.get(matchId)
        : await readDatabaseFeatureContext({`,
  },
];

function replaceOnce(file, oldText, newText) {
  const source = fs.readFileSync(file, "utf8");
  const variants = [
    [oldText, newText],
    [oldText.replace(/\n/g, "\r\n"), newText.replace(/\n/g, "\r\n")],
  ];
  for (const [before, after] of variants) {
    const occurrences = source.split(before).length - 1;
    if (occurrences === 1) {
      fs.writeFileSync(file, source.replace(before, after));
      return true;
    }
    if (occurrences > 1) {
      throw new Error(`${file}: patroon komt ${occurrences}x voor; weiger te gokken`);
    }
  }
  throw new Error(`${file}: patroon niet gevonden; bestand wijkt af van de aanname`);
}

let applied = 0;
for (const edit of EDITS) {
  if (replaceOnce(edit.file, edit.before, edit.after)) applied += 1;
  console.log(`[feature-batch] toegepast: ${edit.file}`);
}
if (applied !== EDITS.length) {
  console.error(`[feature-batch] ${applied}/${EDITS.length} toegepast; afbreken`);
  process.exit(1);
}
console.log(`[feature-batch] ${applied}/${EDITS.length} vervangingen toegepast`);
