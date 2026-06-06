#!/usr/bin/env node

import { spawnSync } from "child_process";
import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  console.error("DATABASE_URL of POSTGRES_URL ontbreekt.");
  process.exit(2);
}

const MAX_REQUESTS = Math.max(1, Number(process.env.COVERAGE_REPAIR_BATCH_LIMIT || 12));

await sql.query(`
  update coverage_repair_requests
  set status = 'pending', started_at = null, last_error = 'Automatisch opnieuw ingepland na verlopen running-status.'
  where status = 'running' and started_at < now() - interval '45 minutes'
`);

function runNode(script, args = [], extraEnv = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    timeout: 12 * 60_000,
  });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || `exit ${result.status}`).slice(0, 2000));
  return String(result.stdout || "").slice(-4000);
}

async function processCategory(category) {
  if (category === "weather") {
    return runNode("scripts/import-free-sources.js", ["--source=weather"], { FREE_SOURCE_WEATHER_LIMIT: "600" });
  }
  if (category === "xg") {
    return runNode("scripts/import-free-sources.js", ["--source=statsbomb"], {
      STATSBOMB_EVENT_LIMIT: "120",
      STATSBOMB_COMPETITION_LIMIT: "24",
    });
  }
  if (category === "oddsHistory") {
    return runNode("scripts/import-free-sources.js", ["--source=football-data"], { FREE_SOURCE_IMPORT_LIMIT: "700" });
  }
  if (category === "h2h" || category === "seasonReset") {
    return runNode("scripts/reset-competition-seasons.js");
  }
  throw new Error(`unsupported category: ${category}`);
}

const requests = await sql.query(
  `
    select request_id, competition_id, competition_label, category
    from coverage_repair_requests
    where status = 'pending'
    order by requested_at
    limit $1
  `,
  [MAX_REQUESTS]
);

const categoryResults = new Map();
for (const request of requests) {
  await sql.query(
    `update coverage_repair_requests set status = 'running', started_at = now(), attempts = attempts + 1 where request_id = $1`,
    [request.request_id]
  );
  try {
    if (!categoryResults.has(request.category)) {
      categoryResults.set(request.category, processCategory(request.category));
    }
    const output = await categoryResults.get(request.category);
    await sql.query(
      `
        update coverage_repair_requests
        set status = 'completed', completed_at = now(), result_payload = $2::jsonb, last_error = null
        where request_id = $1
      `,
      [request.request_id, JSON.stringify({ category: request.category, output })]
    );
  } catch (error) {
    await sql.query(
      `update coverage_repair_requests set status = 'failed', completed_at = now(), last_error = $2 where request_id = $1`,
      [request.request_id, String(error?.message || error).slice(0, 2000)]
    );
  }
}

console.log(JSON.stringify({ processed: requests.length, categories: [...categoryResults.keys()] }, null, 2));
