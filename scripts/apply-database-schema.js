#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { neon } from "@neondatabase/serverless";

const ROOT = process.cwd();
const schemaPath = path.join(ROOT, "database", "schema.sql");

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

if (!fs.existsSync(schemaPath)) {
  process.stderr.write(`database/schema.sql niet gevonden: ${schemaPath}\n`);
  process.exit(1);
}

if (!databaseUrl.trim()) {
  process.stderr.write(
    "Geen DATABASE_URL, POSTGRES_URL of SUPABASE_DB_URL gezet. Schema is klaar, maar kan zonder databaseverbinding niet worden uitgevoerd.\n"
  );
  process.exit(2);
}

async function applyWithNeon() {
  const sql = neon(databaseUrl);
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  const statements = splitSqlStatements(schemaSql);
  for (const statement of statements) {
    await sql.query(statement);
  }
  process.stdout.write(`database/schema.sql toegepast via Neon serverless driver (${statements.length} statements).\n`);
}

function splitSqlStatements(input) {
  const statements = [];
  let current = "";
  let quote = null;
  let dollarTag = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    current += char;

    if (dollarTag) {
      if (input.slice(index, index + dollarTag.length) === dollarTag) {
        current += input.slice(index + 1, index + dollarTag.length);
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }

    if (quote) {
      if (char === quote && next === quote) {
        current += next;
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "$") {
      const match = input.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag.slice(1);
        index += dollarTag.length - 1;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      const newline = input.indexOf("\n", index + 2);
      const commentEnd = newline === -1 ? input.length - 1 : newline;
      current += input.slice(index + 1, commentEnd + 1);
      index = commentEnd;
      continue;
    }

    if (char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
    }
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

const result = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", schemaPath], {
  stdio: "inherit",
  shell: false,
});

if (!result.error) {
  process.exit(result.status ?? 1);
}

process.stderr.write(`psql kon niet worden gestart: ${result.error.message}. Fallback naar Neon serverless driver.\n`);

applyWithNeon().catch((error) => {
  process.stderr.write(`Schema toepassen via Neon driver is mislukt: ${error.message}\n`);
  process.exit(1);
});
