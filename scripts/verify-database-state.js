#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";

const ROOT = process.cwd();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || String(process.env[key] || "").trim()) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

for (const fileName of [".env.local", ".env.production.local", ".env"]) {
  loadEnvFile(path.join(ROOT, fileName));
}

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL || "";

if (!databaseUrl.trim()) {
  process.stderr.write("Geen database-url gevonden. Vul DATABASE_URL, POSTGRES_URL of SUPABASE_DB_URL.\n");
  process.exit(2);
}

const sql = neon(databaseUrl);
const result = await sql.query(`
  select
    (select count(*)::int from source_records) as source_records,
    (select count(*)::int from source_audit) as source_audit,
    (select count(*)::int from prediction_snapshots) as prediction_snapshots,
    (select count(*)::int from matches) as matches
`);
const counts = Array.isArray(result) ? result[0] : result?.rows?.[0];

console.log(JSON.stringify({ databaseConfigured: true, ...counts }, null, 2));
