#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getCompetitionAgentConfig } from "./worker/competition-agents.js";

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "monitor", "competition-agent-status.json");
const DAYS_AHEAD = Math.max(1, Number(process.env.COMPETITION_AGENT_AUDIT_DAYS || 7));

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function dateKey(offset) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function matchSourceCount(match) {
  const values = [
    match?.source,
    match?.dataSource,
    ...(Array.isArray(match?.sources) ? match.sources : []),
    ...(Array.isArray(match?.sourceLineage) ? match.sourceLineage : []),
  ].filter(Boolean).map((value) => typeof value === "string" ? value : value?.source || value?.provider).filter(Boolean);
  return new Set(values).size;
}

const config = getCompetitionAgentConfig();
const providerHealth = readJson(path.join(ROOT, "monitor", "provider-quota-audit.json"), {});
const h2hReport = readJson(path.join(ROOT, "monitor", "h2h-upcoming-backfill.json"), {});
const lineupReport = readJson(path.join(ROOT, "monitor", "pre-kickoff-lineup-collector.json"), {});
const matches = [];
for (let offset = 0; offset <= DAYS_AHEAD; offset += 1) {
  const date = dateKey(offset);
  const day = readJson(path.join(ROOT, "data", "days", `${date}.json`), {});
  for (const match of Array.isArray(day?.matches) ? day.matches : []) matches.push({ ...match, date });
}

const agents = config.agents.map((definition) => {
  const profile = config.profiles[definition.profile] || {};
  const leagueMatches = matches.filter((match) => match.league === definition.league);
  const multiSource = leagueMatches.filter((match) => matchSourceCount(match) >= Number(config.targets?.fixtureSources || 2)).length;
  const h2hChecked = Number(h2hReport?.byCompetition?.[definition.league]?.checked || 0);
  const lineups = (lineupReport?.matches || []).filter((match) => match.league === definition.league);
  return {
    key: definition.key,
    league: definition.league,
    profile: definition.profile,
    upcomingFixtures: leagueMatches.length,
    fixtureMultiSourceCoverage: leagueMatches.length ? Number((multiSource / leagueMatches.length).toFixed(3)) : null,
    h2hChecked,
    lineupWindowChecks: lineups.length,
    confirmedLineups: lineups.filter((match) => match.confirmed).length,
    sources: profile,
    status: leagueMatches.length ? "active" : "idle_no_fixtures_in_window",
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  schemaVersion: config.schemaVersion,
  daysAhead: DAYS_AHEAD,
  totalUpcomingFixtures: matches.length,
  activeAgents: agents.filter((agent) => agent.upcomingFixtures > 0).length,
  configuredAgents: agents.length,
  providerBlocks: {
    neon: providerHealth?.database?.valid === false ? providerHealth.database.reason || "unavailable" : null,
    apiFootball: providerHealth?.apiFootball?.valid === false ? providerHealth.apiFootball.reason || "acceptance_failed" : null,
    sportmonks: config.sourceStatus?.sportmonks,
  },
  sourceStatus: config.sourceStatus,
  agents,
  guarantees: {
    fixtureDiscovery: "Elke agent controleert zeven dagen vooruit via zijn competitieprofiel.",
    lineups: "Pogingen op T-75, T-45 en T-20; confirmed data kan alleen worden getoond wanneer een provider publiceert.",
    h2h: "Maximaal vijf echte ontmoetingen; een eerste ontmoeting blijft leeg en wordt nooit gefabriceerd.",
  },
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[competition-agent-audit] ${report.activeAgents}/${report.configuredAgents} agents actief, ${matches.length} wedstrijden in venster`);
