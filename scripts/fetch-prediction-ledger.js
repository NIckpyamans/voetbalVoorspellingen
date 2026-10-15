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

  const totalSnapshots = Object.keys(ledger.predictionSnapshots || {}).length;
  if (totalSnapshots === 0) {
    throw new Error("R2-ledger is leeg (0 snapshots); weigeren om verder te gaan.");
  }

  // De volledige ledger als één JSON-string overschrijdt de V8-stringlimiet. De monitor
  // heeft alleen de recente reviews nodig, plus de snapshots die daarbij horen.
  const days = Number(process.env.MONITOR_WINDOW_DAYS || 30);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const postMatchReviews = Object.fromEntries(
    Object.entries(ledger.postMatchReviews || {}).filter(([, review]) => String(review?.date || "") >= cutoff)
  );
  const wantedIds = new Set(Object.values(postMatchReviews).map((review) => review?.predictionId).filter(Boolean));
  const predictionSnapshots = Object.fromEntries(
    Object.entries(ledger.predictionSnapshots || {}).filter(([id]) => wantedIds.has(id))
  );
  const reviews = Object.keys(postMatchReviews).length;

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const payload = zlib.gzipSync(
    Buffer.from(JSON.stringify({ generatedAt: new Date().toISOString(), window: { days, cutoff }, predictionSnapshots, postMatchReviews }), "utf8")
  );
  fs.writeFileSync(outFile, payload);
  console.log(`Ledger opgehaald: ${totalSnapshots} snapshots totaal; venster ${cutoff}+ bewaard: ${Object.keys(predictionSnapshots).length} snapshots, ${reviews} reviews -> data/recovery/ledger-latest.json.gz (${payload.length} bytes)`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
