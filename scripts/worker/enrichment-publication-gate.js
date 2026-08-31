const FINAL = new Set(["FT", "AET", "PEN"]);

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function hasScore(match) {
  return FINAL.has(String(match?.status || "").toUpperCase()) &&
    Number.isFinite(Number(match?.homeScore)) && Number.isFinite(Number(match?.awayScore));
}

function hasRecent(value, minimum = 5) {
  return Number(value?.gamesPlayed || value?.recentMatches?.length || 0) >= minimum;
}

function hasPostMatchStats(match) {
  const stats = match?.postMatchStats || match?.liveStats;
  if (!stats || /^missing|unknown$/i.test(String(stats?.source || ""))) return false;
  return Boolean(stats?.events?.length || stats?.referee || [stats?.home?.shots, stats?.away?.shots, stats?.home?.possession, stats?.away?.possession].some((value) => Number.isFinite(Number(value))));
}

export function summarizeEnrichmentCoverage(matches = []) {
  const all = rows(matches);
  const finished = all.filter((match) => FINAL.has(String(match?.status || "").toUpperCase()));
  const count = (predicate, base = all) => base.filter(predicate).length;
  const ratio = (covered, total) => total ? Number((covered / total).toFixed(3)) : 1;
  const metrics = {
    fixtures: all.length,
    finalScores: { covered: count(hasScore, finished), total: finished.length },
    h2h: { covered: count((match) => Number(match?.h2h?.played || match?.h2h?.results?.length || 0) > 0), total: all.length },
    form: { covered: count((match) => hasRecent(match?.homeRecent) && hasRecent(match?.awayRecent)), total: all.length },
    lineups: { covered: count((match) => Boolean(match?.lineupSummary?.confirmed)), total: all.length },
    squads: { covered: count((match) => Number(match?.homeTeamProfile?.squadSize || match?.homeTeamProfile?.playerCount || 0) >= 11 && Number(match?.awayTeamProfile?.squadSize || match?.awayTeamProfile?.playerCount || 0) >= 11), total: all.length },
    postMatchStats: { covered: count(hasPostMatchStats, finished), total: finished.length },
  };
  return Object.fromEntries(Object.entries(metrics).map(([key, value]) => {
    if (key === "fixtures") return [key, value];
    return [key, { ...value, coverage: ratio(value.covered, value.total) }];
  }));
}

export function evaluateEnrichmentPublication(previousMatches, nextMatches, options = {}) {
  const previous = summarizeEnrichmentCoverage(previousMatches);
  const next = summarizeEnrichmentCoverage(nextMatches);
  const maxRelativeDrop = Number(options.maxRelativeDrop ?? 0.15);
  const minimumSample = Math.max(1, Number(options.minimumSample ?? 3));
  const regressions = [];
  if (previous.fixtures >= minimumSample && next.fixtures < previous.fixtures * (1 - maxRelativeDrop)) {
    regressions.push({ field: "fixtures", before: previous.fixtures, after: next.fixtures });
  }
  for (const field of ["finalScores", "h2h", "form", "lineups", "squads", "postMatchStats"]) {
    const before = previous[field];
    const after = next[field];
    if (before.total < minimumSample || before.covered === 0) continue;
    const strict = field === "finalScores";
    const existingEvidenceLost = after.covered < before.covered;
    const comparablePopulation = next.fixtures <= previous.fixtures * 1.05;
    if ((strict && existingEvidenceLost) || (!strict && (existingEvidenceLost || (comparablePopulation && after.coverage < before.coverage - maxRelativeDrop)))) {
      regressions.push({ field, before, after });
    }
  }
  return {
    allowed: regressions.length === 0,
    checkedAt: new Date().toISOString(),
    previous,
    next,
    maxRelativeDrop,
    regressions,
    reason: regressions.length ? "enrichment-coverage-regression" : "enrichment-coverage-ok",
  };
}

export function assertEnrichmentPublication(previousMatches, nextMatches, options = {}) {
  const result = evaluateEnrichmentPublication(previousMatches, nextMatches, options);
  if (!result.allowed) {
    throw new Error(`[enrichment-publication-gate] publicatie geblokkeerd: ${result.regressions.map((item) => item.field).join(", ")}`);
  }
  return result;
}
