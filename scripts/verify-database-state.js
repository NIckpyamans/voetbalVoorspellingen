#!/usr/bin/env node

import { loadLocalEnv, readDatabaseCounts } from "../shared/database.js";

const ROOT = process.cwd();

loadLocalEnv(ROOT);

const counts = await readDatabaseCounts();
if (!counts.databaseConfigured) {
  process.stderr.write("Geen database-url gevonden. Vul DATABASE_URL, POSTGRES_URL of SUPABASE_DB_URL.\n");
  process.exit(2);
}

console.log(JSON.stringify(counts, null, 2));
