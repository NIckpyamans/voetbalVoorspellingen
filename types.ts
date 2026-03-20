// ============================================================================
// COMPLETE TYPES VOOR VOORSPELLINGENPRIVE
// Alle mogelijke velden voor wedstrijden en voorspellingen
// ============================================================================

export interface Match {
  // ========================================
  // BASIS WEDSTRIJD INFORMATIE
  // ========================================
  id: string;
  date: string;
  kickoff?: string;
  league: string;
  
  // ========================================
  // TEAM INFORMATIE
  // ========================================
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeLogo: string;
  awayLogo: string;
  
  // ========================================
  // WEDSTRIJD STATUS & SCORE
  // ========================================
  status: string;
  score?: string;
  minute?: string;
  minuteValue?: number;
  period?: string;
  extraTime?: number;
  liveUpdatedAt?: number;
  
  // ========================================
  // VORM & RANKINGS
  // ========================================
  homeForm?: string;
  awayForm?: string;
  homeElo?: number;
  awayElo?: number;
  homeClubElo?: number;
  awayClubElo?: number;
  homePos?: number;
  awayPos?: number;
  
  // ========================================
  // WEDSTRIJD CONTEXT & BELANG
  // ========================================
  matchImportance?: number;
  roundLabel?: string;
  context?: {
    summary?: string;
    type?: string;
    importance?: string;
  };
  
  // ========================================
  // HEAD-TO-HEAD & AGGREGATE
  // ========================================
  h2h?: {
    played: number;
    homeWins: number;
    draws: number;
    awayWins: number;
    avgGoals?: number;
    lastMatches?: Array<{
      date: string;
      score: string;
      winner: string;
    }>;
  };
  h2hStatus?: string;
  aggregate?: {
    active: boolean;
    firstLegScore?: string;
    aggregateScore?: string;
    homeAdvantage?: boolean;
  };
  
  // ========================================
  // SEIZOEN STATISTIEKEN
  // ========================================
  homeSeasonStats?: {
    gamesPlayed?: number;
    wins?: number;
    draws?: number;
    losses?: number;
    goalsScored?: number;
    goalsConceded?: number;
    cleanSheets?: number;
    shotsOnTarget?: number;
    shotsOnTargetAgainst?: number;
    possession?: number;
    corners?: number;
    cornersAgainst?: number;
    xG?: number;
    xGAgainst?: number;
    bigChancesCreated?: number;
    bigChancesMissed?: number;
    penaltiesScored?: number;
    penaltiesMissed?: number;
  };
  awaySeasonStats?: {
    gamesPlayed?: number;
    wins?: number;
    draws?: number;
    losses?: number;
    goalsScored?: number;
    goalsConceded?: number;
    cleanSheets?: number;
    shotsOnTarget?: number;
    shotsOnTargetAgainst?: number;
    possession?: number;
    corners?: number;
    cornersAgainst?: number;
    xG?: number;
    xGAgainst?: number;
    bigChancesCreated?: number;
    bigChancesMissed?: number;
    penaltiesScored?: number;
    penaltiesMissed?: number;
  };
  
  // ========================================
  // RECENTE VORM & MOMENTUM
  // ========================================
  homeRecent?: {
    form?: string;
    recentMatches?: Array<{
      venue: string;
      result: string;
      score: string;
      opponent?: string;
      date?: string;
    }>;
    splits?: {
      home?: {
        avgScored: number;
        avgConceded: number;
        winRate: number;
      };
      away?: {
        avgScored: number;
        avgConceded: number;
        winRate: number;
      };
    };
    strongestSide?: "home" | "away" | "balanced";
    yellowCardRate?: number;
    redCardRate?: number;
    momentum?: number;
    formTrend?: "improving" | "declining" | "stable";
  };
  awayRecent?: {
    form?: string;
    recentMatches?: Array<{
      venue: string;
      result: string;
      score: string;
      opponent?: string;
      date?: string;
    }>;
    splits?: {
      home?: {
        avgScored: number;
        avgConceded: number;
        winRate: number;
      };
      away?: {
        avgScored: number;
        avgConceded: number;
        winRate: number;
      };
    };
    strongestSide?: "home" | "away" | "balanced";
    yellowCardRate?: number;
    redCardRate?: number;
    momentum?: number;
    formTrend?: "improving" | "declining" | "stable";
  };
  
  // ========================================
  // BLESSURES & OPSTELLINGEN
  // ========================================
  homeInjuries?: {
    injuredCount: number;
    keyPlayers?: string[];
    suspendedCount?: number;
    suspendedPlayers?: string[];
    doubtsCount?: number;
  };
  awayInjuries?: {
    injuredCount: number;
    keyPlayers?: string[];
    suspendedCount?: number;
    suspendedPlayers?: string[];
    doubtsCount?: number;
  };
  lineupSummary?: {
    confirmed: boolean;
    homeContinuity?: number;
    awayContinuity?: number;
    homeFormation?: string;
    awayFormation?: string;
    homeChanges?: number;
    awayChanges?: number;
  };
  
  // ========================================
  // WEDSTRIJD OMSTANDIGHEDEN
  // ========================================
  homeRestDays?: number;
  awayRestDays?: number;
  weather?: {
    temperature?: number;
    windSpeed?: number;
    precipitationProbability?: number;
    conditions?: string;
    riskLevel?: "low" | "medium" | "high";
  };
  venue?: {
    name?: string;
    city?: string;
    capacity?: number;
    attendance?: number;
    surface?: string;
  };
  
  // ========================================
  // GOAL TIMING & PATTERNS
  // ========================================
  homeGoalTiming?: {
    first15?: number;
    min16to30?: number;
    min31to45?: number;
    min46to60?: number;
    min61to75?: number;
    min76to90?: number;
  };
  awayGoalTiming?: {
    first15?: number;
    min16to30?: number;
    min31to45?: number;
    min46to60?: number;
    min61to75?: number;
    min76to90?: number;
  };
  
  // ========================================
  // LIVE WEDSTRIJD STATISTIEKEN
  // ========================================
  liveStats?: {
    possession?: {
      home: number;
      away: number;
    };
    shots?: {
      home: number;
      away: number;
    };
    shotsOnTarget?: {
      home: number;
      away: number;
    };
    corners?: {
      home: number;
      away: number;
    };
    fouls?: {
      home: number;
      away: number;
    };
    yellowCards?: {
      home: number;
      away: number;
    };
    redCards?: {
      home: number;
      away: number;
    };
    offsides?: {
      home: number;
      away: number;
    };
    xG?: {
      home: number;
      away: number;
    };
    dangerousAttacks?: {
      home: number;
      away: number;
    };
  };
  
  // ========================================
  // TEAM PROFIELEN & TACTIEKEN
  // ========================================
  homeTeamProfile?: {
    setPieceScore?: number;
    cornersTrend?: string;
    defensiveShape?: string;
    attackingStyle?: string;
    pressureIntensity?: number;
    buildUpSpeed?: "slow" | "medium" | "fast";
    widthPreference?: "narrow" | "balanced" | "wide";
    aerialStrength?: number;
  };
  awayTeamProfile?: {
    setPieceScore?: number;
    cornersTrend?: string;
    defensiveShape?: string;
    attackingStyle?: string;
    pressureIntensity?: number;
    buildUpSpeed?: "slow" | "medium" | "fast";
    widthPreference?: "narrow" | "balanced" | "wide";
    aerialStrength?: number;
  };
  
  // ========================================
  // SCHEIDSRECHTER & OFFICIALS
  // ========================================
  referee?: {
    name?: string;
    avgCardsPerGame?: number;
    avgYellowCards?: number;
    avgRedCards?: number;
    avgPenaltiesPerGame?: number;
    strictnessLevel?: "lenient" | "medium" | "strict";
    homeAdvantage?: number;
  };
  
  // ========================================
  // MODEL EDGES & ADVANCED ANALYTICS
  // ========================================
  modelEdges?: {
    clubEloDiff?: number;
    riskProfile?: "low" | "medium" | "high";
    modelAgreement?: number;
    tacticalMismatch?: {
      summary?: string;
      advantage?: "home" | "away" | "neutral";
      score?: number;
    };
    formShift?: {
      summary?: string;
      homeShift?: number;
      awayShift?: number;
    };
    travelEdge?: {
      summary?: string;
      distance?: number;
      impact?: number;
    };
    keeperEdge?: {
      summary?: string;
      homeRating?: number;
      awayRating?: number;
    };
    lineupImpact?: {
      summary?: string;
      homeContinuity?: number;
      awayContinuity?: number;
      homeImpact?: number;
      awayImpact?: number;
    };
    motivationEdge?: {
      summary?: string;
      homeMotivation?: number;
      awayMotivation?: number;
    };
  };
  
  // ========================================
  // MACHINE LEARNING FEATURES
  // ========================================
  featureVector?: {
    [key: string]: number;
  };
  ensembleMeta?: {
    active: boolean;
    baseModel?: string;
    blendModel?: string;
    confidence?: number;
    modelWeights?: {
      [key: string]: number;
    };
  };
  
  // ========================================
  // BETTING & MARKET DATA (OPTIONEEL)
  // ========================================
  odds?: {
    homeWin?: number;
    draw?: number;
    awayWin?: number;
    over25?: number;
    under25?: number;
    btts?: number;
    source?: string;
    lastUpdated?: number;
  };
  marketMovement?: {
    homeWinTrend?: "rising" | "falling" | "stable";
    volumeIndicator?: number;
  };
  
  // ========================================
  // EXTRA METADATA
  // ========================================
  coverage?: {
    liveScore?: boolean;
    liveStats?: boolean;
    lineups?: boolean;
    incidents?: boolean;
  };
  importance?: {
    league?: number;
    teams?: number;
    overall?: number;
  };
}

// ============================================================================
// PREDICTION INTERFACE
// ============================================================================

export interface Prediction {
  matchId: string;
  
  // Basis voorspellingen
  predHomeGoals: number;
  predAwayGoals: number;
  homeProb: number;
  drawProb: number;
  awayProb: number;
  
  // Expected Goals
  homeXG: number;
  awayXG: number;
  
  // Over/Under & BTTS
  over05?: number;
  over15?: number;
  over25?: number;
  over35?: number;
  under05?: number;
  under15?: number;
  under25?: number;
  under35?: number;
  btts?: number;
  
  // Exacte scores
  exactProb?: number;
  topScores?: Array<{
    score: string;
    probability: number;
  }>;
  
  // Confidence & edges
  confidence?: number;
  edgeScore?: number;
  valueRating?: number;
  
  // Model info
  model?: string;
  modelVersion?: string;
  timestamp?: number;
  
  // Inherited van match (voor convenience)
  homeForm?: string;
  awayForm?: string;
  homeClubElo?: number;
  awayClubElo?: number;
  h2h?: any;
  h2hStatus?: string;
  aggregate?: any;
  context?: any;
  homePos?: number;
  awayPos?: number;
  matchImportance?: number;
  homeRestDays?: number;
  awayRestDays?: number;
  weather?: any;
  lineupSummary?: any;
  modelEdges?: any;
  homeTeamProfile?: any;
  awayTeamProfile?: any;
  featureVector?: any;
  ensembleMeta?: any;
}

// ============================================================================
// STANDINGS INTERFACE
// ============================================================================

export interface StandingsRow {
  pos: number;
  teamId: string;
  teamName: string;
  teamLogo?: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  form?: string;
  homeRecord?: {
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goalsFor: number;
    goalsAgainst: number;
  };
  awayRecord?: {
    played: number;
    won: number;
    drawn: number;
    lost: number;
    goalsFor: number;
    goalsAgainst: number;
  };
}

export interface LeagueStandings {
  league: string;
  season: string;
  lastUpdated?: number;
  rows: StandingsRow[];
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface MatchesResponse {
  matches: Match[];
  lastRun: number | null;
  source?: string;
  timestamp?: number;
}

export interface PredictionsResponse {
  predictions: Prediction[];
  model?: string;
  timestamp?: number;
}

export interface StandingsResponse {
  standings: {
    [leagueId: string]: LeagueStandings;
  };
}

// ============================================================================
// FILTER & DISPLAY TYPES
// ============================================================================

export type FilterMode = "alle" | "favorieten" | "live" | "gepland" | "gespeeld";
export type View = "dashboard" | "history" | "standings" | "settings";

export interface BestBet {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  predHomeGoals: number;
  predAwayGoals: number;
  homeProb: number;
  drawProb: number;
  awayProb: number;
  exactProb?: number;
  confidence?: number;
  tip?: string;
  edgeScore?: number;
}

// ============================================================================
// ANALYSIS TYPES
// ============================================================================

export interface MatchAnalysis {
  matchId: string;
  analysis: string;
  engine: "ollama-local" | "claude-api" | "template-free";
  confidence?: number;
  keyFactors?: string[];
  timestamp?: number;
}
