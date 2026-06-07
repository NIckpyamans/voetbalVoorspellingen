#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const policies = [
  ["matches", "kickoff_at", "range", "yearly", 5000000],
  ["historical_odds_snapshots", "captured_at", "range", "monthly", 10000000],
  ["odds_snapshots", "captured_at", "range", "monthly", 5000000],
  ["prediction_snapshots", "generated_at", "range", "monthly", 5000000],
  ["source_audit", "source_audit_id", "range", "id-block-5000000", 10000000],
  ["integrity_metric_snapshots", "captured_at", "range", "yearly", 1000000],
];
const report = [];
for (const [table, column, strategy, interval, threshold] of policies) {
  const [count] = await sql.query(`select count(1)::bigint rows from ${table}`);
  const rows = Number(count.rows || 0);
  const status = rows >= Number(threshold) ? "migration_recommended" : "planned";
  const readiness = { ratioToThreshold: Number((rows / Number(threshold)).toFixed(6)), requiresDowntime: false, method: "shadow_table_dual_write_backfill_swap" };
  await sql.query(`insert into partition_migration_registry(table_name,partition_column,partition_strategy,recommended_interval,current_rows,activate_after_rows,migration_status,readiness)
    values($1,$2,$3,$4,$5,$6,$7,$8::jsonb) on conflict(table_name) do update set current_rows=excluded.current_rows,migration_status=excluded.migration_status,
      readiness=excluded.readiness,assessed_at=now()`, [table, column, strategy, interval, rows, threshold, status, JSON.stringify(readiness)]);
  report.push({ table, rows, threshold, status, ...readiness });
}
fs.mkdirSync(path.join(process.cwd(), "monitor"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "monitor", "partition-readiness.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), tables: report }, null, 2)}\n`);
console.log(JSON.stringify({ tables: report }, null, 2));
