export type ScoreOutcome = "H" | "D" | "A";

export function scoreOutcome(score: string | null | undefined): ScoreOutcome | null {
  const match = String(score || "").trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return null;
  const home = Number(match[1]);
  const away = Number(match[2]);
  if (home > away) return "H";
  if (away > home) return "A";
  return "D";
}
