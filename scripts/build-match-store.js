#!/usr/bin/env node

// Bouwt de compacte wedstrijdopslag: data/match-store.json + data/match-index.json.
// Gebruik: node scripts/build-match-store.js
// Uitvoer is minified en deterministisch op de bronhash na, zodat het script
// alleen iets wegschrijft wanneer de brondata echt veranderd is. De bronhash
// (src) maakt de versheidscontrole in shared/matchStore.js inhoudelijk in
// plaats van afhankelijk van mtimes.

import fs from "node:fs";
import path from "node:path";
import {
  buildMatchIndex,
  buildMatchStore,
  collectMatchSources,
  sourceFingerprint,
} from "../shared/matchStore.js";

const dataDir = path.join(process.cwd(), "data");
const { dayMatches, reviews, marketOdds } = collectMatchSources(dataDir);
const fingerprint = sourceFingerprint(dataDir);
const store = buildMatchStore({ dayMatches, reviews, marketOdds, sourceFingerprint: fingerprint });
const index = buildMatchIndex(store);

const storeFile = path.join(dataDir, "match-store.json");
const indexFile = path.join(dataDir, "match-index.json");
fs.writeFileSync(storeFile, JSON.stringify(store));
fs.writeFileSync(indexFile, JSON.stringify(index));

const records = Object.values(store.matches);
console.log(JSON.stringify({
  matches: records.length,
  teams: Object.keys(index.byTeam).length,
  pairs: Object.keys(index.byPair).length,
  sourceDayMatches: dayMatches.length,
  sourceReviews: Object.keys(reviews).length,
  marketOddsEntries: Object.keys(marketOdds?.entries || {}).length,
  sourceFingerprint: fingerprint,
  marketProbabilities: records.filter((record) => Array.isArray(record.mp)).length,
  oddsFreshnessTracked: records.filter((record) => record.dq?.f).length,
  storeBytes: fs.statSync(storeFile).size,
  indexBytes: fs.statSync(indexFile).size,
}, null, 2));
