#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { gunzipSync, gzipSync } from "zlib";
import { buildR2ObjectKey, getR2Config, putR2Object } from "../shared/cloudflare-r2.js";
import { extractBetfairClosingMarkets } from "./providers/betfair-history-utils.js";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const INPUT = path.resolve(process.env.BETFAIR_HISTORY_INPUT_DIR || path.join(ROOT, "data", "imports", "betfair"));
const OUTPUT = path.join(ROOT, "monitor", "betfair-historical-import.json");

function filesIn(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(full) : /\.(json|jsonl|gz)$/i.test(entry.name) ? [full] : [];
  });
}

async function main() {
  const files = filesIn(INPUT);
  const records = [];
  const errors = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(file);
      const text = /\.gz$/i.test(file) ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
      records.push(...extractBetfairClosingMarkets(text.split(/\r?\n/).filter(Boolean)));
    } catch (error) { errors.push({ file, error: error?.message || String(error) }); }
  }
  const unique = [...new Map(records.map((record) => [record.marketId, record])).values()];
  const r2 = getR2Config();
  let upload = { ok: false, skipped: true, reason: APPLY ? "r2_not_configured_or_empty" : "dry_run" };
  if (APPLY && r2.configured && unique.length) {
    upload = await putR2Object({
      config: r2,
      key: buildR2ObjectKey(r2, `market-history/betfair/basic-${new Date().toISOString().slice(0, 10)}.jsonl.gz`),
      body: gzipSync(unique.map((record) => JSON.stringify(record)).join("\n")),
      contentType: "application/gzip",
      metadata: { source: "betfair-historical-basic", usage: "offline-calibration-only", records: String(unique.length) },
    });
  }
  const report = { generatedAt: new Date().toISOString(), mode: APPLY ? "apply" : "audit", inputDirectory: INPUT, files: files.length, markets: unique.length, errors, upload, note: "Gebruik uitsluitend voor backtests en marktkalibratie; nooit als actuele odds." };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error); process.exit(1); });
