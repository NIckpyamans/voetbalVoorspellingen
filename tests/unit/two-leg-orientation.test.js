import { describe, expect, it } from "vitest";
import {
  buildTwoLegAggregate,
  deriveH2HWinnerId,
  findOrientedPreviousLeg,
} from "../../scripts/worker/two-leg.js";

describe("two-leg result orientation", () => {
  const previousLeg = {
    eventId: "first-leg",
    date: "2026-07-23",
    venue: "A",
    opponent: "FK Vojvodina",
    score: "4-1",
    goalsFor: 4,
    goalsAgainst: 1,
  };

  it("preserves the historical home-away order from team-perspective form data", () => {
    expect(findOrientedPreviousLeg({
      homeRecent: { recentMatches: [previousLeg] },
      awayRecent: { recentMatches: [] },
      currentHomeId: "ajax",
      currentAwayId: "vojvodina",
      currentHomeName: "Ajax",
      currentAwayName: "FK Vojvodina",
      currentEventId: "return-leg",
    })).toMatchObject({
      home: "FK Vojvodina",
      away: "Ajax",
      score: "1-4",
    });
  });

  it("starts the return with Ajax leading 4-1 on aggregate", () => {
    expect(buildTwoLegAggregate(
      { homeTeam: { id: "ajax", name: "Ajax" }, awayTeam: { id: "vojvodina", name: "FK Vojvodina" } },
      { homeTeamId: "vojvodina", awayTeamId: "ajax", home: "FK Vojvodina", away: "Ajax", score: "1-4" }
    )).toEqual({
      firstLegHomeGoals: 4,
      firstLegAwayGoals: 1,
      firstLegScore: "1-4",
      firstLegText: "FK Vojvodina 1-4 Ajax",
    });
  });

  it("derives an Ajax H2H win when a provider omitted winnerId", () => {
    expect(deriveH2HWinnerId(
      { home: "FK Vojvodina", away: "Ajax", score: "1-4" },
      "Ajax",
      "FK Vojvodina",
      "ajax",
      "vojvodina"
    )).toBe("ajax");
  });
});
