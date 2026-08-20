import fs from "fs";
import path from "path";

let providerIndex = null;

export function normalizeTeamIdentityName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function providerIdsForTeam(team = {}) {
  return {
    espn: team?.espnTeamId ? String(team.espnTeamId) : null,
    espnLeagueCode: team?.espnLeagueCode ? String(team.espnLeagueCode) : null,
    sofascore: team?.sofascoreTeamId ? String(team.sofascoreTeamId) : null,
    apiFootball: team?.apiFootballTeamId ? String(team.apiFootballTeamId) : null,
    sportmonks: team?.sportmonksTeamId ? String(team.sportmonksTeamId) : null,
    footballData: team?.footballDataTeamId ? String(team.footballDataTeamId) : null,
    wikidata: team?.wikidataId ? String(team.wikidataId) : null,
  };
}

export function loadTeamProviderIndex(root = process.cwd(), logger = console) {
  if (providerIndex) return providerIndex;
  providerIndex = new Map();
  const file = path.join(root, "config", "friendly-team-sources.json");
  if (!fs.existsSync(file)) return providerIndex;

  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const team of payload?.teams || []) {
      if (team?.active === false) continue;
      const ids = providerIdsForTeam(team);
      for (const alias of [team?.name, ...(team?.aliases || [])].map(normalizeTeamIdentityName).filter(Boolean)) {
        providerIndex.set(alias, ids);
      }
    }
    const learnedFile = path.join(root, "monitor", "api-football-team-map.json");
    if (fs.existsSync(learnedFile)) {
      const learned = JSON.parse(fs.readFileSync(learnedFile, "utf8"));
      for (const team of learned?.teams || []) {
        const apiFootball = team?.apiFootballTeamId ? String(team.apiFootballTeamId) : null;
        if (!apiFootball) continue;
        for (const alias of [team?.name, ...(team?.aliases || [])].map(normalizeTeamIdentityName).filter(Boolean)) {
          providerIndex.set(alias, { ...(providerIndex.get(alias) || {}), apiFootball });
        }
      }
    }
    const wikidataFile = path.join(root, "data", "wikidata-football-identities.json");
    if (fs.existsSync(wikidataFile)) {
      const wikidata = JSON.parse(fs.readFileSync(wikidataFile, "utf8"));
      for (const team of wikidata?.teams || []) {
        if (!team?.wikidataId) continue;
        const ids = { ...(providerIndex.get(normalizeTeamIdentityName(team.teamName)) || {}), wikidata: String(team.wikidataId) };
        for (const alias of [team.teamName, team.label, ...(team.aliases || [])].map(normalizeTeamIdentityName).filter(Boolean)) {
          providerIndex.set(alias, ids);
        }
      }
    }
  } catch (error) {
    logger.warn?.(`[team-identity] provider-ID config kon niet worden gelezen: ${error?.message || error}`);
  }
  return providerIndex;
}

export function getKnownProviderIds(teamName, options = {}) {
  const index = options.index || loadTeamProviderIndex(options.root, options.logger);
  return { ...(index.get(normalizeTeamIdentityName(teamName)) || {}) };
}

export function buildTeamIdentity(homeId, awayId, homeName, awayName, source = "unknown", options = {}) {
  const homeProviderIds = getKnownProviderIds(homeName, options);
  const awayProviderIds = getKnownProviderIds(awayName, options);
  if (homeId) homeProviderIds[source] = String(homeId);
  if (awayId) awayProviderIds[source] = String(awayId);
  const homeKey = homeId ? `id:${homeId}` : `name:${normalizeTeamIdentityName(homeName)}`;
  const awayKey = awayId ? `id:${awayId}` : `name:${normalizeTeamIdentityName(awayName)}`;
  const bothHaveProviderIds = [homeProviderIds, awayProviderIds].every((ids) => Object.values(ids).some(Boolean));
  const status = homeId && awayId || bothHaveProviderIds ? "provider_ids" : homeKey && awayKey ? "name_fallback" : "incomplete";

  return {
    status,
    source,
    home: {
      id: homeId || null,
      name: homeName || null,
      normalizedName: normalizeTeamIdentityName(homeName),
      key: homeKey || null,
      identityType: homeId ? "provider_id" : "name_fallback",
      providerIds: homeProviderIds,
    },
    away: {
      id: awayId || null,
      name: awayName || null,
      normalizedName: normalizeTeamIdentityName(awayName),
      key: awayKey || null,
      identityType: awayId ? "provider_id" : "name_fallback",
      providerIds: awayProviderIds,
    },
  };
}

export function resetTeamProviderIndexForTests() {
  providerIndex = null;
}
