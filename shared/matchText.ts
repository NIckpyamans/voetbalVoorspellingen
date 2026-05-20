export function cleanSignalText(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";

  const lower = text.toLowerCase();
  if (lower.includes("tweeluik") && lower.includes("knock")) return "tweeluik - knock-out";

  return text
    .replace(/[\u00c2\u00b7]+/g, " - ")
    .replace(/\u00c3[\u00ab\u00a9\u00a8\u00b6]/g, "")
    .replace(/[^\x20-\x7E\u00C0-\u017F]/g, "")
    .replace(/\s+-\s+/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

export function shortLeagueName(league: string) {
  const parts = String(league || "").split(" - ");
  return parts.length >= 2 ? `${parts[0]} - ${parts[1]}` : league;
}
