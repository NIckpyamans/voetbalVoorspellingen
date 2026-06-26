#!/usr/bin/env node

import fs from "fs";
import path from "path";

const root = process.cwd();
const catalogPath = path.join(root, "config", "competition-catalog.json");
const ESPN_TEAMS_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

const leagueCodes = {
  "belgium-pro-league": "bel.1",
  "england-championship": "eng.2",
  "england-premier-league": "eng.1",
  "europe-champions-league": "uefa.champions",
  "europe-conference-league": "uefa.europa.conf",
  "europe-europa-league": "uefa.europa",
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

function readTeams(payload) {
  const entries = payload?.sports?.[0]?.leagues?.[0]?.teams || [];
  return entries
    .map((entry) => String(entry?.team?.displayName || entry?.team?.name || "").trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "en"));
}

async function fetchTeams(code) {
  const response = await fetch(`${ESPN_TEAMS_BASE}/${code}/teams?limit=100`, {
    headers: { Accept: "application/json", "User-Agent": "FootyPredict competition catalog sync" },
  });
  if (!response.ok) throw new Error(`ESPN ${code} gaf HTTP ${response.status}`);
  return readTeams(await response.json());
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const summary = [];
const warnings = [];
let changed = false;

for (const competition of catalog.competitions || []) {
  const code = leagueCodes[competition.slug];
  if (!code) continue;
  let teams = [];
  try {
    teams = await fetchTeams(code);
  } catch (error) {
    warnings.push({ league: competition.league, code, reason: error.message, action: "kept_existing_membership" });
  }
  const expectedTeams = Number(competition.expectedTeams || 0);
  const existingTeams = Array.isArray(competition.teams) ? competition.teams : [];
  if (!teams.length) {
    if (existingTeams.length) {
      warnings.push({
        league: competition.league,
        code,
        reason: "provider_returned_no_teams",
        action: "kept_existing_membership",
        existingTeams: existingTeams.length,
      });
      summary.push({
        league: competition.league,
        code,
        teams: existingTeams.length,
        status: competition.membershipStatus || "existing_membership_retained",
        warning: "provider_returned_no_teams",
      });
      continue;
    }
    warnings.push({ league: competition.league, code, reason: "provider_returned_no_teams", action: "skipped_no_existing_membership" });
    continue;
  }
  if (expectedTeams && teams.length !== expectedTeams) {
    warnings.push({
      league: competition.league,
      code,
      reason: `provider_returned_${teams.length}_teams_expected_${expectedTeams}`,
      action: existingTeams.length ? "kept_existing_membership" : "accepted_provider_membership_without_expected_count",
    });
    if (existingTeams.length) {
      summary.push({
        league: competition.league,
        code,
        teams: existingTeams.length,
        status: competition.membershipStatus || "existing_membership_retained",
        warning: "provider_count_mismatch",
      });
      continue;
    }
  }

  const isUefa = code.startsWith("uefa.");
  const nextStatus = isUefa ? "provisional_qualification_baseline" : "provider_confirmed";
  const nextSource = `ESPN teams API (${code})`;
  const membershipChanged =
    JSON.stringify(competition.teams || []) !== JSON.stringify(teams) ||
    competition.membershipStatus !== nextStatus ||
    competition.membershipSource !== nextSource;
  changed = changed || membershipChanged;
  competition.teams = teams;
  competition.membershipStatus = nextStatus;
  competition.membershipSource = nextSource;
  if (membershipChanged) competition.membershipCheckedAt = new Date().toISOString();
  summary.push({ league: competition.league, code, teams: teams.length, status: competition.membershipStatus });
}

if (changed) catalog.generatedAt = new Date().toISOString();
catalog.policy =
  "Historical seasons remain immutable. Domestic memberships are provider-confirmed; UEFA lists remain provisional until qualification is complete. Every planned table starts at zero.";
if (changed) fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, changed, competitions: summary.length, warnings, summary }, null, 2));
