#!/usr/bin/env node

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { buildR2ObjectKey, getR2Config, putR2Object } from "../shared/cloudflare-r2.js";
import { buildWk2026ReferenceManifest } from "../shared/wk2026-reference-archive.js";

const ROOT = process.cwd();
const SOURCE_BASE = String(process.env.WK2026_ORAKEL_SOURCE_URL || "https://wk-2026-orakel.vercel.app").replace(/\/+$/, "");
const MANIFEST_PATH = path.join(ROOT, "data", "archives", "wk-2026-orakel-reference.json");
const MAX_FILE_BYTES = 1_500_000;
const DATASETS = [
  "data/model-snapshot.json",
  "data/monitor-status.json",
  "data/source-health.json",
  "data/source-adapter-snapshot.json",
  "data/model-feature-flags.json",
  "data/team-player-analysis.json",
  "data/player-availability-feed.json",
  "data/match-results.json",
  "data/build-info.json",
  "data/predictions/wk26-current.json",
  "data/predictions/wk26-evaluation.json",
];

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function archiveName(relativePath) {
  return relativePath.replace(/^data\//, "").replace(/\//g, "__");
}

export function buildReferenceManifest({ capturedAt, datasets }) {
  return buildWk2026ReferenceManifest({ sourceUrl: SOURCE_BASE, capturedAt, datasets });
}

async function fetchDataset(relativePath) {
  const url = `${SOURCE_BASE}/${relativePath}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${relativePath}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error(`${relativePath}: ongeldig formaat of groter dan ${MAX_FILE_BYTES} bytes`);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${relativePath}: geen geldig JSON-document`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error(`${relativePath}: leeg JSON-document`);
  return { relativePath, url, bytes, parsed };
}

async function main() {
  const capturedAt = new Date().toISOString();
  const config = getR2Config();
  if (!config.configured) throw new Error("Cloudflare R2 is niet geconfigureerd; archiveer deze referentiedata alleen via de GitHub-workflow met R2-secrets.");

  const datasets = [];
  for (const relativePath of DATASETS) {
    const item = await fetchDataset(relativePath);
    const hash = digest(item.bytes);
    const key = buildR2ObjectKey(config, `external-archives/wk-2026-orakel/current/${archiveName(relativePath)}`);
    const upload = await putR2Object({
      config,
      key,
      body: item.bytes,
      contentType: "application/json",
      metadata: { source: "wk-2026-orakel", path: relativePath, sha256: hash },
    });
    datasets.push({
      path: relativePath,
      sourceUrl: item.url,
      r2Key: upload.key,
      bytes: item.bytes.length,
      sha256: hash,
      topLevelKeys: Object.keys(item.parsed).slice(0, 30),
    });
  }

  const manifest = buildReferenceManifest({ capturedAt, datasets });
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestKey = buildR2ObjectKey(config, "external-archives/wk-2026-orakel/current/manifest.json");
  await putR2Object({ config, key: manifestKey, body: manifestBody, contentType: "application/json", metadata: { source: "wk-2026-orakel" } });
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, manifestBody);
  console.log(JSON.stringify({ ok: true, source: SOURCE_BASE, datasets: datasets.length, bytes: datasets.reduce((sum, item) => sum + item.bytes, 0), manifestPath: path.relative(ROOT, MANIFEST_PATH), manifestKey }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[wk2026-reference-archive] ${error?.message || error}`);
    process.exit(1);
  });
}
