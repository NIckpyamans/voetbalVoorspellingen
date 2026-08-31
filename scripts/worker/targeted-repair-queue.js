const FINAL = new Set(["FT", "AET", "PEN"]);

function missingFields(match) {
  const fields = [];
  if (Number(match?.h2h?.played || match?.h2h?.results?.length || 0) <= 0) fields.push("h2h");
  if (Number(match?.homeRecent?.gamesPlayed || match?.homeRecent?.recentMatches?.length || 0) < 5 || Number(match?.awayRecent?.gamesPlayed || match?.awayRecent?.recentMatches?.length || 0) < 5) fields.push("form");
  if (!match?.lineupSummary?.confirmed) fields.push("lineups");
  if (!match?.oddsAtPrediction && !match?.odds?.home) fields.push("odds");
  const profiles = [match?.homeTeamProfile, match?.awayTeamProfile];
  const players = (profile) => Array.isArray(profile?.players)
    ? profile.players
    : Array.isArray(profile?.squad)
      ? profile.squad
      : Array.isArray(profile?.squad?.players)
        ? profile.squad.players
        : [];
  if (!profiles.every((profile) => Math.max(Number(profile?.playerCount || profile?.squadSize || profile?.squad?.playerCount || 0), players(profile).length) >= 11)) fields.push("squads");
  if (!profiles.every((profile) => players(profile).length >= 11 && players(profile).filter((player) => player?.id || player?.playerId || player?.providerId || player?.sourceId).length >= Math.min(11, players(profile).length))) fields.push("playerIdentities");
  const odds = match?.oddsAtPrediction || match?.odds;
  const oddsCapturedAt = Date.parse(odds?.capturedAt || odds?.prematchCapturedAt || "");
  if (odds && !(Number.isFinite(oddsCapturedAt) && oddsCapturedAt < Date.parse(match?.kickoff || ""))) fields.push("timestampedOdds");
  const conflicts = match?.providerDiagnostics?.conflicts || match?.sourceConflicts || [];
  if (Array.isArray(conflicts) && conflicts.some((conflict) => !conflict?.resolved)) fields.push("providerConflicts");
  const stats = match?.postMatchStats || match?.liveStats;
  const usableStats = stats && !/^missing|unknown$/i.test(String(stats?.source || "")) && Boolean(stats?.events?.length || stats?.referee || [stats?.home?.shots, stats?.away?.shots].some((value) => Number.isFinite(Number(value))));
  if (FINAL.has(String(match?.status || "").toUpperCase()) && !usableStats) fields.push("postMatchStats");
  return fields;
}

export function buildTargetedRepairQueue(matches = [], options = {}) {
  const now = Number(options.now || Date.now());
  const followed = new Set(options.followedCompetitions || []);
  return (matches || []).map((match) => {
    const missing = missingFields(match);
    if (!missing.length) return null;
    const kickoff = Date.parse(match?.kickoff || "");
    const hours = Number.isFinite(kickoff) ? (kickoff - now) / 3600000 : 999;
    const within24h = hours >= -6 && hours <= 24;
    const followedCompetition = followed.size === 0 || followed.has(match?.league);
    const completeness = Number(match?.dataCompletenessScore ?? match?.freeSourceCoverage?.percent / 100 ?? 0);
    const priority = Math.round((within24h ? 100 : 0) + (followedCompetition ? 40 : 0) + missing.length * 12 + Math.max(0, 1 - completeness) * 25);
    return {
      matchId: match?.id || match?.matchId,
      date: match?.date || String(match?.kickoff || "").slice(0, 10),
      kickoff: match?.kickoff || null,
      league: match?.league || "unknown",
      homeTeam: match?.homeTeamName,
      awayTeam: match?.awayTeamName,
      missing,
      providerAttempts: match?.providerDiagnostics?.attempts || null,
      retryReason: match?.providerDiagnostics?.lastFailure || null,
      within24h,
      priority,
    };
  }).filter(Boolean).sort((left, right) => right.priority - left.priority || String(left.kickoff).localeCompare(String(right.kickoff)));
}

export function summarizeRepairNeeds(queue = []) {
  const fields = {};
  for (const row of queue) for (const field of row.missing || []) fields[field] = Number(fields[field] || 0) + 1;
  return { pending: queue.length, urgent: queue.filter((row) => row.within24h).length, fields };
}
