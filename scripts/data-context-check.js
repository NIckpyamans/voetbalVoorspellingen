#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const CONTEXT_DIR = path.join(ROOT, "docs", "data-context");
const CONTEXT_FILE = path.join(CONTEXT_DIR, "analysis-context.json");
const REQUIRED_FILES = [
  "README.md",
  "datasets.md",
  "kpis.md",
  "quality-rules.md",
  "dashboard-contract.md",
  "analysis-context.json",
  "free-source-strategy.json",
  "followed-clubs-context.json",
];
const OPTIONAL_SCHEMA_TABLES = new Set(["season_archives"]);

function fail(message) {
  console.error(`[data-context-check] ${message}`);
  process.exitCode = 1;
}

for (const fileName of REQUIRED_FILES) {
  const filePath = path.join(CONTEXT_DIR, fileName);
  if (!fs.existsSync(filePath)) fail(`Ontbrekend contextbestand: ${fileName}`);
}

let context = null;
try {
  context = JSON.parse(fs.readFileSync(CONTEXT_FILE, "utf8"));
} catch (error) {
  fail(`analysis-context.json is geen geldige JSON: ${error.message}`);
}

const schema = fs.existsSync(path.join(ROOT, "database", "schema.sql"))
  ? fs.readFileSync(path.join(ROOT, "database", "schema.sql"), "utf8")
  : "";
const schemaTables = new Set(
  [...schema.matchAll(/create table if not exists\s+([a-z0-9_]+)/gi)].map((match) => match[1])
);
const contextTables = Object.values(context?.domains || {}).flat();

for (const table of contextTables) {
  if (!schemaTables.has(table) && !OPTIONAL_SCHEMA_TABLES.has(table)) {
    fail(`Dataset staat in data context maar niet in schema.sql: ${table}`);
  }
}

for (const kpi of context?.primaryKpis || []) {
  if (!/^[a-z0-9_]+$/.test(kpi)) fail(`KPI heeft geen stabiele snake_case key: ${kpi}`);
}

for (const section of context?.defaultDashboardSections || []) {
  if (!String(section || "").trim()) fail("Dashboardsectie mag niet leeg zijn");
}

const freeSourceStrategy = JSON.parse(fs.readFileSync(path.join(CONTEXT_DIR, "free-source-strategy.json"), "utf8"));
const followedClubContext = JSON.parse(fs.readFileSync(path.join(CONTEXT_DIR, "followed-clubs-context.json"), "utf8"));

if (!Array.isArray(freeSourceStrategy.sources) || freeSourceStrategy.sources.length < 5) {
  fail("Free-source strategy moet minimaal 5 gratis/open bronnen bevatten");
}

for (const source of freeSourceStrategy.sources || []) {
  if (!source.id || !source.name || !source.url || !Array.isArray(source.databaseTargets)) {
    fail(`Free-source bron mist verplichte velden: ${source.id || source.name || "unknown"}`);
  }
}

if (!Array.isArray(followedClubContext.clubs) || !followedClubContext.clubs.length) {
  fail("Followed club context bevat nog geen clubs");
}

const unenrichedClubs = (followedClubContext.clubs || []).filter((club) => !club.external?.theSportsDb?.ok);
if (unenrichedClubs.length) {
  fail(`Niet alle gevolgde clubs zijn gratis verrijkt: ${unenrichedClubs.map((club) => club.name).join(", ")}`);
}

if (!process.exitCode) {
  console.log(
    `[data-context-check] ok: ${contextTables.length} datasets, ${context.primaryKpis?.length || 0} KPI's, ${context.defaultDashboardSections?.length || 0} dashboardsecties, ${freeSourceStrategy.sources.length} gratis bronnen, ${followedClubContext.clubs.length} gevolgde clubs`
  );
}
