import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), "config", "competition-agents.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { agents: [], profiles: {}, targets: {}, sourceStatus: {} };
  }
}

const config = readConfig();

export function getCompetitionAgent(league) {
  const definition = config.agents.find((agent) => agent.league === league);
  if (!definition) return null;
  const profileSources = config.profiles[definition.profile] || {};
  return {
    ...definition,
    targets: config.targets,
    sources: {
      ...profileSources,
      ...(definition.sourceOverrides || {}),
    },
  };
}

export function getCompetitionProviderOrder(league, field, fallback = []) {
  const configured = getCompetitionAgent(league)?.sources?.[field];
  return Array.isArray(configured) && configured.length ? configured : fallback;
}

export function getCompetitionAgentConfig() {
  return config;
}
