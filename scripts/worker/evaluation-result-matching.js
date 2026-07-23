import { canonicalDedupeTeam } from "../../shared/matchNormalization.js";

function fixtureDate(value) {
  return String(value?.date || value?.inputSnapshot?.date || value?.kickoff || value?.inputSnapshot?.kickoff || "").slice(0, 10);
}

function fixtureTeam(value, side) {
  const prefix = side === "home" ? "home" : "away";
  return canonicalDedupeTeam(
    value?.[`${prefix}TeamName`] ||
    value?.[`${prefix}Team`] ||
    value?.inputSnapshot?.[`${prefix}Team`] ||
    value?.prediction?.[`${prefix}TeamName`] ||
    value?.prediction?.[`${prefix}Team`],
  );
}

function resultSignature(value) {
  const score = String(value?.actualScore || value?.score || "").replace(/\s+/g, "");
  if (/^\d+-\d+$/.test(score)) return score;
  const home = Number(value?.finalHomeGoals ?? value?.final_home_goals ?? value?.homeScore);
  const away = Number(value?.finalAwayGoals ?? value?.final_away_goals ?? value?.awayScore);
  return Number.isFinite(home) && Number.isFinite(away) ? `${home}-${away}` : "";
}

export function buildEvaluationFixtureKey(value) {
  const date = fixtureDate(value);
  const home = fixtureTeam(value, "home");
  const away = fixtureTeam(value, "away");
  return date && home && away ? `${date}|${home}|${away}` : "";
}

export function createEvaluationResultIndex() {
  return {
    byId: new Map(),
    byFixture: new Map(),
    ambiguousFixtures: new Set(),
  };
}

export function addEvaluationResult(index, matchId, result) {
  const id = String(matchId || result?.id || "");
  if (id) index.byId.set(id, result);

  const key = buildEvaluationFixtureKey(result);
  if (!key) return;
  const existing = index.byFixture.get(key);
  if (existing && resultSignature(existing) !== resultSignature(result)) {
    index.ambiguousFixtures.add(key);
    return;
  }
  if (!existing) index.byFixture.set(key, result);
}

export function resolveEvaluationResult(index, snapshot) {
  const direct = index.byId.get(String(snapshot?.matchId || ""));
  if (direct) return { result: direct, matchType: "direct" };

  const key = buildEvaluationFixtureKey(snapshot);
  if (!key || index.ambiguousFixtures.has(key)) {
    return { result: null, matchType: key ? "ambiguous" : "missing" };
  }
  const result = index.byFixture.get(key) || null;
  return { result, matchType: result ? "canonical" : "missing" };
}
