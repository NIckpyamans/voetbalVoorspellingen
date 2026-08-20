import { canonicalDedupeTeam } from "../../shared/matchNormalization.js";
import { extractGoalTimingFromMatch, summarizeGoalTiming } from "./goal-timing.js";

function scoreFor(match) {
  const score = String(match?.score || "").match(/^(\d+)\s*-\s*(\d+)$/);
  if (score) return [Number(score[1]), Number(score[2])];
  const home = Number(match?.homeScore);
  const away = Number(match?.awayScore);
  return match?.homeScore != null && match?.awayScore != null && Number.isFinite(home) && Number.isFinite(away)
    ? [home, away]
    : null;
}

function isCompletedBefore(match, now) {
  if (!["FT", "AET", "PEN"].includes(String(match?.status || "").toUpperCase())) return false;
  const kickoff = Date.parse(match?.kickoff || match?.date || "");
  return !Number.isFinite(kickoff) || kickoff <= now;
}

function addTeamResult(index, teamName, opponent, match, goalsFor, goalsAgainst, venue) {
  const key = canonicalDedupeTeam(teamName);
  if (!key) return;
  const item = {
    date: String(match?.date || match?.kickoff || "").slice(0, 10) || null,
    kickoff: match?.kickoff || null,
    eventId: String(match?.id || "") || null,
    league: match?.league || null,
    venue,
    opponent: String(opponent || "").trim(),
    opponentId: "",
    score: `${goalsFor}-${goalsAgainst}`,
    goalsFor,
    goalsAgainst,
    result: goalsFor > goalsAgainst ? "W" : goalsFor === goalsAgainst ? "D" : "L",
    source: `local-finished-results:${match?.dataSource || match?.source || "worker"}`,
    friendly: /friendl|oefen/i.test(String(match?.league || "")),
    goalQuartersFor: extractGoalTimingFromMatch(match, venue === "H" ? "home" : "away"),
    goalQuartersAgainst: extractGoalTimingFromMatch(match, venue === "H" ? "away" : "home"),
  };
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(item);
}

export function buildLocalTeamFormIndex(dayPayloads, options = {}) {
  const now = Number(options.now || Date.now());
  const index = new Map();
  for (const day of dayPayloads || []) {
    for (const match of day?.matches || []) {
      const score = scoreFor(match);
      if (!score || !isCompletedBefore(match, now)) continue;
      addTeamResult(index, match.homeTeamName, match.awayTeamName, match, score[0], score[1], "H");
      addTeamResult(index, match.awayTeamName, match.homeTeamName, match, score[1], score[0], "A");
    }
  }
  for (const [key, matches] of index.entries()) {
    const unique = new Map();
    for (const match of matches) {
      const identity = `${match.eventId || ""}|${match.date || ""}|${canonicalDedupeTeam(match.opponent)}|${match.score}`;
      if (!unique.has(identity)) unique.set(identity, match);
    }
    index.set(key, [...unique.values()].sort((a, b) => String(a.kickoff || a.date || "").localeCompare(String(b.kickoff || b.date || ""))));
  }
  return index;
}

export function mergeLocalTeamForm(profile, localMatches, teamName, options = {}) {
  const limit = Math.max(1, Number(options.limit || 10));
  const current = Array.isArray(profile?.recentMatches) ? profile.recentMatches : [];
  const unique = new Map();
  for (const match of [...current, ...(localMatches || [])]) {
    const identity = `${match?.eventId || ""}|${match?.date || ""}|${canonicalDedupeTeam(match?.opponent)}|${match?.score || ""}`;
    if (!unique.has(identity)) unique.set(identity, match);
  }
  const recentMatches = [...unique.values()]
    .sort((a, b) => String(a?.kickoff || a?.date || "").localeCompare(String(b?.kickoff || b?.date || "")))
    .slice(-limit);
  if (!recentMatches.length) return profile || null;
  const goalTiming = summarizeGoalTiming(recentMatches, profile?.goalTiming?.scored);
  return {
    ...(profile || {}),
    providerTeamName: profile?.providerTeamName || teamName,
    recentMatches,
    goalTiming,
    source: current.length ? `${profile?.source || "provider"}+local-finished-results` : "local-finished-results",
    asOf: new Date(Number(options.now || Date.now())).toISOString(),
  };
}

export function mergePersistedTeamFormCache(storedCache, persistedCache) {
  return {
    ...(storedCache || {}),
    ...(persistedCache || {}),
  };
}
