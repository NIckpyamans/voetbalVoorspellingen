import { describe, expect, it } from "vitest";
import { buildLiveGoalEventsFromMatch } from "../../scripts/worker/live-goal-events.js";
import { compactDashboardMatch } from "../../shared/dashboardCompact.js";
import { mapRawMatch } from "../../services/matchService.ts";

describe("live goal event pipeline", () => {
  it("normalizes and deduplicates goals, own goals, and penalties by side and minute", () => {
    const events = buildLiveGoalEventsFromMatch({
      live: {
        homeTeam: { id: 10 },
        awayTeam: { id: 20 },
        incidents: [
          { incidentType: "goal", time: 12, team: { id: 10 }, player: { name: "Home scorer" } },
          { incidentType: "goal", time: 45, team: { id: 20 }, player: { name: "Away scorer" }, incidentClass: "ownGoal" },
          { incidentType: "goal", time: { current: 67, extra: 2 }, team: { id: 10 }, player: { name: "Penalty scorer" }, incidentClass: "penalty" },
          { incidentType: "goal", time: 70, team: { id: 20 }, incidentClass: "disallowed" },
        ],
      },
      eventDetails: {
        incidents: [{ incidentType: "goal", time: 12, team: { id: 10 }, player: { name: "Home scorer" } }],
      },
      homeTeamName: "Home FC",
      awayTeamName: "Away FC",
    });

    expect(events).toEqual([
      expect.objectContaining({ minute: "12", side: "home", playerName: "Home scorer", kind: "goal" }),
      expect.objectContaining({ minute: "45", side: "away", kind: "own_goal" }),
      expect.objectContaining({ minute: "67+2", side: "home", playerName: "Penalty scorer", kind: "penalty" }),
    ]);
  });

  it("does not emit an empty goal timeline when providers have no confirmed goal", () => {
    expect(buildLiveGoalEventsFromMatch({
      live: { homeTeam: { id: 10 }, awayTeam: { id: 20 }, incidents: [{ incidentType: "yellowCard", time: 20, team: { id: 10 } }] },
    })).toBeNull();
  });

  it("passes goal-minute events through compact responses and client mapping", () => {
    const goalMinuteEvents = [{ id: "g1", minute: "33", side: "home", teamName: "Home", playerName: "Scorer", kind: "goal" }];
    const compact = compactDashboardMatch({ id: "fixture-1", goalMinuteEvents, goalMinuteEventsUpdatedAt: 100 });
    expect(compact.goalMinuteEvents).toEqual(goalMinuteEvents);
    expect(compact.goalMinuteEventsUpdatedAt).toBe(100);

    const mapped = mapRawMatch({
      id: "fixture-1",
      date: "2026-10-01",
      league: "Netherlands - Eredivisie",
      homeTeamName: "Home",
      awayTeamName: "Away",
      goalMinuteEvents,
      goalMinuteEventsUpdatedAt: 100,
    });
    expect(mapped.goalMinuteEvents).toEqual(goalMinuteEvents);
    expect(mapped.goalMinuteEventsUpdatedAt).toBe(100);
  });
});
