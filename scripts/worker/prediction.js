export const PREDICTION_MODULE = {
  name: "prediction",
  owns: ["feature vector construction", "Poisson score matrix", "ensemble probabilities", "confidence calibration"],
};

export function factorial(n) {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

export function poisson(lambda, k) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

export function dixonColesAdjustment(h, a, homeXG, awayXG, rho = -0.13) {
  if (h === 0 && a === 0) return 1 - homeXG * awayXG * rho;
  if (h === 0 && a === 1) return 1 + homeXG * rho;
  if (h === 1 && a === 0) return 1 + awayXG * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

export function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildPoissonScoreModel(homeXG, awayXG, options = {}) {
  const maxGoals = Number(options.maxGoals ?? 6);
  const minMatrixProbability = Number(options.minMatrixProbability ?? 0.01);
  let homeProb = 0;
  let drawProb = 0;
  let awayProb = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let btts = 0;
  let bestScore = "1-1";
  let bestProb = 0;
  const bestByOutcome = {
    home: { score: "1-0", probability: 0 },
    draw: { score: "1-1", probability: 0 },
    away: { score: "0-1", probability: 0 },
  };
  const scoreMatrix = {};

  for (let homeGoals = 0; homeGoals <= maxGoals; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= maxGoals; awayGoals += 1) {
      const probability =
        poisson(homeXG, homeGoals) *
        poisson(awayXG, awayGoals) *
        dixonColesAdjustment(homeGoals, awayGoals, homeXG, awayXG);

      if (homeGoals > awayGoals) homeProb += probability;
      else if (homeGoals === awayGoals) drawProb += probability;
      else awayProb += probability;

      if (probability > bestProb) {
        bestProb = probability;
        bestScore = `${homeGoals}-${awayGoals}`;
      }

      if (homeGoals > awayGoals && probability > bestByOutcome.home.probability) {
        bestByOutcome.home = { score: `${homeGoals}-${awayGoals}`, probability };
      } else if (homeGoals === awayGoals && probability > bestByOutcome.draw.probability) {
        bestByOutcome.draw = { score: `${homeGoals}-${awayGoals}`, probability };
      } else if (awayGoals > homeGoals && probability > bestByOutcome.away.probability) {
        bestByOutcome.away = { score: `${homeGoals}-${awayGoals}`, probability };
      }

      const totalGoals = homeGoals + awayGoals;
      if (totalGoals > 1.5) over15 += probability;
      if (totalGoals > 2.5) over25 += probability;
      if (totalGoals > 3.5) over35 += probability;
      if (homeGoals > 0 && awayGoals > 0) btts += probability;
      if (probability > minMatrixProbability) scoreMatrix[`${homeGoals}-${awayGoals}`] = Number(probability.toFixed(4));
    }
  }

  const totalProb = homeProb + drawProb + awayProb || 1;
  return {
    homeProb: homeProb / totalProb,
    drawProb: drawProb / totalProb,
    awayProb: awayProb / totalProb,
    over15,
    over25,
    over35,
    btts,
    bestScore,
    bestProb,
    bestByOutcome,
    scoreMatrix,
  };
}

export function buildFeatureVector(input, deps) {
  const homeSplit = deps.pickHomeStrength(input.homeRecent);
  const awaySplit = deps.pickAwayStrength(input.awayRecent);
  const homeCompareKey = String(input.homeTeamId || deps.normalizeName(input.homeTeamName || ""));
  const awayCompareKey = String(input.awayTeamId || deps.normalizeName(input.awayTeamName || ""));
  const homePpg = deps.toPointsPerGame(input.homeRecent?.wins, input.homeRecent?.draws, input.homeRecent?.gamesPlayed);
  const awayPpg = deps.toPointsPerGame(input.awayRecent?.wins, input.awayRecent?.draws, input.awayRecent?.gamesPlayed);
  const lineupRatingDiff = Number(
    (Number(input.lineupSummary?.home?.avgRating || 0) - Number(input.lineupSummary?.away?.avgRating || 0)).toFixed(2)
  );
  const homeContinuity = deps.calcLineupContinuity(input.lineupSummary?.home, input.homeInjuries);
  const awayContinuity = deps.calcLineupContinuity(input.lineupSummary?.away, input.awayInjuries);
  const awayTravelPenalty = deps.calcTravelPenalty(input);
  const keeperRatingDiff = deps.calcKeeperEdge(input.lineupSummary);
  const homeLearning = input.homeLearning || {};
  const awayLearning = input.awayLearning || {};
  const homeMarket = input.homeMarketProfile || {};
  const awayMarket = input.awayMarketProfile || {};
  const leagueReliability = input.leagueReliability || {};
  const phaseReliability = input.phaseReliability || {};
  const refereeProfile = input.refereeProfile || {};
  const h2hSampleSize = Math.max(Number(input.h2h?.played || 0), Array.isArray(input.h2h?.results) ? input.h2h.results.length : 0);
  const h2hReliability = h2hSampleSize >= 5 ? 1 : h2hSampleSize >= 3 ? 0.65 : h2hSampleSize >= 2 ? 0.35 : 0;
  const isInternational =
    deps.isSeniorInternationalTournament(input.league) ||
    String(input.phaseBucket || "").toLowerCase() === "interland" ||
    String(input.leagueType || "").toLowerCase() === "international";
  const clubEloScale = isInternational ? 0.35 : 1;
  const homeSquadRating = Number(input.homeTeamProfile?.squadRating || input.homeTeamProfile?.teamStrengthRating || 50);
  const awaySquadRating = Number(input.awayTeamProfile?.squadRating || input.awayTeamProfile?.teamStrengthRating || 50);
  const homeTransferImpact = Number(input.homeTeamProfile?.transferImpact || 0);
  const awayTransferImpact = Number(input.awayTeamProfile?.transferImpact || 0);
  const dbFeatureContext = input.dbFeatureContext || {};
  const dbMatchStats = dbFeatureContext.matchStats || {};
  const dbTeamMatchStats = Array.isArray(dbFeatureContext.teamMatchStats) ? dbFeatureContext.teamMatchStats : [];
  const dbHomeTeamStats = dbTeamMatchStats.find((item) => item.side === "home") || {};
  const dbAwayTeamStats = dbTeamMatchStats.find((item) => item.side === "away") || {};
  const dbHistoricalOdds = dbFeatureContext.historicalOdds || {};
  const dbOddsSamples = Number(dbHistoricalOdds.samples || 0);
  const dbAvgHomeOdds = Number(dbHistoricalOdds.avgHome || 0);
  const dbAvgAwayOdds = Number(dbHistoricalOdds.avgAway || 0);
  const dbHomeImplied = dbAvgHomeOdds > 1.01 ? 1 / dbAvgHomeOdds : 0;
  const dbAwayImplied = dbAvgAwayOdds > 1.01 ? 1 / dbAvgAwayOdds : 0;
  const dbWeather = input.weather || {};
  const dbWeatherRisk =
    dbWeather.riskLevel === "high" || Number(dbWeather.precipitation || 0) >= 4 || Number(dbWeather.windSpeed || 0) >= 45
      ? 2
      : dbWeather.riskLevel === "medium" || Number(dbWeather.precipitation || 0) >= 1 || Number(dbWeather.windSpeed || 0) >= 25
        ? 1
        : 0;

  return {
    home_avg_scored: Number(input.homeRecent?.avgScored || 1.35),
    away_avg_scored: Number(input.awayRecent?.avgScored || 1.35),
    home_avg_conceded: Number(input.homeRecent?.avgConceded || 1.35),
    away_avg_conceded: Number(input.awayRecent?.avgConceded || 1.35),
    home_home_split_scored: Number(homeSplit.avgScored || 1.35),
    home_home_split_conceded: Number(homeSplit.avgConceded || 1.35),
    away_away_split_scored: Number(awaySplit.avgScored || 1.35),
    away_away_split_conceded: Number(awaySplit.avgConceded || 1.35),
    home_ppg: homePpg,
    away_ppg: awayPpg,
    ppg_diff: Number((homePpg - awayPpg).toFixed(2)),
    home_rest_days: Number(input.homeRestDays ?? 0),
    away_rest_days: Number(input.awayRestDays ?? 0),
    rest_diff: Number((Number(input.homeRestDays ?? 0) - Number(input.awayRestDays ?? 0)).toFixed(2)),
    club_elo_diff: Number(((Number(input.homeClubElo || 0) - Number(input.awayClubElo || 0)) * clubEloScale).toFixed(0)),
    raw_club_elo_diff: Number((Number(input.homeClubElo || 0) - Number(input.awayClubElo || 0)).toFixed(0)),
    club_elo_scale: clubEloScale,
    home_squad_rating: Number(homeSquadRating.toFixed(1)),
    away_squad_rating: Number(awaySquadRating.toFixed(1)),
    squad_rating_diff: Number(((homeSquadRating - awaySquadRating) / 10).toFixed(2)),
    home_transfer_impact: Number(homeTransferImpact.toFixed(2)),
    away_transfer_impact: Number(awayTransferImpact.toFixed(2)),
    transfer_impact_diff: Number((homeTransferImpact - awayTransferImpact).toFixed(2)),
    home_injuries: Number(input.homeInjuries?.injuredCount || 0),
    away_injuries: Number(input.awayInjuries?.injuredCount || 0),
    weather_risk: dbWeatherRisk,
    db_weather_temperature: Number(dbWeather.temperature ?? 0),
    db_weather_wind_speed: Number(dbWeather.windSpeed ?? 0),
    db_weather_precipitation: Number(dbWeather.precipitation ?? 0),
    lineups_confirmed: input.lineupSummary?.confirmed ? 1 : 0,
    h2h_sample_size: h2hSampleSize,
    h2h_reliability: h2hReliability,
    h2h_balance:
      input.h2h?.played >= 1
        ? Number(((Number(input.h2h.homeWins || 0) - Number(input.h2h.awayWins || 0)) / Math.max(Number(input.h2h.played || 1), 1)).toFixed(2))
        : 0,
    h2h_recent_5_balance: deps.calculateRecentH2HBalance(input.h2h, homeCompareKey, awayCompareKey),
    recent_h2h_balance:
      input.h2h?.results?.length >= 1
        ? Number(
            (() => {
              const recent5 = (input.h2h.results || []).slice(-5);
              let homeWins = 0;
              let awayWins = 0;
              recent5.forEach((result) => {
                if (String(result.winnerId || "") === homeCompareKey) homeWins += 1;
                else if (String(result.winnerId || "") === awayCompareKey) awayWins += 1;
              });
              return ((homeWins - awayWins) / Math.max(recent5.length, 1)).toFixed(2);
            })()
          )
        : 0,
    match_importance: Number(input.matchImportance || 1),
    home_btts_rate: Number(input.homeRecent?.bttsRate || 0.5),
    away_btts_rate: Number(input.awayRecent?.bttsRate || 0.5),
    home_over25_home: Number(homeSplit.over25Rate || 0.45),
    away_over25_away: Number(awaySplit.over25Rate || 0.45),
    home_yellow_rate: Number(input.homeRecent?.yellowCardRate || 0),
    away_yellow_rate: Number(input.awayRecent?.yellowCardRate || 0),
    home_cards_rate: Number((Number(input.homeRecent?.yellowCardRate || 0) + Number(input.homeRecent?.redCardRate || 0) * 1.8).toFixed(2)),
    away_cards_rate: Number((Number(input.awayRecent?.yellowCardRate || 0) + Number(input.awayRecent?.redCardRate || 0) * 1.8).toFixed(2)),
    home_avg_corners: Number(input.homeSeasonStats?.avgCorners ?? dbMatchStats.homeCorners ?? dbHomeTeamStats.corners ?? 0),
    away_avg_corners: Number(input.awaySeasonStats?.avgCorners ?? dbMatchStats.awayCorners ?? dbAwayTeamStats.corners ?? 0),
    home_avg_shots: Number(input.homeSeasonStats?.avgShots ?? dbMatchStats.homeShots ?? dbHomeTeamStats.shots ?? 0),
    away_avg_shots: Number(input.awaySeasonStats?.avgShots ?? dbMatchStats.awayShots ?? dbAwayTeamStats.shots ?? 0),
    home_avg_shots_against: Number(input.homeSeasonStats?.avgShotsAgainst || 0),
    away_avg_shots_against: Number(input.awaySeasonStats?.avgShotsAgainst || 0),
    home_avg_shots_on_against: Number(input.homeSeasonStats?.avgShotsOnAgainst || 0),
    away_avg_shots_on_against: Number(input.awaySeasonStats?.avgShotsOnAgainst || 0),
    dominance_diff: Number((Number(input.homeSeasonStats?.dominanceScore || 0) - Number(input.awaySeasonStats?.dominanceScore || 0)).toFixed(2)),
    set_piece_diff: Number((Number(input.homeTeamProfile?.setPieceScore || 0) - Number(input.awayTeamProfile?.setPieceScore || 0)).toFixed(2)),
    home_learning_outcome_hit: Number(homeLearning.outcomeHitRate || 0.5),
    away_learning_outcome_hit: Number(awayLearning.outcomeHitRate || 0.5),
    home_learning_goal_bias: Number(homeLearning.homeGoalBias || 0),
    away_learning_goal_bias: Number(awayLearning.awayGoalBias || 0),
    learning_outcome_bias_diff: Number((Number(homeLearning.homeOutcomeBias || 0) - Number(awayLearning.awayOutcomeBias || 0)).toFixed(2)),
    home_db_xg: Number(dbMatchStats.homeXg ?? dbHomeTeamStats.xg ?? 0),
    away_db_xg: Number(dbMatchStats.awayXg ?? dbAwayTeamStats.xg ?? 0),
    db_historical_odds_samples: dbOddsSamples,
    db_historical_home_implied: Number(dbHomeImplied.toFixed(4)),
    db_historical_away_implied: Number(dbAwayImplied.toFixed(4)),
    home_market_implied_ppg: Number(homeMarket.homeImpliedPpg || homeMarket.homeActualPpg || (dbHomeImplied ? dbHomeImplied * 3 : 1.25)),
    away_market_implied_ppg: Number(awayMarket.awayImpliedPpg || awayMarket.awayActualPpg || (dbAwayImplied ? dbAwayImplied * 3 : 1.25)),
    market_overperformance_diff: Number((Number(homeMarket.homeOverperformance || 0) - Number(awayMarket.awayOverperformance || 0)).toFixed(2)),
    market_strength: Number(input.marketCalibration?.strength || 0),
    league_reliability: Number(leagueReliability.reliabilityScore || 0.5),
    league_avg_goal_error: Number(leagueReliability.avgGoalError || 2),
    phase_reliability: Number(phaseReliability.reliabilityScore || 0.5),
    phase_avg_goal_error: Number(phaseReliability.avgGoalError || 2),
    referee_cards_trend: Number(refereeProfile.cardsTrend || 0),
    referee_penalty_rate: Number(refereeProfile.estimatedPenaltyRate || 0),
    lineups_avg_rating_diff: lineupRatingDiff,
    home_lineup_continuity: homeContinuity,
    away_lineup_continuity: awayContinuity,
    keeper_rating_diff: keeperRatingDiff,
    away_travel_penalty: awayTravelPenalty,
  };
}

export function scoreDataCompleteness(input, edges = {}, deps) {
  const reasons = [];
  const missing = [];
  const add = (condition, weight, goodReason, missingReason, partial = 0) => {
    if (condition) {
      reasons.push(goodReason);
      return weight;
    }
    if (partial > 0) {
      reasons.push(`${missingReason} deels`);
      return weight * partial;
    }
    missing.push(missingReason);
    return 0;
  };

  const h2hPlayed = Math.max(Number(input?.h2h?.played || 0), Array.isArray(input?.h2h?.results) ? input.h2h.results.length : 0);
  const homeFormGames = Number(input?.homeRecent?.gamesPlayed || 0);
  const awayFormGames = Number(input?.awayRecent?.gamesPlayed || 0);
  const homeSources = input?.homeSeasonStats?.externalSources || [];
  const awaySources = input?.awaySeasonStats?.externalSources || [];
  const hasXg =
    input?.homeSeasonStats?.xG != null ||
    input?.awaySeasonStats?.xG != null ||
    homeSources.includes("Understat") ||
    awaySources.includes("Understat");
  const marketCalibration = edges.marketCalibration || input?.marketCalibration || {};
  const bookmakerSignals = Array.isArray(marketCalibration.bookmakerSignals) ? marketCalibration.bookmakerSignals : [];
  const marketCoverage = Number(marketCalibration.closingCoverage || 0);
  const hasOdds = bookmakerSignals.length > 0 || marketCoverage >= 0.15;
  const hasStanding = Number(input?.homeStandingPos || input?.homePos || 0) > 0 && Number(input?.awayStandingPos || input?.awayPos || 0) > 0;
  const hasTeamIds = !!input?.homeTeamId && !!input?.awayTeamId;
  const hasStableTeamIdentity =
    hasTeamIds ||
    !!(input?.teamIdentity?.home?.key && input?.teamIdentity?.away?.key) ||
    !!(deps.normalizeName(input?.homeTeamName || input?.homeTeam) && deps.normalizeName(input?.awayTeamName || input?.awayTeam));
  const sourceQuality = Math.max(Number(input?.homeSeasonStats?.sourceQuality || 0), Number(input?.awaySeasonStats?.sourceQuality || 0));
  const lineupsKnown = !!input?.lineupSummary?.confirmed;
  const lineupsProjected = !!input?.lineupSummary?.projected;
  const postMatchCoverage = Number(input?.postMatchStats?.coverageScore || 0);
  const postMatchPresent = Number(postMatchCoverage || 0) > 0;

  const score =
    add(h2hPlayed >= 3, 0.16, "H2H gevuld", "H2H ontbreekt", h2hPlayed >= 1 ? 0.45 : 0) +
    add(homeFormGames >= 5 && awayFormGames >= 5, 0.16, "vormdata gevuld", "vormdata dun", homeFormGames >= 3 && awayFormGames >= 3 ? 0.65 : 0) +
    add(hasStanding, 0.12, "stand/positie gevuld", "stand/positie ontbreekt") +
    add(hasTeamIds, 0.1, "team-id match aanwezig", "team-id match ontbreekt", hasStableTeamIdentity ? 0.55 : 0) +
    add(hasXg || sourceQuality >= 0.45, 0.18, "xG/shot-bronnen aanwezig", "xG/shot-bronnen dun", sourceQuality >= 0.25 ? 0.55 : 0) +
    add(hasOdds, 0.14, "odds/marktdekking aanwezig", "odds/marktdekking dun", marketCoverage > 0 ? 0.45 : 0) +
    add(lineupsKnown, 0.06, "opstellingsdata bevestigd", "opstellingsdata open", lineupsProjected ? 0.7 : 0.35) +
    add(edges.resultFresh !== false, 0.08, "uitslagbron actueel", "uitslagbron verouderd", edges.resultFresh == null ? 0.65 : 0) +
    add(postMatchPresent, 0.06, "post-match stats verrijkt", "post-match stats ontbreken", 0);

  const normalized = deps.clamp(score, 0, 1);
  const label = normalized >= 0.75 ? "hoog" : normalized >= 0.58 ? "voldoende" : normalized >= 0.42 ? "laag" : "kritiek";
  return {
    score: Number(normalized.toFixed(3)),
    percent: Math.round(normalized * 100),
    label,
    reasons: reasons.slice(0, 6),
    missing: missing.slice(0, 6),
  };
}

export function buildFeatureImportance(featureVector = {}, modelEdges = {}) {
  const candidates = [
    { key: "ppg_diff", value: Math.abs(Number(featureVector.ppg_diff || 0)), label: "vorm/points-per-game verschil" },
    { key: "club_elo_diff", value: Math.abs(Number(featureVector.club_elo_diff || 0) / 100), label: "ClubElo verschil" },
    { key: "h2h_recent_5_balance", value: Math.abs(Number(featureVector.h2h_recent_5_balance || 0) * 10), label: "recente H2H balans" },
    { key: "lineups_avg_rating_diff", value: Math.abs(Number(featureVector.lineups_avg_rating_diff || 0)), label: "opstelling ratingverschil" },
    { key: "keeper_rating_diff", value: Math.abs(Number(featureVector.keeper_rating_diff || 0)), label: "keeper edge" },
    { key: "market_overperformance_diff", value: Math.abs(Number(featureVector.market_overperformance_diff || 0) * 10), label: "markt-overperformance" },
    { key: "away_travel_penalty", value: Math.abs(Number(featureVector.away_travel_penalty || 0) * 10), label: "reisbelasting uitteam" },
    { key: "source_reliability", value: Math.abs(Number(modelEdges?.sourceReliability?.score || 0) * 10), label: "bronbetrouwbaarheid" },
    { key: "data_completeness", value: Math.abs(Number(modelEdges?.dataCompleteness?.score || 0) * 10), label: "datacompleteness" },
  ];
  return candidates
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)
    .map((item) => ({
      key: item.key,
      label: item.label,
      score: Number(item.value.toFixed(3)),
    }));
}

export function sourceReliabilityScore(input, dataCompleteness, deps) {
  const h2hPlayed = Number(input?.h2h?.played || 0);
  const h2hQuality = h2hPlayed >= 5 ? 1 : h2hPlayed >= 3 ? 0.72 : h2hPlayed >= 1 ? 0.38 : 0.15;
  const sourceQuality = Math.max(Number(input?.homeSeasonStats?.sourceQuality || 0), Number(input?.awaySeasonStats?.sourceQuality || 0), 0);
  const hasLineups = input?.lineupSummary?.confirmed ? 1 : input?.lineupSummary?.projected ? 0.65 : 0.45;
  const marketCoverage = Number(input?.marketCalibration?.closingCoverage || 0);
  const postMatchCoverage = Number(input?.postMatchStats?.coverageScore || 0);
  const completeness = Number(dataCompleteness?.score || 0);
  const reliability = deps.clamp(
    completeness * 0.36 +
      sourceQuality * 0.22 +
      h2hQuality * 0.16 +
      hasLineups * 0.12 +
      deps.clamp(marketCoverage, 0, 1) * 0.1 +
      deps.clamp(postMatchCoverage, 0, 1) * 0.04,
    0,
    1
  );
  const blendWeight = deps.clamp(0.55 + reliability * 0.45, 0.55, 1);
  return {
    score: Number(reliability.toFixed(3)),
    blendWeight: Number(blendWeight.toFixed(3)),
    penalty: Number((1 - reliability).toFixed(3)),
    label: reliability >= 0.72 ? "strong" : reliability >= 0.54 ? "moderate" : reliability >= 0.4 ? "weak" : "critical",
  };
}

export function qualityGateForCompleteness(dataCompleteness) {
  const score = Number(dataCompleteness?.score || 0);
  const modelReady = score >= 0.6;
  const confidenceCap = score < 0.35 ? 0.4 : score < 0.5 ? 0.52 : score < 0.6 ? 0.62 : score < 0.7 ? 0.74 : 0.93;
  const penalty = score < 0.35 ? 0.16 : score < 0.5 ? 0.1 : score < 0.6 ? 0.06 : score < 0.7 ? 0.025 : 0;
  return {
    blockedHighConfidence: score < 0.7,
    modelReady,
    confidenceCap,
    penalty,
    summary:
      score < 0.35
        ? "kwaliteitsgate blokkeert hoge zekerheid: cruciale data ontbreekt"
        : score < 0.5
          ? "kwaliteitsgate verlaagt confidence: brondata is dun"
          : score < 0.6
            ? "kwaliteitsgate beperkt confidence: niet alle kernbronnen zijn gevuld"
            : score < 0.7
              ? "kwaliteitsgate voorzichtig: model-ready maar nog niet topkwaliteit"
              : "kwaliteitsgate akkoord",
  };
}

export function buildRiskProfile({ confidence, agreement, weatherRisk, lineupConfirmed, lineupProjected, injuriesTotal, awayTravelPenalty, keeperDiff }) {
  let score = 0;
  if (confidence < 0.48) score += 2;
  else if (confidence < 0.6) score += 1;

  if (agreement < 0.65) score += 2;
  else if (agreement < 0.78) score += 1;

  if (weatherRisk === "medium") score += 1;
  if (weatherRisk === "high") score += 2;
  if (!lineupConfirmed && !lineupProjected) score += 1;
  if (injuriesTotal >= 4) score += 1;
  if (awayTravelPenalty >= 0.2) score += 1;
  if (Math.abs(Number(keeperDiff || 0)) >= 0.35) score -= 1;

  if (score >= 5) return "hoog";
  if (score >= 3) return "middel";
  return "laag";
}
