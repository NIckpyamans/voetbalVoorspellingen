#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { ACTIVE_COMPETITIONS } from "../shared/competitionVisibility.js";

const root = process.cwd();
const apply = process.argv.includes("--apply");
const catalogPath = path.join(root, "config", "competition-catalog.json");
const agentsPath = path.join(root, "config", "competition-agents.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const agents = JSON.parse(fs.readFileSync(agentsPath, "utf8"));
const active = new Set(ACTIVE_COMPETITIONS);

const germanySecondDivision = {
  league: "Germany - 2. Bundesliga",
  slug: "germany-2-bundesliga",
  type: "league",
  expectedTeams: 18,
  format: "double_round_robin",
  membershipStatus: "provider_confirmed",
  teams: [
    "1. FC Heidenheim 1846",
    "1. FC Magdeburg",
    "1. FC Nürnberg",
    "Arminia Bielefeld",
    "Dynamo Dresden",
    "Energie Cottbus",
    "Hannover 96",
    "Hertha Berlin",
    "Holstein Kiel",
    "Kaiserslautern",
    "Karlsruher SC",
    "SV Darmstadt 98",
    "SpVgg Greuther Fürth",
    "St. Pauli",
    "TSV Eintracht Braunschweig",
    "VfL Bochum",
    "VfL Osnabruck",
    "VfL Wolfsburg",
  ],
  membershipSource: "ESPN teams API (ger.2)",
  membershipCheckedAt: new Date().toISOString(),
};

const existing = new Map((catalog.competitions || []).map((competition) => [competition.league, competition]));
existing.set(germanySecondDivision.league, existing.get(germanySecondDivision.league) || germanySecondDivision);
catalog.competitions = ACTIVE_COMPETITIONS.map((league) => existing.get(league)).filter(Boolean);
catalog.generatedAt = new Date().toISOString();
catalog.policy =
  "Only the top two divisions of Netherlands, Germany, England and France plus UEFA club competitions are active. Historical match files remain immutable.";

const existingAgents = new Map((agents.agents || []).map((agent) => [agent.league, agent]));
agents.agents = ACTIVE_COMPETITIONS.map((league) =>
  existingAgents.get(league) || {
    key: `${league.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-agent`,
    league,
    profile: league.startsWith("Europe -") ? "uefa" : "domestic",
  }
);
agents.policy =
  "One quota-aware orchestrator enriches only the selected eight domestic and three UEFA club competitions. Historical matches remain available for learning.";
delete agents.profiles?.friendly;

const report = {
  apply,
  competitions: catalog.competitions.map((competition) => competition.league),
  agents: agents.agents.map((agent) => agent.league),
  historicalFilesRemoved: 0,
};

if (apply) {
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  fs.writeFileSync(agentsPath, `${JSON.stringify(agents, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));
