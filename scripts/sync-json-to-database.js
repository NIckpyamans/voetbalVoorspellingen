#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { loadLocalEnv, syncStoreToDatabase } from "../shared/database.js";

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, "server_data.json");

loadLocalEnv(ROOT);

if (!fs.existsSync(DATA_FILE)) {
  process.stderr.write(`server_data.json niet gevonden: ${DATA_FILE}\n`);
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const result = await syncStoreToDatabase(store);

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2));

if (result.skipped) process.exitCode = 2;
