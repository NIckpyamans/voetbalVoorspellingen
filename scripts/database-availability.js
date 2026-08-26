#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { getSql, loadLocalEnv } from "../shared/database.js";

const REPORT_FILE = path.join(process.cwd(), "monitor", "database-availability.json");

function classifyError(error) {
  const message = String(error?.message || error || "unknown_error");
  if (/HTTP status 402|data transfer quota/i.test(message)) return "quota_exceeded";
  if (/fetch failed|connecting to database|ECONNRESET|ETIMEDOUT|HOSTUNREACH/i.test(message)) {
    return "temporarily_unavailable";
  }
  return "connection_failed";
}

function writeGithubOutput(report) {
  if (!process.argv.includes("--emit-github-output") || !process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `available=${report.available}\ndatabaseWritable=${report.databaseWritable}\nconfigured=${report.configured}\nreason=${report.reason}\n`
  );
}

async function main() {
  loadLocalEnv();
  const sql = getSql();
  const report = {
    generatedAt: new Date().toISOString(),
    configured: Boolean(sql),
    available: false,
    databaseWritable: false,
    reason: sql ? "checking" : "database_url_missing",
  };

  if (sql) {
    try {
      await sql.query("select 1 as available");
      report.available = true;
      report.reason = "available";
    } catch (error) {
      report.reason = classifyError(error);
      report.error = String(error?.message || error).slice(0, 500);
      report.fallback = "cloudflare_r2";
      report.recoveryWorkflow = "R2 and Neon recovery";
    }
    if (report.available) {
      try {
        // A temporary table verifies write permission without changing durable data.
        await sql.query("create temporary table footyai_write_probe (checked_at timestamptz)");
        report.databaseWritable = true;
      } catch (error) {
        report.reason = classifyError(error) === "connection_failed" ? "write_probe_failed" : classifyError(error);
        report.writeError = String(error?.message || error).slice(0, 500);
        report.fallback = "cloudflare_r2";
        report.recoveryWorkflow = "R2 and Neon recovery";
      }
    }
  }

  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  writeGithubOutput(report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
