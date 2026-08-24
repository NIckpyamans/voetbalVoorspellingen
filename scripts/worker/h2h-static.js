function scoreFromResult(result) {
  if (typeof result?.score === "string" && /^\d+\s*-\s*\d+$/.test(result.score)) return result.score.replace(/\s/g, "");
  const home = Number(result?.homeScore ?? result?.homeGoals);
  const away = Number(result?.awayScore ?? result?.awayGoals);
  return Number.isFinite(home) && Number.isFinite(away) ? `${home}-${away}` : null;
}

export function normalizeStaticH2H(match, profile) {
  const homeId = String(match.home_club_id || "");
  const awayId = String(match.away_club_id || "");
  const normalizedResults = (profile?.results || []).map((result) => {
    const score = scoreFromResult(result);
    if (!score) return null;
    const [homeGoals, awayGoals] = score.split("-").map(Number);
    const resultHomeId = String(result.homeTeamId || result.homeId || "");
    const resultAwayId = String(result.awayTeamId || result.awayId || "");
    const homeName = result.home || result.homeTeam || result.homeTeamName || "";
    const awayName = result.away || result.awayTeam || result.awayTeamName || "";
    const currentHomeWasHome = resultHomeId ? resultHomeId === homeId : String(homeName).toLowerCase() === String(match.home_team_name).toLowerCase();
    const winnerId = homeGoals === awayGoals ? "" : homeGoals > awayGoals
      ? (currentHomeWasHome ? homeId : awayId)
      : (currentHomeWasHome ? awayId : homeId);
    return {
      eventId: result.eventId || result.id || null,
      date: String(result.date || result.dateKey || "").slice(0, 10),
      home: homeName,
      away: awayName,
      homeTeamId: resultHomeId,
      awayTeamId: resultAwayId,
      score,
      winnerId,
      source: result.source || profile.source || "h2h-backfill",
    };
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date)).slice(-5);
  if (!normalizedResults.length) return null;
  const homeWins = normalizedResults.filter((result) => result.winnerId === homeId).length;
  const awayWins = normalizedResults.filter((result) => result.winnerId === awayId).length;
  const capturedAt = new Date().toISOString();
  return {
    played: normalizedResults.length,
    homeWins,
    draws: normalizedResults.length - homeWins - awayWins,
    awayWins,
    sameCompetitionPlayed: Number(profile.sameCompetitionPlayed || normalizedResults.length),
    weightedRecentBalance: Number(((homeWins - awayWins) / normalizedResults.length).toFixed(3)),
    results: normalizedResults,
    homeTeamId: homeId,
    awayTeamId: awayId,
    status: profile.status || profile.source || "h2h-backfill",
    source: profile.source || profile.status || "h2h-backfill",
    asOf: profile.asOf || capturedAt,
    sourceTimestamp: profile.asOf || capturedAt,
    targetPlayed: 5,
    coverage: Number((normalizedResults.length / 5).toFixed(2)),
    agent: { name: "H2H-agent", target: 5, filled: normalizedResults.length, complete: normalizedResults.length >= 5, sources: [profile.source || "h2h-backfill"] },
  };
}
