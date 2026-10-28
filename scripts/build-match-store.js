#!/usr/bin/env node

// Bouwt de compacte wedstrijdopslag: data/match-store.json + data/match-index.json.
// Gebruik: node scripts/build-match-store.js
// Uitvoer is minified en deterministisch (geen timestamps), zodat het script
// alleen iets wegschrijft wanneer de brondata echt veranderd is.

import fs from "node:fs";
import path from "node:path";
import {
  buildMatchIndex,
  buildMatchStore,
  collectMatchSources,
  sanitizeMatchStore,
  sourceFingerprint,
} from "../shared/matchStore.js";

const dataDir = path.join(process.cwd(), "data");
const { dayMatches, reviews, marketOdds } = collectMatchSources(dataDir);
const fingerprint = sourceFingerprint(dataDir);
const built = buildMatchStore({ dayMatches, reviews, marketOdds, sourceFingerprint: fingerprint });
// Onmogelijke records (negatieve score, ongeldige datum, team tegen zichzelf)
// horen niet in de historie waarop het model leert. Het rapport maakt zichtbaar
// wat er is weggevallen, zodat een kapotte bron niet stil blijft.
const { store, report: integrity } = sanitizeMatchStore(built);
const index = buildMatchIndex(store);

const storeFile = path.join(dataDir, "match-store.json");
const indexFile = path.join(dataDir, "match-index.json");
fs.writeFileSync(storeFile, JSON.stringify(store));
fs.writeFileSync(indexFile, JSON.stringify(index));

console.log(JSON.stringify({
  matches: Object.keys(store.matches).length,
  teams: Object.keys(index.byTeam).length,
  pairs: Object.keys(index.byPair).length,
  sourceDayMatches: dayMatches.length,
  sourceReviews: Object.keys(reviews).length,
  marketOddsEntries: Object.keys(marketOdds?.entries || {}).length,
  sourceFingerprint: fingerprint,
  integrity,
  marketProbabilities: Object.values(store.matches).filter((record) => Array.isArray(record.mp)).length,
  oddsFreshnessTracked: Object.values(store.matches).filter((record) => record.dq?.f).length,
  storeBytes: fs.statSync(storeFile).size,
  indexBytes: fs.statSync(indexFile).size,
}, null, 2));
