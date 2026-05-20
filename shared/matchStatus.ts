import type { Match } from "../types";

export type MatchStatusKind = "scheduled" | "live" | "halftime" | "finished" | "pending";

export function getMatchStatusKind(match: Pick<Match, "status" | "minuteValue"> | null | undefined): MatchStatusKind {
  const status = String(match?.status || "").toUpperCase();

  if (status === "FT" || status === "AET" || status === "PEN" || status.includes("FINISH")) return "finished";
  if (status === "RESULT_PENDING") return "pending";
  if (status === "HT" || status.includes("HALF")) return "halftime";
  if (status === "LIVE" || status === "INPLAY" || status === "IN_PROGRESS" || Boolean(match?.minuteValue)) return "live";

  return "scheduled";
}

export function isMatchLive(match: Pick<Match, "status" | "minuteValue"> | null | undefined) {
  const kind = getMatchStatusKind(match);
  return kind === "live" || kind === "halftime";
}

export function isMatchFinished(match: Pick<Match, "status" | "minuteValue"> | null | undefined) {
  const kind = getMatchStatusKind(match);
  return kind === "finished" || kind === "pending";
}

export function getMatchStatusLabel(match: Pick<Match, "status" | "minuteValue" | "period"> | null | undefined) {
  const kind = getMatchStatusKind(match);
  if (kind === "finished") return "FT";
  if (kind === "pending") return "Uitslag volgt";
  if (kind === "halftime") return "Rust";
  if (kind === "live") return match?.minuteValue ? `${match.minuteValue}'` : "Live";
  return "Gepland";
}
