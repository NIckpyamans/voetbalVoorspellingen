#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { ACTIVE_COMPETITIONS } from "../shared/competitionVisibility.js";

const root = process.cwd();
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const catalog = readJson("config/competition-catalog.json");
const standingsExport = readJson("data/standings.json");
const standings = standingsExport.standings || {};
const errors = [];
const warnings = [];
const competitions = [];

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

  const rows = Array.isArray(standing.rows) ? standing.rows : [];
  const totalPlayed = rows.reduce((sum, row) => sum + Number(row.p || 0), 0);
  const totalGoalsFor = rows.reduce((sum, row) => sum + Number(row.gf || 0), 0);
  const totalGoalsAgainst = rows.reduce((sum, row) => sum + Number(row.ga || 0), 0);
  const invalidRows = rows.filter((row) => Number(row.p || 0) !== Number(row.w || 0) + Number(row.d || 0) + Number(row.l || 0));

  if (rows.length !== Number(definition.expectedTeams || definition.teams?.length || 0)) {
    errors.push(`${label}: ${rows.length} teams, verwacht ${definition.expectedTeams || definition.teams?.length}`);
  }
  if (String(standing.season || "") !== String(catalog.season || "")) {
    errors.push(`${label}: seizoen ${standing.season || "onbekend"}, verwacht ${catalog.season}`);
  }
  if (invalidRows.length) errors.push(`${label}: ${invalidRows.length} rij(en) met gespeeld != W+G+V`);
  if (totalPlayed % 2 !== 0) errors.push(`${label}: oneven totaal gespeeld (${totalPlayed})`);
  if (totalGoalsFor !== totalGoalsAgainst) errors.push(`${label}: DV ${totalGoalsFor} verschilt van DT ${totalGoalsAgainst}`);
  if (definition.type === "cup" && definition.membershipStatus !== "provider_confirmed" && totalPlayed !== 0) {
    errors.push(`${label}: voorlopige UEFA league-phase bevat ${totalPlayed / 2} gespeelde wedstrijden`);
  }

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
