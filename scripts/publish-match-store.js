#!/usr/bin/env node

// Publiceert de compacte wedstrijdopslag naar Cloudflare R2, zodat de live
// worker dezelfde historie kan lezen als de analyses in de repo.
// Gebruik: node scripts/publish-match-store.js
// Zonder R2-configuratie slaat het script over (geen fout): lokaal werken en CI
// zonder secrets moeten gewoon door kunnen.
//
// Schrijft monitor/match-store-publish.json met het manifest en de objectgroottes.

import fs from "node:fs";
import path from "node:path";
import { buildR2ObjectKey, getR2Config, putR2Object } from "../shared/cloudflare-r2.js";
import { REMOTE_STORE_KEYS, buildStoreManifest } from "../shared/matchStoreRemote.js";

const dataDir = path.join(process.cwd(), "data");
const monitorDir = path.join(process.cwd(), "monitor");

const storeFile = path.join(dataDir, "match-store.json");
const indexFile = path.join(dataDir, "match-index.json");
if (!fs.existsSync(storeFile) || !fs.existsSync(indexFile)) {
  console.error(JSON.stringify({ ok: false, reason: "match-store-ontbreekt" }));
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(storeFile, "utf8"));
const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
const manifest = buildStoreManifest({ store, index });
if (!manifest.indexMatchesStore) {
  console.error(JSON.stringify({ ok: false, reason: "index-wijkt-af", manifest }));
  process.exit(1);
}

const config = getR2Config();
const result = {
  ok: true,
  generatedAt: manifest.publishedAt,
  configured: config.configured,
  prefix: config.prefix,
  manifest,
  objects: [],
};

if (!config.configured) {
  result.skipped = true;
  result.reason = "r2_not_configured";
} else {
  for (const name of ["store", "index", "manifest"]) {
    const body =
      name === "store"
        ? fs.readFileSync(storeFile)
        : name === "index"
          ? fs.readFileSync(indexFile)
          : Buffer.from(JSON.stringify(manifest), "utf8");
    const upload = await putR2Object({
      config,
      key: buildR2ObjectKey(config, REMOTE_STORE_KEYS[name]),
      body,
      contentType: "application/json",
      metadata: {
        schema: manifest.schema,
        matches: String(manifest.matches),
        fingerprint: manifest.sourceFingerprint || "unknown",
      },
    });
    result.objects.push({
      name,
      key: REMOTE_STORE_KEYS[name],
      bytes: body.length,
      skipped: Boolean(upload?.skipped),
    });
  }
}

fs.mkdirSync(monitorDir, { recursive: true });
fs.writeFileSync(
  path.join(monitorDir, "match-store-publish.json"),
  `${JSON.stringify(result)}\n`,
);
console.log(JSON.stringify(result, null, 2));
