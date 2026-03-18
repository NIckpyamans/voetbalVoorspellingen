export type League = string;

export interface Team {
  id: string;
  name: string;
  league: League;
  elo: number;
  attack: number;
  defense: number;
  logo: string;
  form?: string;
  [key: string]: any;
}

export interface MatchLineupTeamSummary {
  formation?: string | null;
  starters?: number;
  bench?: number;
  avgRating?: number | null;
  confirmed?: boolean;
}

export interface MatchLineupSummary {
  home?: MatchLineupTeamSummary | null;
  away?: MatchLineupTeamSummary | null;
  confirmed?: boolean;
}

export interface MatchWeather {
  temperature?: number | null;
  precipitationProbability?: number | null;
  precipitation?: number | null;
  windSpeed?: number | null;
  riskLevel?: "low" | "medium" | "high" | null;
}

export interface MatchSplitStats {
  games: number;
  avgScored: number;
  avgConceded: number;
  bttsRate: number;
  wins: number;
  draws: number;
  losses: number;
  scoredTotal?: number;
  concededTotal?: number;
}

export interface RecentMatchItem {
  date?: string | null;
  league?: string | null;
  venue?: "H" | "A";
  opponent?: string;
  score?: string | null;
  goalsFor?: number | null;
  goalsAgainst?: number | null;
  result?: "W" | "D" | "L";
}

export interface MatchRecentStats {
  form?: string;
  avgScored?: number;
  avgConceded?: number;
  bttsRate?: number;
  gamesPlayed?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  strongestSide?: "home" | "away" | "balanced" | string;
  splits?: {
    home?: MatchSplitStats;
    away?: MatchSplitStats;
  };
  recentMatches?: RecentMatchItem[];
  lastMatchKickoff?: string | null;
  goalTiming?: any;
}

export interface H2HResult {
  eventId?: string | number;
  date?: string | null;
  homeTeamId?: string;
  awayTeamId?: string;
  home?: string;
  away?: string;
  score?: string;
  winnerId?: string;
}

export interface MatchAggregateInfo {
  active?: boolean;
  firstLegScore?: string | null;
  firstLegText?: string | null;
  aggregateScore?: string | null;
  homeAggregate?: number;
  awayAggregate?: number;
  currentHomeGoals?: number;
  currentAwayGoals?: number;
  leader?: string | null;
  roundLabel?: string | number | null;
  note?: string | null;
}

export interface MatchContext {
  homeZone?: string | null;
  awayZone?: string | null;
  rivalry?: string | null;
  summary?: string | null;
  stakes?: string | null;
}

export interface Match {
  id: string;
  date: string;
  kickoff: string;
  league: League;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeLogo: string;
  awayLogo: string;
  status?: string;
  minute?: string;
  minuteValue?: number;
  extraTime?: number | null;
  period?: string | null;
  liveUpdatedAt?: number | null;
  score?: string;
  h2h?: {
    played?: number;
    homeWins?: number;
    draws?: number;
    awayWins?: number;
    status?: string;
    results?: H2HResult[];
  } | null;
  h2hStatus?: string;
  aggregate?: MatchAggregateInfo | null;
  context?: MatchContext | null;
  roundLabel?: string | number | null;
  homeForm?: string;
  awayForm?: string;
  homePos?: number | null;
  awayPos?: number | null;
  homeElo?: number;
  awayElo?: number;
  homeClubElo?: number | null;
  awayClubElo?: number | null;
  homeSeasonStats?: any;
  awaySeasonStats?: any;
  homeInjuries?: any;
  awayInjuries?: any;
  homeGoalTiming?: any;
  awayGoalTiming?: any;
  liveStats?: any;
  matchImportance?: number;
  homeRecent?: MatchRecentStats;
  awayRecent?: MatchRecentStats;
  homeRestDays?: number | null;
  awayRestDays?: number | null;
  weather?: MatchWeather | null;
  lineupSummary?: MatchLineupSummary | null;
  modelEdges?: any;
  [key: string]: any;
}

export interface Prediction {
  matchId: string;
  homeProb: number;
  drawProb: number;
  awayProb: number;
  homeXG: number;
  awayXG: number;
  predHomeGoals: number;
  predAwayGoals: number;
  exactProb: number;
  confidence: number;
  analysis?: string;
  learningNote?: string;
  homeElo?: number;
  awayElo?: number;
  homeClubElo?: number | null;
  awayClubElo?: number | null;
  homeForm?: string;
  awayForm?: string;
  over05?: number;
  over15?: number;
  over25?: number;
  over35?: number;
  btts?: number;
  scoreMatrix?: Record<string, number>;
  h2h?: any;
  h2hStatus?: string;
  aggregate?: MatchAggregateInfo | null;
  context?: MatchContext | null;
  matchImportance?: number;
  homeFalsePositive?: boolean;
  awayFalsePositive?: boolean;
  homeRestDays?: number | null;
  awayRestDays?: number | null;
  weather?: MatchWeather | null;
  lineupSummary?: MatchLineupSummary | null;
  modelEdges?: any;
  derivedOdds?: any;
  valueFlags?: any;
  [key: string]: any;
}

export interface PredictionMemory {
  matchId: string;
  prediction: string;
  actual: string;
  wasCorrect: boolean;
  errorMargin: number;
  timestamp: number;
}

export interface BestBet extends Prediction {
  homeTeam: string;
  awayTeam: string;
  league: League;
}
