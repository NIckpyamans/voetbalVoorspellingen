#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "monitor", "snapshot-db-context.json");
loadLocalEnv(ROOT);
const sql = getSql();
if (!sql) {
  console.error("DATABASE_URL of POSTGRES_URL ontbreekt.");
  process.exit(2);
}

const [summary] = await sql.query(`
  select
    count(*)::int as snapshots,
    count(*) filter (
      where coalesce(input_snapshot->'dbFeatureContext', '{}'::jsonb) <> '{}'::jsonb
         or coalesce(prediction_payload->'dbFeatureContext', '{}'::jsonb) <> '{}'::jsonb
    )::int as snapshots_with_db_context,
    count(*) filter (
      where jsonb_array_length(coalesce(input_snapshot->'dbFeatureContext'->'featureSources', '[]'::jsonb)) > 0
         or jsonb_array_length(coalesce(prediction_payload->'dbFeatureContext'->'featureSources', '[]'::jsonb)) > 0
    )::int as snapshots_with_db_sources,
    max(generated_at) as latest_snapshot_at
  from prediction_snapshots
`);
const total = Math.max(Number(summary.snapshots || 0), 1);
const report = {
  generatedAt: new Date().toISOString(),
  snapshots: Number(summary.snapshots || 0),
  snapshotsWithDbContext: Number(summary.snapshots_with_db_context || 0),
  snapshotsWithDbSources: Number(summary.snapshots_with_db_sources || 0),
  dbContextCoverage: Number((Number(summary.snapshots_with_db_context || 0) / total).toFixed(3)),
  dbSourceCoverage: Number((Number(summary.snapshots_with_db_sources || 0) / total).toFixed(3)),
  latestSnapshotAt: summary.latest_snapshot_at || null,
  recommendation:
    Number(summary.snapshots_with_db_context || 0) / total >= 0.75
      ? "Snapshot DB-context is volwassen; verlaag fallback-verrijking stapsgewijs."
      : "Laat worker-runs doorlopen; behoud fallback-verrijking tot minimaal 75% snapshot DB-contextdekking.",
};
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
