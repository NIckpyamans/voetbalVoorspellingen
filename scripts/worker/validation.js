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
    const key = item?.eventId
      ? `event_${item.eventId}`
      : `${item?.date || ""}_${item?.home || ""}_${item?.away || ""}_${item?.score || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")))
    .slice(-8);
}

export function lookupCuratedResultBackfill(curatedResultBackfill, buildPairKey, dateISO, homeName, awayName) {
  const pairKey = buildPairKey(homeName, awayName);
  const result = (curatedResultBackfill || []).find(
    (item) => item.date === dateISO && buildPairKey(item.home, item.away) === pairKey
  );
  if (!result) return null;

  const normalize = (value) => String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const reversed = normalize(result.home) === normalize(awayName) && normalize(result.away) === normalize(homeName);
  if (!reversed || !/^\d+\s*-\s*\d+$/.test(String(result.score || ""))) return result;
  const [homeGoals, awayGoals] = String(result.score).split("-").map((value) => value.trim());
  return {
    ...result,
    score: `${awayGoals}-${homeGoals}`,
    orientedFromReverse: true,
  };
}

export function lookupHistoricalResultBackfill(store, match, dateKey, deps) {
  if (!store || !match || !dateKey) return null;
  const homeName = match.homeTeamName || match.homeTeam;
  const awayName = match.awayTeamName || match.awayTeam;
  const profileBuckets = [
    store.marketProfiles?.[match.league],
    store.openfootballProfiles?.[match.league],
    ...Object.values(store.marketProfiles || {}),
    ...Object.values(store.openfootballProfiles || {}),
  ].filter(Boolean);
  const seenProfiles = new Set();
  for (const profile of profileBuckets) {
    const profileKey = `${profile.source || "profile"}:${profile.updatedAt || ""}:${profile.sampleSize || ""}`;
    if (seenProfiles.has(profileKey)) continue;
    seenProfiles.add(profileKey);
    const historical = deps.lookupHistoricalH2HBackfill(profile, homeName, awayName, match.homeTeamId, match.awayTeamId);
    const hit = (historical?.results || []).find((item) => String(item?.date || "").slice(0, 10) === dateKey);
    const oriented = hit ? deps.orientHistoricalScore(hit, homeName, awayName) : null;
    if (oriented) {
      return {
        ...oriented,
        source: hit.source || historical.status || profile.source || "historical-result-backfill",
      };
    }
  }
  return null;
}

export function normalizeStoredMatchReliability(match, dateKey, now, store = null, deps) {
  if (!match || typeof match !== "object") return match;
  const next = { ...match };
  const result = lookupCuratedResultBackfill(
    deps.curatedResultBackfill,
    deps.buildPairKey,
    dateKey,
    next.homeTeamName || next.homeTeam,
    next.awayTeamName || next.awayTeam
  );
  if (result && ["POSTPONED", "CANCELLED", "ABANDONED"].includes(String(result.status || "").toUpperCase())) {
    next.status = String(result.status || "").toUpperCase();
    next.score = null;
    next.homeScore = null;
    next.awayScore = null;
    next.resultBackfill = true;
    next.resultBackfillSource = result.sourceNote || "curated fixture status backfill";
    next.resultPending = false;
    next.resultPendingReason = null;
  }
  if (result && !matchHasFinalScore(next)) {
    const [homeScore, awayScore] = String(result.score || "").split("-").map(Number);
    if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
      next.homeScore = homeScore;
      next.awayScore = awayScore;
      next.score = result.score;
      next.status = result.status || "FT";
      next.resultBackfill = true;
      next.resultBackfillSource = result.sourceNote || "curated result backfill";
      next.resultPending = false;
      next.resultPendingReason = null;
    }
  }
  const historicalResult = store && !matchHasFinalScore(next) ? lookupHistoricalResultBackfill(store, next, dateKey, deps) : null;
  if (historicalResult && !matchHasFinalScore(next)) {
    next.homeScore = historicalResult.homeScore;
    next.awayScore = historicalResult.awayScore;
    next.score = historicalResult.score;
    next.status = "FT";
    next.resultBackfill = true;
    next.resultBackfillSource = historicalResult.source || "historical result backfill";
    next.resultPending = false;
    next.resultPendingReason = null;
  }
  const storedH2H = store && Number(next.h2h?.played || 0) <= 0 ? deps.lookupStoredMatchH2HBackfill(store, next, dateKey) : null;
  if (storedH2H?.played) {
    next.h2h = {
      ...storedH2H,
      agent: {
        ...(storedH2H.agent || {}),
        name: "H2H-agent",
        source: "stored-match-history",
      },
    };
  }

  const kickoffMs = Date.parse(next.kickoff || next.date || `${dateKey}T12:00:00Z`);
  const status = String(next.status || "").toUpperCase();
  const isPastResultWindow = Number.isFinite(kickoffMs) && now - kickoffMs > 150 * 60 * 1000;
  if (
    isPastResultWindow &&
    !matchHasFinalScore(next) &&
    !["POSTPONED", "CANCELLED", "ABANDONED"].includes(status)
  ) {
    next.status = "RESULT_PENDING";
    next.resultPending = true;
    next.resultPendingReason =
      next.resultPendingReason || "Wedstrijd is voorbij, maar geen betrouwbare eindstand gevonden in de gratis bronnen.";
  }

  const sourceAsOf = { ...(next.sourceAsOf || {}) };
  if (!sourceAsOf.fixture) sourceAsOf.fixture = deps.isoFromMs(now);
  if (next.resultBackfill && !sourceAsOf.result) sourceAsOf.result = deps.isoFromMs(now);
  if (Number(next.h2h?.played || 0) > 0) {
    const h2hAsOf =
      next.h2h.asOf ||
      next.h2h.sourceTimestamp ||
      sourceAsOf.h2h ||
      sourceAsOf.openfootballProfile ||
      sourceAsOf.marketProfile ||
      deps.isoFromMs(now);
    next.h2h = {
      ...next.h2h,
      source: next.h2h.source || next.h2h.status || "h2h-agent",
      asOf: h2hAsOf,
      sourceTimestamp: h2hAsOf,
    };
    sourceAsOf.h2h = h2hAsOf;
  }
  next.sourceAsOf = sourceAsOf;
  next.dataReliability = {
    ...(next.dataReliability || {}),
    resultStatus: matchHasFinalScore(next) ? "final_score" : next.resultPending ? "result_pending_backfill" : "pre_match",
    h2hTimestampKnown: Number(next.h2h?.played || 0) > 0 ? !!(next.h2h?.asOf || next.h2h?.sourceTimestamp) : false,
    checkedAt: deps.isoFromMs(now),
  };
  return next;
}
