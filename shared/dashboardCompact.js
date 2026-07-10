function pickArray(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : value;
}

function compactSourceCoverage(coverage) {
  if (!coverage || typeof coverage !== "object") return coverage;
  return {
    score: coverage.score,
    status: coverage.status,
    providers: pickArray(coverage.providers, 6),
    missing: pickArray(coverage.missing, 6),
    warnings: pickArray(coverage.warnings, 6),
    backupSources: pickArray(coverage.backupSources, 6),
  };
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
    odds: match.odds
      ? {
          home: match.odds.home,
          draw: match.odds.draw,
          away: match.odds.away,
          provider: match.odds.provider || null,
          bookmaker: match.odds.bookmaker || null,
        }
      : null,
    hasOdds: Boolean(match.odds || match.oddsAtPrediction),
    h2hStatus: match.h2hStatus,
    lineupStatus: match.lineupStatus,
    lineupSummary: match.lineupSummary
      ? {
          confirmed: Boolean(match.lineupSummary.confirmed),
          projected: Boolean(match.lineupSummary.projected),
          source: match.lineupSummary.source || null,
          home: match.lineupSummary.home
            ? {
                formation: match.lineupSummary.home.formation || null,
                starters: match.lineupSummary.home.starters || null,
                avgRating: match.lineupSummary.home.avgRating || null,
              }
            : null,
          away: match.lineupSummary.away
            ? {
                formation: match.lineupSummary.away.formation || null,
                starters: match.lineupSummary.away.starters || null,
                avgRating: match.lineupSummary.away.avgRating || null,
              }
            : null,
        }
      : null,
    weather: match.weather
      ? {
          summary: match.weather.summary,
          temperature: match.weather.temperature,
          windKph: match.weather.windKph,
          precipitationMm: match.weather.precipitationMm,
        }
      : null,
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
