#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { gunzipSync, gzipSync } from "zlib";
import { buildR2ObjectKey, getR2Config, putR2Object } from "../shared/cloudflare-r2.js";

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

export function extractBetfairClosingMarkets(lines) {
  const markets = new Map();
  for (const line of lines) {
    let payload;
    try { payload = JSON.parse(line); } catch { continue; }
    const publishedAt = Number(payload.pt || 0);
    for (const marketChange of payload.mc || []) {
      const id = String(marketChange.id || "");
      if (!id) continue;
      const state = markets.get(id) || { marketId: id, runners: {}, prices: {}, snapshots: 0 };
      const definition = marketChange.marketDefinition;
      if (definition) {
        state.eventName = definition.eventName || state.eventName;
        state.marketName = definition.marketType || definition.name || state.marketName;
        state.marketTime = definition.marketTime || state.marketTime;
        for (const runner of definition.runners || []) state.runners[String(runner.id)] = runner.name || String(runner.id);
      }
      const kickoffMs = Date.parse(state.marketTime || "");
      for (const runner of marketChange.rc || []) {
        if (!Number.isFinite(Number(runner.ltp))) continue;
        if (Number.isFinite(kickoffMs) && publishedAt >= kickoffMs) continue;
        state.prices[String(runner.id)] = { selectionId: String(runner.id), name: state.runners[String(runner.id)] || null, odds: Number(runner.ltp), capturedAt: publishedAt ? new Date(publishedAt).toISOString() : null };
        state.snapshots += 1;
      }
      markets.set(id, state);
    }
  }
  return [...markets.values()].filter((market) => market.marketTime && Object.keys(market.prices).length >= 2).map((market) => ({
    provider: "betfair-historical-basic",
    marketId: market.marketId,
    eventName: market.eventName || null,
    marketName: market.marketName || null,
    kickoff: market.marketTime,
    closing: Object.values(market.prices),
    snapshotsObserved: market.snapshots,
    usage: "offline_calibration_only",
  }));
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

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((error) => { console.error(error); process.exit(1); });
