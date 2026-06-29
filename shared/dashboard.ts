import type { Match } from "../types";
import { todayAmsterdamKey, toAmsterdamDateKey } from "./date.js";
import { shortLeagueName } from "./matchText.js";

export type DashboardHistoryItem = {
  matchId: string;
  prediction: string;
  actual: string;
  wasCorrect: boolean;
  winnerCorrect?: boolean;
  errorMargin?: number;
  timestamp?: number;
  homeTeam?: string | null;
  awayTeam?: string | null;
  league?: string | null;
  predictedOutcome?: string | null;
  actualOutcome?: string | null;
  bestBetRank?: number | null;
  topExactScorePick?: boolean;
  exactScoreConfidence?: number;
};

export const LEAGUE_ORDER = [
  "Europe - Champions League",
  "Europe - Europa League",
  "Europe - Conference League",
  "England - Premier League",
  "England - Championship",
  "Netherlands - Eredivisie",
  "Netherlands - Eerste Divisie",
  "Netherlands - KNVB Beker",
  "Germany - Bundesliga",
  "Germany - 2. Bundesliga",
  "Spain - LaLiga",
  "Spain - LaLiga 2",
  "Italy - Serie A",
  "Italy - Serie B",
  "France - Ligue 1",
  "France - Ligue 2",
  "Portugal - Liga Portugal",
  "Portugal - Liga Portugal 2",
  "Belgium - Pro League",
  "Belgium - Challenger Pro League",
];

export const FAVORITE_STANDING_KEY = "footyai-favorite-standing";
export const DEFAULT_FAVORITE_STANDING_LABEL = "Netherlands - Eredivisie";

export function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function isoDate(date: Date) {
  return toAmsterdamDateKey(date) || todayAmsterdamKey();
}

export function formatDateLabel(dateISO: string) {
  return new Date(`${dateISO}T12:00:00`).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatAmsterdamDate(date: Date) {
  return toAmsterdamDateKey(date) || isoDate(date);
}

export function belongsToSelectedDate(match: Match, dateISO: string) {
  if (String(match.date || "") === dateISO) return true;

  if (match.kickoff) {
    const parsed = new Date(match.kickoff);
    if (!Number.isNaN(parsed.getTime())) return formatAmsterdamDate(parsed) === dateISO;
  }

  return false;
}

export function shortLeague(league: string) {
  return shortLeagueName(league);
}

export function readFavoriteStandingLabel() {
  try {
    return localStorage.getItem(FAVORITE_STANDING_KEY) || DEFAULT_FAVORITE_STANDING_LABEL;
  } catch {
    return DEFAULT_FAVORITE_STANDING_LABEL;
  }
}

export function getStandingLabel(table: any, key: string) {
  return String(table?.label || key || "");
}

export function outcomeFromScore(score?: string | null) {
  const [home, away] = String(score || "").split("-").map(Number);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (home > away) return "Thuis";
  if (away > home) return "Uit";
  return "Gelijk";
}

export function hydrateDashboardHistory(items: DashboardHistoryItem[]) {
  return items.map((item) => {
    const predictedOutcome = item.predictedOutcome || outcomeFromScore(item.prediction);
    const actualOutcome = item.actualOutcome || outcomeFromScore(item.actual);
    return {
      ...item,
      predictedOutcome,
      actualOutcome,
      winnerCorrect: typeof item.winnerCorrect === "boolean" ? item.winnerCorrect : predictedOutcome === actualOutcome,
      wasCorrect: String(item.prediction || "").trim() === String(item.actual || "").trim(),
    };
  });
}

export function mergeDashboardHistory(localItems: DashboardHistoryItem[], serverItems: DashboardHistoryItem[]) {
  const merged = new Map<string, DashboardHistoryItem>();
  for (const item of [...serverItems, ...localItems]) {
    if (!item?.matchId) continue;
    const current = merged.get(item.matchId);
    if (!current || Number(item.timestamp || 0) >= Number(current.timestamp || 0)) {
      merged.set(item.matchId, item);
    }
  }
  return [...merged.values()].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}
