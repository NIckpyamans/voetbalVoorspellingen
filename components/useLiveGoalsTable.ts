import { useMemo } from "react";
import { LiveGoalEvent, Match } from "../types";

export function useLiveGoalsTable(match: Pick<Match, "goalMinuteEvents">): LiveGoalEvent[] {
  return useMemo(() => {
    const seen = new Set<string>();
    return (Array.isArray(match.goalMinuteEvents) ? match.goalMinuteEvents : [])
      .filter((event) => event && (event.side === "home" || event.side === "away"))
      .slice(-12)
      .filter((event) => {
        const key = String(event.id || `${event.minute}-${event.side}-${event.playerName || ""}`);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [match.goalMinuteEvents]);
}
