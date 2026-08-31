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

function profilePlayers(profile) {
  if (Array.isArray(profile?.players)) return profile.players;
  if (Array.isArray(profile?.squad)) return profile.squad;
  return Array.isArray(profile?.squad?.players) ? profile.squad.players : [];
}

function hasSquad(match) {
  return [match?.homeTeamProfile, match?.awayTeamProfile].every((profile) => Math.max(Number(profile?.squadSize || profile?.playerCount || profile?.squad?.playerCount || 0), profilePlayers(profile).length) >= 11);
}

function hasFreshSquad(match, now = Date.now()) {
  const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
  return hasSquad(match) && [match?.homeTeamProfile, match?.awayTeamProfile].every((profile) => {
    const checkedAt = Number(profile?.rosterSourceCheckedAt || profile?.fetchedAt || profile?.squad?.rosterSourceCheckedAt || profile?.squad?.fetchedAt || 0) || Date.parse(profile?.fetchedAt || profile?.checkedAt || profile?.squad?.fetchedAt || profile?.squad?.checkedAt || "");
    return Number.isFinite(checkedAt) && checkedAt > 0 && now - checkedAt <= maxAgeMs;
  });
}

function hasPlayerIdentities(match) {
  return [match?.homeTeamProfile, match?.awayTeamProfile].every((profile) => {
    const players = profilePlayers(profile);
    return players.length >= 11 && players.filter((player) => player?.id || player?.playerId || player?.providerId || player?.sourceId).length >= Math.min(11, players.length);
  });
}

function hasTimestampedOdds(match) {
  const odds = match?.oddsAtPrediction || match?.odds;
  const capturedAt = Date.parse(odds?.capturedAt || odds?.prematchCapturedAt || "");
  const kickoff = Date.parse(match?.kickoff || "");
  return [odds?.home, odds?.draw, odds?.away].every((value) => Number(value) > 1) && Number.isFinite(capturedAt) && Number.isFinite(kickoff) && capturedAt < kickoff;
}

function hasNoUnresolvedProviderConflict(match) {
  const conflicts = match?.providerDiagnostics?.conflicts || match?.sourceConflicts || [];
  return !Array.isArray(conflicts) || !conflicts.some((conflict) => !conflict?.resolved);
}

function fixtureEvidenceKey(match) {
  return String(match?.id || `${String(match?.date || match?.kickoff || "").slice(0, 10)}|${match?.homeTeamName || ""}|${match?.awayTeamName || ""}`);
}

function fixtureIdentityKey(match) {
  const clean = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const date = String(match?.date || match?.kickoff || "").slice(0, 10);
  const home = clean(match?.homeTeamName);
  const away = clean(match?.awayTeamName);
  return date && home && away ? `${date}|${home}|${away}` : "";
}

function profileEvidenceScore(profile) {
  const players = profilePlayers(profile);
  const identified = players.filter((player) => player?.id || player?.playerId || player?.providerId || player?.sourceId).length;
  const rated = players.filter((player) => Number(player?.rating || 0) > 0).length;
  return players.length * 100 + identified * 10 + rated;
}

function preserveProfileEvidence(previous, next) {
  if (!previous) return next;
  if (!next) return previous;
  if (profileEvidenceScore(next) >= profileEvidenceScore(previous)) return next;
  if (previous?.squad && !Array.isArray(previous.squad)) return { ...next, squad: previous.squad };
  return {
    ...next,
    players: previous.players,
    playerCount: previous.playerCount,
    squadSize: previous.squadSize,
    rosterSourceCheckedAt: previous.rosterSourceCheckedAt,
    fetchedAt: previous.fetchedAt,
  };
}

const EVIDENCE_FIELDS = {
  finalScores: hasScore,
  h2h: (match) => Number(match?.h2h?.played || match?.h2h?.results?.length || 0) > 0,
  form: (match) => hasRecent(match?.homeRecent) && hasRecent(match?.awayRecent),
  lineups: (match) => Boolean(match?.lineupSummary?.confirmed),
  squads: hasSquad,
  squadFreshness: hasFreshSquad,
  playerIdentities: hasPlayerIdentities,
  timestampedOdds: hasTimestampedOdds,
  providerConflicts: hasNoUnresolvedProviderConflict,
  postMatchStats: hasPostMatchStats,
};

export function preserveEnrichmentEvidence(previousMatches = [], nextMatches = []) {
  const byId = new Map(rows(previousMatches).filter((match) => match?.id).map((match) => [String(match.id), match]));
  const byIdentity = new Map(rows(previousMatches).map((match) => [fixtureIdentityKey(match), match]).filter(([key]) => key));
  const recentCount = (value) => Number(value?.gamesPlayed || value?.recentMatches?.length || 0);
  const h2hCount = (value) => Number(value?.played || value?.results?.length || 0);

  return rows(nextMatches).map((match) => {
    const previous = byId.get(String(match?.id || "")) || byIdentity.get(fixtureIdentityKey(match));
    if (!previous) return match;
    const restored = { ...match };
    if (h2hCount(previous.h2h) > h2hCount(restored.h2h)) restored.h2h = previous.h2h;
    if (recentCount(previous.homeRecent) > recentCount(restored.homeRecent)) restored.homeRecent = previous.homeRecent;
    if (recentCount(previous.awayRecent) > recentCount(restored.awayRecent)) restored.awayRecent = previous.awayRecent;
    if (previous?.lineupSummary?.confirmed && !restored?.lineupSummary?.confirmed) restored.lineupSummary = previous.lineupSummary;
    restored.homeTeamProfile = preserveProfileEvidence(previous.homeTeamProfile, restored.homeTeamProfile);
    restored.awayTeamProfile = preserveProfileEvidence(previous.awayTeamProfile, restored.awayTeamProfile);
    if (hasTimestampedOdds(previous) && !hasTimestampedOdds(restored)) {
      restored.oddsAtPrediction = previous.oddsAtPrediction;
      restored.odds = previous.odds;
    }
    if (hasPostMatchStats(previous) && !hasPostMatchStats(restored)) {
      restored.postMatchStats = previous.postMatchStats;
      restored.liveStats = previous.liveStats;
    }
    if (hasScore(previous) && !hasScore(restored)) {
      restored.status = previous.status;
      restored.homeScore = previous.homeScore;
      restored.awayScore = previous.awayScore;
      restored.score = previous.score;
    }
    return restored;
  });
}

export function summarizeEnrichmentCoverage(matches = []) {
  const all = rows(matches);
  const finished = all.filter((match) => FINAL.has(String(match?.status || "").toUpperCase()));
  const count = (predicate, base = all) => base.filter(predicate).length;
  const ratio = (covered, total) => total ? Number((covered / total).toFixed(3)) : 1;
  const metrics = {
    fixtures: all.length,
    finalScores: { covered: count(hasScore, finished), total: finished.length },
    h2h: { covered: count(EVIDENCE_FIELDS.h2h), total: all.length },
    form: { covered: count((match) => hasRecent(match?.homeRecent) && hasRecent(match?.awayRecent)), total: all.length },
    lineups: { covered: count((match) => Boolean(match?.lineupSummary?.confirmed)), total: all.length },
    squads: { covered: count(hasSquad), total: all.length },
    squadFreshness: { covered: count(hasFreshSquad), total: all.length },
    playerIdentities: { covered: count(hasPlayerIdentities), total: all.length },
    timestampedOdds: { covered: count(hasTimestampedOdds), total: all.length },
    providerConflicts: { covered: count(hasNoUnresolvedProviderConflict), total: all.length },
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
  const evidenceLosses = [];
  const nextById = new Map(rows(nextMatches).filter((match) => match?.id).map((match) => [String(match.id), match]));
  const nextByIdentity = new Map(rows(nextMatches).map((match) => [fixtureIdentityKey(match), match]).filter(([key]) => key));
  for (const previousMatch of rows(previousMatches)) {
    const nextMatch = nextById.get(String(previousMatch?.id || "")) || nextByIdentity.get(fixtureIdentityKey(previousMatch));
    if (!nextMatch) continue;
    for (const [field, predicate] of Object.entries(EVIDENCE_FIELDS)) {
      if (field === "providerConflicts") continue;
      if (predicate(previousMatch) && !predicate(nextMatch)) evidenceLosses.push({ matchId: fixtureEvidenceKey(previousMatch), field });
    }
  }
  for (const loss of evidenceLosses) regressions.push({ field: loss.field, matchId: loss.matchId, reason: "existing-fixture-evidence-lost" });
  if (previous.fixtures >= minimumSample && next.fixtures < previous.fixtures * (1 - maxRelativeDrop)) {
    regressions.push({ field: "fixtures", before: previous.fixtures, after: next.fixtures });
  }
  const previousScores = previous.finalScores;
  const nextScores = next.finalScores;
  if (previousScores.total >= minimumSample && previousScores.covered > 0 && nextScores.covered < previousScores.covered) {
    if (!regressions.some((item) => item.field === "finalScores")) {
      regressions.push({ field: "finalScores", before: previousScores, after: nextScores });
    }
  }
  return {
    allowed: regressions.length === 0,
    checkedAt: new Date().toISOString(),
    previous,
    next,
    maxRelativeDrop,
    regressions,
    evidenceLosses,
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
