#!/usr/bin/env node

import fs from "fs";
import path from "path";

const root = process.cwd();
const catalogPath = path.join(root, "config", "competition-catalog.json");
const outputPath = path.join(root, "config", "friendly-team-sources.json");
const ESPN_TEAMS_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

const leagueCodes = {
  "belgium-pro-league": "bel.1",
  "england-championship": "eng.2",
  "england-premier-league": "eng.1",
  "france-ligue-1": "fra.1",
  "france-ligue-2": "fra.2",
  "germany-bundesliga": "ger.1",
  "italy-serie-a": "ita.1",
  "italy-serie-b": "ita.2",
  "netherlands-eerste-divisie": "ned.2",
  "netherlands-eredivisie": "ned.1",
  "portugal-liga-portugal": "por.1",
  "spain-laliga": "esp.1",
};

function readExisting() {
  if (!fs.existsSync(outputPath)) return { teams: [] };
  try {
    return JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } catch {
    return { teams: [] };
  }
}

function parseTeams(payload, league, code) {
  const entries = payload?.sports?.[0]?.leagues?.[0]?.teams || [];
  return entries
    .map((entry) => entry?.team || entry)
    .filter((team) => team?.id && (team?.displayName || team?.name))
    .map((team) => ({
      espnTeamId: String(team.id),
      name: String(team.displayName || team.name).trim(),
      abbreviation: String(team.abbreviation || "").trim(),
      league,
      espnLeagueCode: code,
      logo: String(team.logos?.[0]?.href || team.logo || "").trim() || null,
      source: `ESPN teams API (${code})`,
    }));
}

async function fetchLeagueTeams(league, code) {
  const response = await fetch(`${ESPN_TEAMS_BASE}/${code}/teams?limit=100`, {
    headers: { Accept: "application/json", "User-Agent": "FootyPredict friendly team source sync" },
  });
  if (!response.ok) throw new Error(`ESPN ${code} gaf HTTP ${response.status}`);
  return parseTeams(await response.json(), league, code);
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const existing = readExisting();
const existingTeams = new Map((existing.teams || []).map((team) => [String(team.espnTeamId), team]));
const warnings = [];
const syncedTeams = [];

for (const competition of catalog.competitions || []) {
  const code = leagueCodes[competition.slug];
  if (!code) continue;
  try {
    const teams = await fetchLeagueTeams(competition.league, code);
    syncedTeams.push(...teams);
  } catch (error) {
    warnings.push({ league: competition.league, code, reason: error.message });
  }
}

const byId = new Map();
for (const team of [...existingTeams.values(), ...syncedTeams]) {
  byId.set(String(team.espnTeamId), {
    ...team,
    active: team.active !== false,
  });
}

const teams = [...byId.values()].sort((left, right) =>
  `${left.league} ${left.name}`.localeCompare(`${right.league} ${right.name}`, "en")
);

const report = {
  generatedAt: new Date().toISOString(),
  purpose: "Team IDs voor ESPN club-friendly team schedules. De worker gebruikt dit als brede oefenwedstrijd-scout voor gevolgde clubs.",
  teams,
  warnings,
};

fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, teams: teams.length, warnings }, null, 2));
