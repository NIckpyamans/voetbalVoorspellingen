#!/usr/bin/env node
import fs from "fs";
import path from "path";

const root = process.cwd();
const file = path.join(root, "server_data.json");

if (!fs.existsSync(file)) {
  console.error("[regression-assertions] server_data.json ontbreekt");
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(file, "utf-8"));
const scout = store?.dataScout || {};
const assertions = Array.isArray(scout?.regressionAssertions) ? scout.regressionAssertions : [];
const failedHigh = assertions.filter((item) => !item?.passed && String(item?.severity || "").toLowerCase() === "high");
const failedAny = assertions.filter((item) => !item?.passed);
const degraded = !!scout?.degraded;

console.log(`[regression-assertions] assertions: ${assertions.length}, failed: ${failedAny.length}, failedHigh: ${failedHigh.length}, degraded: ${degraded}`);
for (const row of failedAny) {
  console.log(`[regression-assertions] FAIL ${row.key}: ${row.detail}`);
}

if (degraded || failedHigh.length > 0) {
  console.error("[regression-assertions] high-severity regressie of degraded mode actief");
  process.exit(1);
}

console.log("[regression-assertions] ok");
