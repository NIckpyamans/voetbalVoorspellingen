import { canonicalDedupeTeam } from "../../shared/matchNormalization.js";
import { contentHash } from "../../shared/data-publication.js";

export const H2H_PROFILE_SCHEMA = "h2h-profile-v1";

function teamName(value) {
  return String(typeof value === "object" ? value?.name || value?.teamName || "" : value || "").trim();
}

function resultTeamId(value, fallback) {
  const id = typeof value === "object" ? value?.id || value?.teamId : value;
  return String(id || fallback || "").trim();
}

function resultScore(result) {
  const score = String(result?.score || result?.result || "").match(/^(\d+)\s*[-:]\s*(\d+)$/);
  const home = score ? Number(score[1]) : Number(result?.homeScore ?? result?.homeGoals);
  const away = score ? Number(score[2]) : Number(result?.awayScore ?? result?.awayGoals);
  return Number.isSafeInteger(home) && Number.isSafeInteger(away) && home >= 0 && away >= 0
    ? { home, away }
    : null;
}

function kickoffMs(match) {
  const time = Date.parse(match?.kickoff_at || match?.kickoff || "");
  return Number.isFinite(time) ? time : null;
}

function sameTeam(targetId, targetName, resultId, resultName) {
  if (targetId && resultId && String(targetId) === String(resultId)) return true;
  const target = canonicalDedupeTeam(targetName);
  return Boolean(target && target === canonicalDedupeTeam(resultName));
}

function normalizeResult(result, match, provider, asOf) {
  const score = resultScore(result);
  const dateValue = result?.date || result?.dateKey || result?.kickoff || result?.sourceTimestamp;
  const dateMs = Date.parse(dateValue || "");
  const targetHomeName = teamName(match?.home_team_name || match?.homeTeamName);
  const targetAwayName = teamName(match?.away_team_name || match?.awayTeamName);
  const targetHomeId = String(match?.home_club_id || match?.homeTeamId || "");
  const targetAwayId = String(match?.away_club_id || match?.awayTeamId || "");
  const homeName = teamName(result?.home || result?.homeTeam || result?.homeTeamName);
  const awayName = teamName(result?.away || result?.awayTeam || result?.awayTeamName);
  const homeId = resultTeamId(result?.home || result?.homeTeam, result?.homeTeamId || result?.homeId);
  const awayId = resultTeamId(result?.away || result?.awayTeam, result?.awayTeamId || result?.awayId);
  if (!score || !Number.isFinite(dateMs)) return { rejected: "invalid_score_or_date" };
  const cutoff = kickoffMs(match);
  if (cutoff !== null && dateMs >= cutoff) return { rejected: "after_kickoff" };
  const direct = sameTeam(targetHomeId, targetHomeName, homeId, homeName) && sameTeam(targetAwayId, targetAwayName, awayId, awayName);
  const reversed = sameTeam(targetHomeId, targetHomeName, awayId, awayName) && sameTeam(targetAwayId, targetAwayName, homeId, homeName);
  if (!direct && !reversed) return { rejected: "team_identity_mismatch" };
  const isoDate = new Date(dateMs).toISOString();
  const competitionId = String(result?.competitionId || result?.tournamentId || result?.competition_id || result?.leagueId || "") || null;
  const competitionLabel = String(result?.league || "").trim().toLowerCase();
  const targetCompetitionId = String(match?.competition_id || match?.competitionId || "");
  const targetCompetitionLabel = String(match?.league || "").trim().toLowerCase();
  const competitionMatches = competitionId && targetCompetitionId
    ? competitionId === targetCompetitionId
    : Boolean(competitionLabel && targetCompetitionLabel && competitionLabel === targetCompetitionLabel);
  const currentHomeScore = direct ? score.home : score.away;
  const currentAwayScore = direct ? score.away : score.home;
  const canonical = {
    fixtureId: String(result?.eventId || result?.providerFixtureId || result?.id || "") || null,
    date: isoDate.slice(0, 10),
    homeTeam: homeName || targetHomeName,
    awayTeam: awayName || targetAwayName,
    homeTeamId: homeId || null,
    awayTeamId: awayId || null,
    currentHomeIsHistoricalHome: direct,
    homeScore: score.home,
    awayScore: score.away,
    currentHomeScore,
    currentAwayScore,
    score: `${score.home}-${score.away}`,
    competitionId,
    league: String(result?.league || "") || null,
    competitionMatches,
    source: String(result?.source || provider || "unknown"),
    sourceTimestamp: result?.sourceTimestamp || result?.date || asOf,
    fetchedAt: asOf,
  };
  return { result: canonical };
}

export function normalizeH2HProfile(profile, { match, provider = profile?.source || "unknown", fetchedAt = new Date().toISOString() } = {}) {
  const rejected = {};
  const results = [];
  for (const input of Array.isArray(profile?.results) ? profile.results : []) {
    const normalized = normalizeResult(input, match, provider, fetchedAt);
    if (normalized.result) results.push(normalized.result);
    else rejected[normalized.rejected] = (rejected[normalized.rejected] || 0) + 1;
  }
  const unique = new Map();
  for (const result of results) {
    const key = result.fixtureId || `${result.date}|${canonicalDedupeTeam(result.homeTeam)}|${canonicalDedupeTeam(result.awayTeam)}|${result.score}`;
    if (!unique.has(key)) unique.set(key, result);
  }
  const normalizedResults = [...unique.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-8);
  const homeId = String(match?.home_club_id || match?.homeTeamId || "");
  const awayId = String(match?.away_club_id || match?.awayTeamId || "");
  const homeWins = normalizedResults.filter((result) => result.currentHomeScore > result.currentAwayScore).length;
  const awayWins = normalizedResults.filter((result) => result.currentAwayScore > result.currentHomeScore).length;
  const profileHash = contentHash(normalizedResults);
  const source = String(provider || profile?.source || "unknown");
  const asOf = String(profile?.asOf || fetchedAt);
  return {
    schemaVersion: H2H_PROFILE_SCHEMA,
    matchId: String(match?.match_id || match?.id || "") || null,
    homeTeamId: homeId || null,
    awayTeamId: awayId || null,
    source,
    asOf,
    fetchedAt,
    status: normalizedResults.length ? "available" : profile?.status || "no_direct_history",
    availabilityStatus: normalizedResults.length ? "available" : profile?.availabilityStatus || profile?.status || "no_direct_history",
    played: normalizedResults.length,
    publishable: normalizedResults.length > 0 && Object.keys(rejected).length === 0,
    homeWins,
    draws: normalizedResults.length - homeWins - awayWins,
    awayWins,
    sameCompetitionPlayed: normalizedResults.filter((result) => result.competitionMatches).length,
    results: normalizedResults,
    contentHash: profileHash,
    quality: {
      accepted: normalizedResults.length,
      rejected,
      valid: normalizedResults.length > 0 && Object.keys(rejected).length === 0,
    },
  };
}
