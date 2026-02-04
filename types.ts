
// We now ingest matches directly from the internet (SofaScore public endpoints).
// That means we can see many different competitions, so league is a free-form string.
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
}

export interface Match {
  id: string;
  // ISO date (YYYY-MM-DD) of the fixture (local time is derived from kickoff)
  date: string;
  // ISO datetime string
  kickoff: string;
  league: League;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeLogo: string;
  awayLogo: string;
  status?: string;
  minute?: string; // live minute (e.g. "74'")
  score?: string;
  h2h?: string;
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
