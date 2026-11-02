export type ScoreOutcome = "H" | "D" | "A";

export function parseScoreline(score: string | null | undefined): { home: number; away: number } | null {
  const match = String(score ?? "").trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return null;
  const home = Number(match[1]);
  const away = Number(match[2]);
  if (!Number.isSafeInteger(home) || !Number.isSafeInteger(away)) return null;
  return { home, away };
}

export function scoreOutcome(score: string | null | undefined): ScoreOutcome | null {
  const parsed = parseScoreline(score);
  if (!parsed) return null;
  if (parsed.home > parsed.away) return "H";
  if (parsed.away > parsed.home) return "A";
  return "D";
}
