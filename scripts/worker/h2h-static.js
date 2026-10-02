import { canonicalDedupeTeam } from "../../shared/matchNormalization.js";

function scoreFromResult(result) {
  if (typeof result?.score === "string" && /^\d+\s*-\s*\d+$/.test(result.score)) return result.score.replace(/\s/g, "");
  const home = Number(result?.homeScore ?? result?.homeGoals);
  const away = Number(result?.awayScore ?? result?.awayGoals);
  return Number.isFinite(home) && Number.isFinite(away) ? `${home}-${away}` : null;
}

function teamName(value) {
  return String(typeof value === "object" ? value?.name || value?.teamName || "" : value || "");
}

function matchesTeam(targetId, targetName, resultId, resultName) {
  if (targetId && resultId) return String(targetId) === String(resultId);
  const target = canonicalDedupeTeam(targetName);
  return Boolean(target && target === canonicalDedupeTeam(resultName));
}

function weightedBalance(results, homeId, awayId) {
  const recent = results.slice(-5);
  let weightedScore = 0;
  let weightTotal = 0;
  recent.forEach((result, index) => {
    const weight = 0.6 + index * 0.1;
    weightedScore += (result.winnerId === homeId ? 1 : result.winnerId === awayId ? -1 : 0) * weight;
    weightTotal += weight;
  });
  return weightTotal ? Number((weightedScore / weightTotal).toFixed(3)) : 0;
}

function resultCompetitionMatches(result, match) {
  const resultCompetition = result.competitionId || result.tournamentId || result.competition_id || result.leagueId;
  const targetCompetition = match.competition_id || match.competitionId;
  if (resultCompetition != null && targetCompetition != null) return String(resultCompetition) === String(targetCompetition);
  if (result.league && match.league) return String(result.league).trim().toLowerCase() === String(match.league).trim().toLowerCase();
  return false;
}

export function normalizeStaticH2H(match, profile) {
  const homeId = String(match.home_club_id || "");
  const awayId = String(match.away_club_id || "");
  const targetHomeName = match.home_team_name || "";
  const targetAwayName = match.away_team_name || "";
  const normalizedResults = (profile?.results || []).map((result) => {
    const score = scoreFromResult(result);
    if (!score) return null;
    const [homeGoals, awayGoals] = score.split("-").map(Number);
    const resultHomeId = String(result.homeTeamId || result.homeId || result.homeTeam?.id || "");
    const resultAwayId = String(result.awayTeamId || result.awayId || result.awayTeam?.id || "");
    const homeName = teamName(result.home || result.homeTeam || result.homeTeamName);
    const awayName = teamName(result.away || result.awayTeam || result.awayTeamName);
    const date = String(result.date || result.dateKey || "").slice(0, 10);
    const targetKickoff = String(match.kickoff_at || match.kickoff || "").slice(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (targetKickoff && date >= targetKickoff)) return null;
    const currentHomeWasHome =
      matchesTeam(homeId, targetHomeName, resultHomeId, homeName) && matchesTeam(awayId, targetAwayName, resultAwayId, awayName);
    const currentHomeWasAway =
      matchesTeam(homeId, targetHomeName, resultAwayId, awayName) && matchesTeam(awayId, targetAwayName, resultHomeId, homeName);
    if (!currentHomeWasHome && !currentHomeWasAway) return null;
    const winnerId = homeGoals === awayGoals ? "" : homeGoals > awayGoals
      ? (currentHomeWasHome ? homeId : awayId)
      : (currentHomeWasHome ? awayId : homeId);
    return {
      eventId: result.eventId || result.id || null,
      date,
      home: homeName,
      away: awayName,
      homeTeamId: resultHomeId,
      awayTeamId: resultAwayId,
      score,
      homeScore: homeGoals,
      awayScore: awayGoals,
      winnerId,
      competitionId: result.competitionId || result.tournamentId || result.competition_id || result.leagueId || null,
      league: result.league || null,
      source: result.source || profile.source || "h2h-backfill",
    };
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date)).slice(-5);
  if (!normalizedResults.length) return null;
  const homeWins = normalizedResults.filter((result) => result.winnerId === homeId).length;
  const awayWins = normalizedResults.filter((result) => result.winnerId === awayId).length;
  const explicitCompetitionResults = normalizedResults.filter((result) => result.competitionId != null || result.league);
  const sameCompetitionPlayed = explicitCompetitionResults.length
    ? explicitCompetitionResults.filter((result) => resultCompetitionMatches(result, match)).length
    : Math.min(normalizedResults.length, Math.max(0, Number(profile.sameCompetitionPlayed || 0)));
  const capturedAt = new Date().toISOString();
  return {
    played: normalizedResults.length,
    homeWins,
    draws: normalizedResults.length - homeWins - awayWins,
    awayWins,
    sameCompetitionPlayed,
    weightedRecentBalance: weightedBalance(normalizedResults, homeId, awayId),
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
