function pickArray(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : value;
}

function compactSourceCoverage(coverage) {
  if (!coverage || typeof coverage !== "object") return coverage;
  return {
    score: coverage.score,
    percent: coverage.percent,
    status: coverage.status,
    entries: pickArray(coverage.entries, 8)?.map((entry) => ({
      key: entry?.key,
      available: Boolean(entry?.available),
      source: entry?.source || null,
    })),
    providers: pickArray(coverage.providers, 6),
    missing: pickArray(coverage.missing, 6),
    backupSources: pickArray(coverage.backupSources, 6),
  };
}

function coverageHas(match, key) {
  const entries = [
    ...(Array.isArray(match?.sourceCoverage?.entries) ? match.sourceCoverage.entries : []),
    ...(Array.isArray(match?.freeSourceCoverage?.entries) ? match.freeSourceCoverage.entries : []),
  ];
  return entries.some((entry) => entry?.key === key && entry?.available);
}

function h2hPlayed(match) {
  return Math.max(
    Number(match?.h2h?.played || 0),
    Array.isArray(match?.h2h?.results) ? match.h2h.results.length : 0,
    Array.isArray(match?.h2h?.lastMatches) ? match.h2h.lastMatches.length : 0
  );
}

export function h2hAvailabilityLabel(match) {
  if (h2hPlayed(match) > 0) return "beschikbaar";
  const status = String(match?.h2h?.status || match?.h2hStatus || match?.h2hAvailability || "").toLowerCase();
  if (/provider_unreachable|source_unreachable|request_failed|provider_exception|fetch_unavailable|http_error|provider_error/.test(status)) return "bron niet bereikbaar";
  if (/mapping_missing|team_mapping_missing|mapping_failed/.test(status)) return "team-ID ontbreekt";
  if (/not_configured|acceptance_blocked|acceptance_gate_closed|gate_closed/.test(status)) return "bron uitgeschakeld";
  if (/no_direct_history|not_found|no_coverage|h2h-agent-empty|geen.*ontmoeting/.test(status)) return "geen ontmoetingen gevonden";
  return "nog niet gecontroleerd";
}

export function h2hMetadata(match) {
  return {
    status: h2hAvailabilityLabel(match),
    sampleSize: h2hPlayed(match),
    sameCompetitionSampleSize: Number(match?.h2h?.sameCompetitionPlayed ?? match?.h2hCompetitionPlayed ?? 0),
    source: match?.h2h?.source || match?.h2h?.provider || match?.h2hSource || null,
    updatedAt: match?.h2h?.updatedAt || match?.h2h?.retrievedAt || match?.h2hAsOf || match?.h2h?.asOf || match?.sourceAsOf?.h2h || null,
  };
}

export function h2hSummaryWithSource(match) {
  const { status, sampleSize, sameCompetitionSampleSize, source, updatedAt } = h2hMetadata(match);
  const updated = updatedAt ? new Date(updatedAt).toLocaleString("nl-NL") : "onbekend";
  return `${sampleSize} geldige ontmoetingen · ${status} · ${sameCompetitionSampleSize} in dezelfde competitie · bron ${source || "onbekend"} · bijgewerkt ${updated}`;
}

function compactLogo(value) {
  const logo = String(value || "");
  return logo.startsWith("data:") ? "" : logo;
}

export function compactDashboardMatch(match) {
  if (!match || typeof match !== "object") return match;
  const h2h = h2hMetadata(match);
  return {
    id: match.id,
    date: match.date,
    kickoff: match.kickoff,
    status: match.status,
    minute: match.minute,
    league: match.league,
    country: match.country,
    phase: match.phase,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    homeTeamName: match.homeTeamName,
    awayTeamName: match.awayTeamName,
    homeLogo: compactLogo(match.homeLogo),
    awayLogo: compactLogo(match.awayLogo),
    score: match.score,
    goalMinuteEvents: Array.isArray(match.goalMinuteEvents)
      ? match.goalMinuteEvents.slice(-12).map((event) => ({
          id: event.id,
          minute: event.minute ?? null,
          side: event.side,
          teamName: event.teamName || null,
          playerName: event.playerName || null,
          kind: event.kind || "goal",
        }))
      : [],
    goalMinuteEventsUpdatedAt: match.goalMinuteEventsUpdatedAt ?? null,
    homePos: match.homePos ?? null,
    awayPos: match.awayPos ?? null,
    standingProvisional: Boolean(match.standingProvisional),
    homeStandingProvisional: Boolean(match.homeStandingProvisional),
    awayStandingProvisional: Boolean(match.awayStandingProvisional),
    standingCompetition: match.standingCompetition || null,
    standingsSourceLabel: match.standingsSourceLabel || null,
    favorite: match.favorite,
    prediction: match.prediction
      ? {
          matchId: match.prediction.matchId,
          predHomeGoals: match.prediction.predHomeGoals,
          predAwayGoals: match.prediction.predAwayGoals,
          homeProb: match.prediction.homeProb,
          drawProb: match.prediction.drawProb,
          awayProb: match.prediction.awayProb,
          confidence: match.prediction.confidence,
          exactProb: match.prediction.exactProb,
          exactScoreConfidence: match.prediction.exactScoreConfidence,
          bestBetRank: match.prediction.bestBetRank,
          topExactScorePick: match.prediction.topExactScorePick,
        }
      : null,
    hasOdds: Boolean(match.odds || match.oddsAtPrediction || match.dbFeatureContext?.historicalOdds?.samples || coverageHas(match, "odds")),
    hasXg: Boolean(
      coverageHas(match, "xg_style") ||
      match.dbFeatureContext?.matchStats?.homeXg != null ||
      match.dbFeatureContext?.matchStats?.awayXg != null ||
      Number(match.dbFeatureContext?.matchStats?.homeShots || 0) > 0 ||
      Number(match.dbFeatureContext?.matchStats?.awayShots || 0) > 0
    ),
    hasWeather: Boolean(coverageHas(match, "weather") || match.weather?.conditions || match.weather?.temperature != null),
    h2hPlayed: h2h.sampleSize,
    h2hStatus: match.h2h?.status || match.h2hStatus || "unchecked",
    h2hAvailability: match.h2hAvailability || h2h.status,
    h2hSource: h2h.source,
    h2hAsOf: h2h.updatedAt,
    h2hCompetitionPlayed: h2h.sameCompetitionSampleSize,
    h2hSameCompetitionPlayed: h2h.sameCompetitionSampleSize,
    lineupStatus: match.lineupStatus,
    lineupConfirmed: Boolean(match.lineupSummary?.confirmed),
    lineupProjected: Boolean(match.lineupSummary?.projected),
    sourceCoverage: compactSourceCoverage(match.sourceCoverage),
    freeSourceCoverage: compactSourceCoverage(match.freeSourceCoverage),
    review: match.review
      ? {
          outcome: match.review.outcome,
          wasCorrect: match.review.wasCorrect,
          winnerCorrect: match.review.winnerCorrect,
          errorMargin: match.review.errorMargin,
        }
      : null,
    learningSummary: match.learningSummary
      ? { summary: match.learningSummary.summary, confidence: match.learningSummary.confidence }
      : null,
  };
}

export function compactDashboardPrediction(prediction) {
  if (!prediction || typeof prediction !== "object") return prediction;
  return {
    matchId: prediction.matchId,
    model: prediction.model,
    predHomeGoals: prediction.predHomeGoals,
    predAwayGoals: prediction.predAwayGoals,
    homeProb: prediction.homeProb,
    drawProb: prediction.drawProb,
    awayProb: prediction.awayProb,
    confidence: prediction.confidence,
    exactProb: prediction.exactProb,
    exactScoreConfidence: prediction.exactScoreConfidence,
    bestBetRank: prediction.bestBetRank,
    topConfidencePick: prediction.topConfidencePick,
    topExactScorePick: prediction.topExactScorePick,
    exactScoreReasons: pickArray(prediction.exactScoreReasons, 2),
    topExactReasons: pickArray(prediction.topExactReasons, 2),
    odds: prediction.odds
      ? {
          home: prediction.odds.home,
          draw: prediction.odds.draw,
          away: prediction.odds.away,
          provider: prediction.odds.provider || null,
          bookmaker: prediction.odds.bookmaker || null,
          capturedAt: prediction.odds.capturedAt || prediction.odds.lastUpdated || null,
        }
      : null,
    h2hStatus: prediction.h2hStatus,
    h2hSource: prediction.h2hSource || prediction.h2h?.source || null,
    h2hAsOf: prediction.h2hAsOf || prediction.h2h?.asOf || prediction.h2h?.sourceTimestamp || null,
    h2hCompetitionPlayed: prediction.h2hCompetitionPlayed ?? prediction.h2h?.sameCompetitionPlayed ?? 0,
    lineupSummary: prediction.lineupSummary
      ? {
          confirmed: Boolean(prediction.lineupSummary.confirmed),
          projected: Boolean(prediction.lineupSummary.projected),
          source: prediction.lineupSummary.source || null,
        }
      : null,
    dataCompleteness: prediction.dataCompleteness
      ? {
          score: prediction.dataCompleteness.score,
          percent: prediction.dataCompleteness.percent,
          status: prediction.dataCompleteness.status,
        }
      : null,
    qualityGate: prediction.qualityGate
      ? {
          summary: prediction.qualityGate.summary,
          blockedHighConfidence: prediction.qualityGate.blockedHighConfidence,
          confidenceCap: prediction.qualityGate.confidenceCap,
        }
      : null,
    sourceCoverage: compactSourceCoverage(prediction.sourceCoverage),
    freeSourceCoverage: compactSourceCoverage(prediction.freeSourceCoverage),
  };
}

export function latestPredictionPerMatch(predictions = []) {
  const byMatch = new Map();
  for (const prediction of predictions || []) {
    if (!prediction?.matchId) continue;
    byMatch.set(String(prediction.matchId), prediction);
  }
  return [...byMatch.values()];
}
