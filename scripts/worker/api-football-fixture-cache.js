import fs from "node:fs";
import path from "node:path";

export const API_FOOTBALL_FIXTURE_CACHE_SCHEMA = "api-football-fixture-cache-v1";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|afc|cf|sc|ac|club|fk|sv|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function cachePath(root) {
  return path.join(root, "data", "api-football-fixture-cache.json");
}

export function emptyApiFootballFixtureCache() {
  return {
    schemaVersion: API_FOOTBALL_FIXTURE_CACHE_SCHEMA,
    generatedAt: null,
    fixtures: {},
  };
}

export function readApiFootballFixtureCache(root = process.cwd()) {
  try {
    const payload = JSON.parse(fs.readFileSync(cachePath(root), "utf8"));
    if (payload?.schemaVersion !== API_FOOTBALL_FIXTURE_CACHE_SCHEMA || !payload?.fixtures) {
      return emptyApiFootballFixtureCache();
    }
    return payload;
  } catch {
    return emptyApiFootballFixtureCache();
  }
}

export function mergeApiFootballFixtureMappings(current, matches, generatedAt = new Date().toISOString()) {
  const fixtures = { ...(current?.fixtures || {}) };
  let mapped = 0;
  for (const match of Array.isArray(matches) ? matches : []) {
    const matchId = String(match?.id || match?.matchId || "").trim();
    const providerFixtureId = String(match?.fixtureId || match?.providerFixtureId || "").trim();
    if (!matchId || !providerFixtureId) continue;
    fixtures[matchId] = {
      matchId,
      provider: "api-football",
      providerFixtureId,
      kickoff: match.kickoff || null,
      league: match.league || null,
      homeTeam: match.homeTeam || null,
      awayTeam: match.awayTeam || null,
      category: match.category || null,
      confidence: Number(match.confidence || 0),
      mappedAt: generatedAt,
    };
    mapped += 1;
  }
  return {
    schemaVersion: API_FOOTBALL_FIXTURE_CACHE_SCHEMA,
    generatedAt,
    fixtures,
    mapped,
    total: Object.keys(fixtures).length,
  };
}

export function writeApiFootballFixtureCache(root, payload) {
  const file = cachePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

export function findCachedApiFootballFixtureId(cache, match) {
  const directId = String(match?.match_id || match?.matchId || match?.id || "").trim();
  if (directId && cache?.fixtures?.[directId]?.providerFixtureId) {
    return String(cache.fixtures[directId].providerFixtureId);
  }
  const kickoffDate = String(match?.kickoff_at || match?.kickoff || "").slice(0, 10);
  const home = normalize(match?.home_team_name || match?.homeTeam);
  const away = normalize(match?.away_team_name || match?.awayTeam);
  if (!kickoffDate || !home || !away) return null;
  const candidate = Object.values(cache?.fixtures || {}).find((row) =>
    String(row?.kickoff || "").slice(0, 10) === kickoffDate &&
    normalize(row?.homeTeam) === home &&
    normalize(row?.awayTeam) === away
  );
  return candidate?.providerFixtureId ? String(candidate.providerFixtureId) : null;
}
