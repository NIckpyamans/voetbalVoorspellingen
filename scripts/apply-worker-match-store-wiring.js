#!/usr/bin/env node

// Eenmalige inktel-hulp voor de match-store-koppeling in scripts/server-worker.js.
//
// Dat bestand is te groot om via de GitHub-API als geheel te versturen, dus
// brengen deze hulp (samen met .github/workflows/apply-worker-wiring.yml) de
// drie wijzigingen aan via exacte regelankers. De hulp is idempotent: was de
// koppeling al toegepast, dan stopt hij zonder nieuwe commit. Na gebruik
// worden hulp en workflow weer verwijderd.
//
// Faalt hard (exit 1) wanneer een anker niet exact één keer voorkomt, zodat er
// nooit een half aangepaste worker ontstaat.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const file = path.join(process.cwd(), "scripts", "server-worker.js");
const original = fs.readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
const lines = original.split(/\r?\n/);

const MARKER = "loadRemoteMatchStoreIndex";
if (original.includes(MARKER)) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "al-toegepast" }));
  process.exit(0);
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, reason: message }));
  process.exit(1);
}

function findUniqueExact(line) {
  const hits = lines.reduce((acc, candidate, index) => (candidate === line ? [...acc, index] : acc), []);
  if (hits.length !== 1) fail(`anker niet exact eenmaal gevonden (${hits.length}x): ${line.slice(0, 80)}`);
  return hits[0];
}

const edits = [];

// 1. Import van de nieuwe module.
const importAnchor = 'import { mergePersistedTeamFormCache } from "./worker/local-team-form-history.js";';
edits.push({
  at: findUniqueExact(importAnchor) + 1,
  lines: ['import { loadRemoteMatchStoreIndex, matchStoreFormProfile } from "./worker/match-store-history.js";'],
});

// 2. Laden van de gepubliceerde opslag bij de start, direct na de snapshot-ledger-log.
const ledgerHits = lines.reduce((acc, candidate, index) => (candidate.includes("[worker] snapshot-ledger:") ? [...acc, index] : acc), []);
if (ledgerHits.length !== 1) fail(`snapshot-ledgeranker niet uniek (${ledgerHits.length}x)`);
let closeIndex = ledgerHits[0];
while (closeIndex < lines.length && lines[closeIndex] !== "  );") closeIndex += 1;
if (closeIndex >= lines.length) fail("afsluiting van de snapshot-ledger-log niet gevonden");
edits.push({
  at: closeIndex + 1,
  lines: [
    "",
    "  // Gepubliceerde compacte wedstrijdopslag uit R2: dezelfde historie als de",
    "  // analyses in de repo. Alleen de samenvatting gaat mee de store in; de index",
    "  // (een Map) blijft in dit proces zodat server_data.json compact blijft.",
    "  const matchStoreRemote = await loadRemoteMatchStoreIndex({ now: Date.now() });",
    "  store.matchStoreRemote = {",
    "    hydratedAt: new Date().toISOString(),",
    "    loaded: matchStoreRemote.loaded,",
    "    matches: matchStoreRemote.matches,",
    "    teams: matchStoreRemote.teams,",
    "    publishedAt: matchStoreRemote.publishedAt,",
    "    sourceFingerprint: matchStoreRemote.sourceFingerprint,",
    "    reason: matchStoreRemote.reason,",
    "  };",
    "  console.log(",
    '    `[worker] match-store (R2): ${matchStoreRemote.loaded ? `${matchStoreRemote.matches} wedstrijden, ${matchStoreRemote.teams} clubs, gepubliceerd ${matchStoreRemote.publishedAt || "onbekend"}` : `niet geladen (${matchStoreRemote.reason || "onbekend"})`}`',
    "  );",
  ],
});

// 3. Samenvoegen van de opslagvorm in homeRecent/awayRecent per voorspelling.
const homeAnchor = '      if (homeSportsDbForm) homeRecent = mergeTeamFormWithExternalRecent(homeRecent, homeSportsDbForm, "thesportsdb-recent-results");';
const homeIndex = findUniqueExact(homeAnchor);
if (!lines[homeIndex + 1]?.includes("awaySportsDbForm) awayRecent = mergeTeamFormWithExternalRecent")) {
  fail("regel na het homeSportsDbForm-anker wijkt af van de verwachting");
}
edits.push({
  at: homeIndex + 2,
  lines: [
    "      // Zelfde historie als de analyses: afgeronde duels uit de gepubliceerde",
    "      // match-store, pas na de providerbronnen zodat verse providerdata leidend blijft.",
    "      const homeMatchStoreForm = matchStoreFormProfile(matchStoreRemote.index, homeName, { now });",
    "      const awayMatchStoreForm = matchStoreFormProfile(matchStoreRemote.index, awayName, { now });",
    "      if (homeMatchStoreForm) homeRecent = mergeTeamFormWithExternalRecent(homeRecent, homeMatchStoreForm, \"match-store-r2\");",
    "      if (awayMatchStoreForm) awayRecent = mergeTeamFormWithExternalRecent(awayRecent, awayMatchStoreForm, \"match-store-r2\");",
  ],
});

// Van onder naar boven invoegen zodat de indices geldig blijven.
const result = [...lines];
for (const edit of edits.sort((left, right) => right.at - left.at)) {
  result.splice(edit.at, 0, ...edit.lines);
}
const next = result.join(eol);
if (next === original) fail("geen wijzigingen aangebracht");

fs.writeFileSync(file, next);

// Syntactische controle vóór de commit: een half aangepaste worker mag nooit
// de repository in.
const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
if (check.status !== 0) {
  fs.writeFileSync(file, original);
  console.error(check.stderr || check.stdout);
  fail("node --check faalde; oorspronkelijk bestand hersteld");
}

const required = [
  'from "./worker/match-store-history.js"',
  "await loadRemoteMatchStoreIndex",
  "matchStoreFormProfile(matchStoreRemote.index, homeName",
];
const missing = required.filter((marker) => !next.includes(marker));
if (missing.length) fail(`koppeling onvolledig, ontbreekt: ${missing.join("; ")}`);

console.log(JSON.stringify({
  ok: true,
  file: "scripts/server-worker.js",
  insertedAt: edits.map((edit) => edit.at),
  markers: (next.match(/loadRemoteMatchStoreIndex/g) || []).length,
  bytes: Buffer.byteLength(next, "utf8"),
}, null, 2));
