export const VALIDATION_MODULE = {
  name: "validation",
  owns: ["match status validation", "result backfill checks", "H2H contract checks", "source conflict detection"],
};

export function matchHasFinalScore(match) {
  return (
    String(match?.score || "").includes("-") ||
    (Number.isFinite(Number(match?.homeScore)) && Number.isFinite(Number(match?.awayScore)))
  );
}

export function parseScoreToGoals(score) {
  const match = String(score || "").match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  return { homeGoals: Number(match[1]), awayGoals: Number(match[2]) };
}

export function buildEmptyH2HContract(homeId, awayId) {
  return {
    played: 0,
    homeWins: 0,
    draws: 0,
    awayWins: 0,
    sameCompetitionPlayed: 0,
    weightedRecentBalance: 0,
    results: [],
    homeTeamId: homeId || null,
    awayTeamId: awayId || null,
    status: "h2h-agent-empty",
    source: "contract-fallback",
  };
}

export function ensureH2HContract(h2h, homeId, awayId) {
  const base = h2h && typeof h2h === "object" ? h2h : buildEmptyH2HContract(homeId, awayId);
  const results = Array.isArray(base.results) ? base.results.filter(Boolean) : [];
  return {
    ...buildEmptyH2HContract(homeId, awayId),
    ...base,
    results,
    played: Number(base.played || results.length || 0),
    homeWins: Number(base.homeWins || 0),
    draws: Number(base.draws || 0),
    awayWins: Number(base.awayWins || 0),
    status: base.status || (results.length ? "h2h-agent" : "h2h-agent-empty"),
  };
}

export function mergeH2HResultLists(existingResults = [], extraResults = []) {
  const seen = new Set();
  const merged = [];
  for (const item of [...existingResults, ...extraResults]) {
    const key = `${item?.date || ""}_${item?.home || ""}_${item?.away || ""}_${item?.score || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")))
    .slice(-8);
}
