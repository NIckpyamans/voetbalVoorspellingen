#!/usr/bin/env node

// Controleert of de opgeslagen compacte wedstrijdopslag nog bij de brondata
// hoort. De rapporten (clubanalyse, modelrapport, backtest) vertrouwen op
// data/match-store.json; staat daar een oude of half geschreven versie, dan
// rapporteert de app cijfers over een historie die niet meer bestaat.
//
// Gebruik: node scripts/verify-match-store.js
// Exitcode 1 bij een echte afwijking, zodat de workflow stopt voordat er iets
// wordt gecommit of gepubliceerd.

import fs from "node:fs";
import path from "node:path";
import { sourceFingerprint } from "../shared/matchStore.js";
import { buildStoreManifest } from "../shared/matchStoreRemote.js";
import { sanitizeMatchStore } from "../shared/matchStoreIntegrity.js";

const dataDir = path.join(process.cwd(), "data");
const issues = [];
const add = (id, detail) => issues.push({ id, detail });

let store = null;
let index = null;
try {
  store = JSON.parse(fs.readFileSync(path.join(dataDir, "match-store.json"), "utf8"));
} catch {
  add("opslag", "data/match-store.json ontbreekt of is onleesbaar");
}
try {
  index = JSON.parse(fs.readFileSync(path.join(dataDir, "match-index.json"), "utf8"));
} catch {
  add("index", "data/match-index.json ontbreekt of is onleesbaar");
}

let manifest = null;
if (store && index) {
  const fingerprint = sourceFingerprint(dataDir);
  if (!store.src || store.src !== fingerprint) {
    add("fingerprint", `opslag ${store.src || "zonder hash"} hoort niet bij brondata ${fingerprint}`);
  }
  manifest = buildStoreManifest({ store, index });
  if (!manifest.indexMatchesStore) {
    add("index-dekking", `index bevat ${manifest.indexedSlots} teamslots voor ${manifest.matches} wedstrijden`);
  }
  const { report } = sanitizeMatchStore(store);
  if (report.dropped > 0) {
    add("integriteit", `${report.dropped} ongeldige records in de opgeslagen historie`);
  }
}

const result = { ok: issues.length === 0, checkedAt: new Date().toISOString(), issues, manifest };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) {
  console.error(`Match-store controle faalde: ${issues.map((issue) => `${issue.id} (${issue.detail})`).join("; ")}`);
  process.exit(1);
}
