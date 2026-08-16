#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { evaluateDailyQuality } from "./worker/daily-quality-gate.js";

const ROOT = process.cwd();
const readJson = (relativePath, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")); } catch { return fallback; }
};

const meta = readJson("data/meta.json", {});
const dates = Array.isArray(meta?.dates) ? meta.dates : [];
const today = new Date().toISOString().slice(0, 10);
const lower = new Date(`${today}T00:00:00Z`);
lower.setUTCDate(lower.getUTCDate() - 2);
const upper = new Date(`${today}T00:00:00Z`);
upper.setUTCDate(upper.getUTCDate() + 7);
const matches = dates
  .filter((date) => date >= lower.toISOString().slice(0, 10) && date <= upper.toISOString().slice(0, 10))
  .flatMap((date) => (readJson(`data/days/${date}.json`, { matches: [] })?.matches || []).map((match) => ({ ...match, _dateKey: date })));
const report = evaluateDailyQuality({
  matches,
  training: readJson("training/catboost-ready.json", {}),
  providerHealth: readJson("monitor/provider-quota-audit.json", null),
});
const output = path.join(ROOT, "monitor", "daily-quality-gate.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
