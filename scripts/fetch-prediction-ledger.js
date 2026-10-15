#!/usr/bin/env node
// Haalt de volledige prediction-snapshot-ledger uit R2 (alle maand-shards via de
// gedeelde loader) en schrijft die als gzip-JSON naar data/recovery/ledger-latest.json.gz.
// Faalt hard als R2 niet geconfigureerd is of de ledger leeg is, zodat de monitor
// nooit op lege data draait.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { getR2Config } from "../shared/cloudflare-r2.js";
import { loadSnapshotLedger } from "../shared/predictionSnapshotLedger.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(root, "data", "recovery", "ledger-latest.json.gz");

async function main() {
  const config = getR2Config();
  if (!config.configured) {
    throw new Error("R2 is niet geconfigureerd (CLOUDFLARE_R2_* ontbreekt); ledger niet opgehaald.");
  }

  const { ledger, sources } = await loadSnapshotLedger({ includeLocal: false, config });
  const r2 = sources.r2 || {};
  if (!r2.available) {
    throw new Error(`R2-ledger niet beschikbaar (key ${r2.key}, reden ${r2.reason || "onbekend"}): ${r2.error || "geen fouttekst"}`);
  }
  console.log(`R2-bron: ${r2.legacy ? "legacy-bestand" : `maandshards (${r2.months} maanden)`}, key ${r2.key}`);

  const snapshots = Object.keys(ledger.predictionSnapshots || {}).length;
  const reviews = Object.keys(ledger.postMatchReviews || {}).length;
  if (snapshots === 0) {
    throw new Error("R2-ledger is leeg (0 snapshots); weigeren om verder te gaan.");
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const payload = zlib.gzipSync(Buffer.from(JSON.stringify(ledger), "utf8"));
  fs.writeFileSync(outFile, payload);
  console.log(`Ledger opgehaald: ${snapshots} snapshots, ${reviews} reviews -> data/recovery/ledger-latest.json.gz (${payload.length} bytes)`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
