#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildR2ObjectKey, getR2Config, putR2Object } from "../shared/cloudflare-r2.js";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const OUTPUT = path.join(ROOT, "monitor", "open-training-data-sync.json");
const MAX_BYTES = Math.max(1, Number(process.env.OPEN_TRAINING_DATA_MAX_BYTES || 400 * 1024 * 1024));
const SOURCES = [
  { key: "skillcorner-open-data.zip", url: "https://github.com/SkillCorner/opendata/archive/refs/heads/master.zip", license: "MIT", purpose: "tracking_physical_and_off_ball_model_research" },
  { key: "metrica-sample-data.zip", url: "https://github.com/metrica-sports/sample-data/archive/refs/heads/master.zip", license: "source_acknowledgement_required", purpose: "tracking_and_event_pipeline_tests" },
  { key: "wyscout-public-events.zip", url: "https://figshare.com/ndownloader/collections/4415000/versions/5", license: "research_dataset_terms", purpose: "historical_event_feature_research" },
];

async function main() {
  const r2 = getR2Config();
  const rows = [];
  for (const source of SOURCES) {
    try {
      const response = await fetch(source.url, { headers: { "User-Agent": "voetbalvoorspellingen-training-reference/1.0" }, redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_BYTES) { rows.push({ ...source, status: "skipped_too_large", bytes: declared }); continue; }
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > MAX_BYTES) { rows.push({ ...source, status: "skipped_too_large", bytes: body.length }); continue; }
      const upload = APPLY && r2.configured ? await putR2Object({
        config: r2,
        key: buildR2ObjectKey(r2, `training-reference/open-data/latest/${source.key}`),
        body,
        contentType: "application/zip",
        metadata: { source: source.key, purpose: source.purpose, trainingOnly: "true" },
      }) : { ok: false, skipped: true, reason: APPLY ? "r2_not_configured" : "dry_run" };
      rows.push({ ...source, status: "downloaded", bytes: body.length, upload });
    } catch (error) { rows.push({ ...source, status: "failed", error: error?.message || String(error) }); }
  }
  const report = { schemaVersion: "open-training-data-v1", generatedAt: new Date().toISOString(), activeFixtureUseAllowed: false, rows };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((error) => { console.error(error); process.exit(1); });
