import React from "react";
import { Match } from "../types";
import { useLiveGoalsTable } from "./useLiveGoalsTable";

interface LiveGoalEventsProps {
  match: Pick<Match, "homeTeamName" | "awayTeamName" | "goalMinuteEvents">;
}

const LiveGoalEvents: React.FC<LiveGoalEventsProps> = ({ match }) => {
  const events = useLiveGoalsTable(match);
  if (!events.length) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-1" aria-label="Doelpunten deze wedstrijd">
      {events.map((event) => {
        const teamName = event.teamName || (event.side === "home" ? match.homeTeamName : match.awayTeamName);
        const kindLabel = event.kind === "own_goal" ? "eigen doelpunt" : event.kind === "penalty" ? "penalty" : "doelpunt";
        return (
          <span
            key={event.id}
            title={`${event.minute ? `${event.minute}′ · ` : ""}${event.playerName ? `${event.playerName} · ` : ""}${teamName} · ${kindLabel}`}
            className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-200"
          >
            <span className={event.side === "home" ? "text-blue-200" : "text-rose-200"}>{teamName}</span>
            {" · "}{event.minute ? `${event.minute}′` : "goal"}
          </span>
        );
      })}
    </div>
  );
};

export default LiveGoalEvents;
