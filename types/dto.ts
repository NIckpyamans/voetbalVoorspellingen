import type { LeagueStandings, Match, Prediction } from "../types";

export type MatchDto = Match;
export type PredictionDto = Prediction;

export interface ReviewDto {
  matchId: string;
  prediction: string;
  actual: string;
  wasCorrect: boolean;
  winnerCorrect?: boolean;
  errorMargin?: number;
  timestamp?: number;
  league?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
}

export interface StandingsDto {
  ok: boolean;
  standings: Record<string, LeagueStandings>;
  source?: string;
  lastRun?: number | null;
  error?: string;
}

export interface HistoryDto {
  ok: boolean;
  items: ReviewDto[];
  total: number;
  source?: string;
  error?: string;
}
