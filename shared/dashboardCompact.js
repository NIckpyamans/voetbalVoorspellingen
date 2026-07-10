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

export function compactDashboardMatch(match) {
  if (!match || typeof match !== "object") return match;
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
    homeLogo: match.homeLogo,
    awayLogo: match.awayLogo,
    score: match.score,
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
    h2hPlayed: h2hPlayed(match),
    h2hStatus: match.h2hStatus,
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
        }
      : null,
    h2hStatus: prediction.h2hStatus,
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
