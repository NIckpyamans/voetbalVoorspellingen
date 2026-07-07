#!/usr/bin/env node

import { gzipSync } from "zlib";
import { addDaysToDateKey, todayAmsterdamKey } from "../shared/date.js";
import { databaseConfigured, getSql, loadLocalEnv, readDatabaseDay } from "../shared/database.js";
import { buildR2ObjectKey, getR2Config, putR2Object } from "../shared/cloudflare-r2.js";

const APPLY = process.argv.includes("--apply");
const DAYS = String(process.env.DASHBOARD_CACHE_DAYS || "-1,0,1,2")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value));

loadLocalEnv(process.cwd());
const sql = getSql();
if (!databaseConfigured() || !sql) {
  process.stderr.write("DATABASE_URL of POSTGRES_URL ontbreekt.\n");
  process.exit(2);
}

const r2Config = getR2Config();
const today = todayAmsterdamKey();
const uploads = [];

for (const offset of DAYS) {
  const date = addDaysToDateKey(today, offset);
  const day = await readDatabaseDay(date).catch(() => null);
  const payload = {
    ok: true,
    source: "postgres-r2-dashboard-cache",
    generatedAt: new Date().toISOString(),
    date,
    matches: day?.matches || [],
    predictions: day?.predictions || [],
    totalMatches: Number(day?.matches?.length || 0),
    totalPredictions: Number(day?.predictions?.length || 0),
  };
  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  const compressed = gzipSync(raw, { level: 9 });
  const key = buildR2ObjectKey(r2Config, `dashboard-cache/days/${date}.json.gz`);
  let upload = null;
  if (APPLY && r2Config.configured) {
    upload = await putR2Object({
      config: r2Config,
      key,
      body: compressed,
      contentType: "application/json",
      metadata: {
        source: "dashboard-cache",
        date,
        matches: String(payload.totalMatches),
        predictions: String(payload.totalPredictions),
      },
    });
  }
  uploads.push({
    date,
    objectKey: key,
    matches: payload.totalMatches,
    predictions: payload.totalPredictions,
    bytes: raw.length,
    compressedBytes: compressed.length,
    upload,
  });
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  mode: APPLY ? "apply" : "audit",
  r2Configured: r2Config.configured,
  uploads,
}, null, 2));
