export const H2H_MODULE = {
  name: "h2h",
  owns: ["H2H source merge", "H2H provenance", "H2H coverage contract"],
};

export function buildH2HAgentProfile(input, deps) {
  const {
    mergeH2HResultLists,
    lookupCuratedH2HBackfill,
    lookupHistoricalH2HBackfill,
    summarizeH2HResults,
  } = deps;
  const {
    baseH2H,
    fallbackLegs = [],
    marketProfile,
    openFootballProfile,
    nationalProfile,
    apiFootballProfile,
    espnProfile,
    extraProfiles = [],
    homeName,
    awayName,
    homeId,
    awayId,
  } = input;
  const sources = [];
  let results = [];
  let sameCompetitionPlayed = Number(baseH2H?.sameCompetitionPlayed || 0);

  if (baseH2H?.results?.length) {
    results = mergeH2HResultLists(results, baseH2H.results);
    sources.push(baseH2H.status || "live-h2h");
  }

  for (const fallbackLeg of fallbackLegs) {
    if (!fallbackLeg) continue;
    results = mergeH2HResultLists(results, [fallbackLeg]);
    sources.push(fallbackLeg.source === "bbc-aggregate" ? "aggregate-backfill" : "previous-leg");
  }

  const curatedH2H = lookupCuratedH2HBackfill(homeName, awayName, homeId, awayId);
  if (curatedH2H?.results?.length) {
    results = mergeH2HResultLists(results, curatedH2H.results);
    sources.push(curatedH2H.status);
    sameCompetitionPlayed += Number(curatedH2H.sameCompetitionPlayed || 0);
  }

  const historicalProfiles = [marketProfile, openFootballProfile, ...extraProfiles].filter(Boolean);
  for (const historicalH2H of historicalProfiles.map((profile) =>
    lookupHistoricalH2HBackfill(profile, homeName, awayName, homeId, awayId)
  )) {
    if (!historicalH2H?.results?.length) continue;
    results = mergeH2HResultLists(results, historicalH2H.results);
    sources.push(historicalH2H.status || "historical-competition");
    sameCompetitionPlayed += Number(historicalH2H.sameCompetitionPlayed || 0);
  }

  for (const [profile, fallbackStatus] of [
    [nationalProfile, "openfootball-international-h2h"],
    [apiFootballProfile, "api-football-h2h"],
    [espnProfile, "espn-team-schedule-h2h"],
  ]) {
    if (!profile?.results?.length) continue;
    results = mergeH2HResultLists(results, profile.results);
    sources.push(profile.status || fallbackStatus);
    sameCompetitionPlayed += Number(profile.sameCompetitionPlayed || profile.played || 0);
  }

  if (!results.length) {
    return { played: 0, homeWins: 0, draws: 0, awayWins: 0, results: [], status: "h2h-agent-empty" };
  }

  const uniqueSources = [...new Set(sources.filter(Boolean))];
  const profile = summarizeH2HResults(
    results,
    homeName,
    awayName,
    homeId,
    awayId,
    uniqueSources.length > 1 ? `h2h-agent:${uniqueSources.join("+")}` : uniqueSources[0] || "h2h-agent",
    sameCompetitionPlayed
  );

  return {
    ...profile,
    targetPlayed: 5,
    coverage: Math.min(1, Number(profile.played || 0) / 5),
    agent: {
      name: "H2H-agent",
      target: 5,
      filled: Number(profile.played || 0),
      complete: Number(profile.played || 0) >= 5,
      sources: uniqueSources,
    },
  };
}
