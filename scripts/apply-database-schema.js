#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const ROOT = process.cwd();
const schemaPath = path.join(ROOT, "database", "schema.sql");
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

const result = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", schemaPath], {
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  process.stderr.write(`psql kon niet worden gestart: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
