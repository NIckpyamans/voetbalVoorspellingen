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
  splits?: {
    home?: MatchSplitStats;
    away?: MatchSplitStats;
  };
  lastMatchKickoff?: string | null;
  goalTiming?: any;
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
  h2h?: any;
  homeForm?: string;
  awayForm?: string;
  keyInjuries?: string;
  topScorers?: string;
  context?: string;
  lineups?: {
    home: string[];
    away: string[];
  };
  events?: string[];
  homePos?: number | null;
  awayPos?: number | null;
  homeElo?: number;
  awayElo?: number;
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
  homeForm?: string;
  awayForm?: string;
  over05?: number;
  over15?: number;
  over25?: number;
  over35?: number;
  btts?: number;
  scoreMatrix?: Record<string, number>;
  h2h?: any;
  matchImportance?: number;
  homeFalsePositive?: boolean;
  awayFalsePositive?: boolean;
  homeRestDays?: number | null;
  awayRestDays?: number | null;
  weather?: MatchWeather | null;
  lineupSummary?: MatchLineupSummary | null;
  modelEdges?: any;
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
