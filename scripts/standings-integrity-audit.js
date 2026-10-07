#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { ACTIVE_COMPETITIONS } from "../shared/competitionVisibility.js";
import { isCompleteBalancedTable, validateStandingIntegrity } from "../shared/standingsIntegrity.js";
import { mergeCatalogStandings, sameTeam } from "../shared/standingsCatalog.js";
import { FOTMOB_STANDINGS_LEAGUES, normalizeFotmobStanding } from "./worker/fotmob-standings.js";

const root = process.cwd();
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const catalog = readJson("config/competition-catalog.json");
const standingsExport = readJson("data/standings.json");
const standings = { ...(standingsExport.standings || {}) };
const refreshEuropeanStandings = process.argv.includes("--refresh-european");
const errors = [];
const warnings = [];
const competitions = [];

if (refreshEuropeanStandings) {
  for (const label of ["Europe - Champions League", "Europe - Europa League"]) {
    const provider = FOTMOB_STANDINGS_LEAGUES[label];
    if (!provider) throw new Error(`No provider configured for ${label}`);
    const url = new URL("https://www.fotmob.com/api/data/leagues");
    url.searchParams.set("id", String(provider.id));
    url.searchParams.set("ccode3", `${provider.countryCode}_MA`);
    url.searchParams.set("season", String(catalog.season || "").replace("-", "/"));
    const response = await fetch(url, { headers: { Referer: "https://www.fotmob.com/", "Accept-Language": "en-US,en;q=0.9" } });
    if (!response.ok) throw new Error(`${label}: FotMob returned HTTP ${response.status}`);
    const standing = normalizeFotmobStanding(await response.json(), label, provider.id, String(catalog.season || "").replace("-", "/"));
    const definition = catalog.competitions.find((item) => item.league === label);
    if (!standing || !definition || !isCompleteBalancedTable(standing.rows, definition.teams, sameTeam)) {
      throw new Error(`${label}: FotMob standings failed completeness/integrity checks`);
    }
    standings[`label:${label}`] = standing;
  }
  const merged = mergeCatalogStandings(standings, catalog);
  standings[`label:Europe - Champions League`] = merged[`label:Europe - Champions League`];
  standings[`label:Europe - Europa League`] = merged[`label:Europe - Europa League`];
  standingsExport.standings = standings;
  fs.writeFileSync(path.join(root, "data/standings.json"), JSON.stringify(standingsExport));
  console.log("[standings-integrity] Wrote validated Champions League and Europa League tables from FotMob.");
}

for (const label of ACTIVE_COMPETITIONS) {
  const definition = (catalog.competitions || []).find((item) => item.league === label);
  const standing = standings[`label:${label}`];
  if (!definition) {
    errors.push(`${label}: ontbreekt in competitiecatalogus`);
    continue;
  }
  if (!standing) {
    errors.push(`${label}: stand ontbreekt`);
    continue;
  }

  const integrity = validateStandingIntegrity(label, definition, standing, catalog.season);
  const { rows, totalPlayed, totalGoalsFor } = integrity;
  errors.push(...integrity.errors);

  const unexpectedPoints = rows.filter((row) => Number(row.pts || 0) !== Number(row.w || 0) * 3 + Number(row.d || 0));
  if (unexpectedPoints.length) warnings.push(`${label}: ${unexpectedPoints.length} puntenafwijking(en), mogelijk aftrek/bonus`);
  competitions.push({
    label,
    season: standing.season || null,
    teams: rows.length,
    matches: totalPlayed / 2,
    goals: totalGoalsFor,
    source: standing.source || "unknown",
    valid: !errors.some((message) => message.startsWith(`${label}:`)),
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  season: catalog.season || null,
  activeCompetitions: ACTIVE_COMPETITIONS.length,
  checkedCompetitions: competitions.length,
  passed: errors.length === 0,
  errors,
  warnings,
  competitions,
};

fs.mkdirSync(path.join(root, "monitor"), { recursive: true });
fs.writeFileSync(path.join(root, "monitor", "standings-integrity.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[standings-integrity] ${report.passed ? "PASS" : "FAIL"}: ${competitions.length}/${ACTIVE_COMPETITIONS.length} competities, ${errors.length} fouten, ${warnings.length} waarschuwingen`);
for (const error of errors) console.error(`[standings-integrity] ${error}`);
for (const warning of warnings) console.warn(`[standings-integrity] ${warning}`);
if (!report.passed) process.exitCode = 1;
