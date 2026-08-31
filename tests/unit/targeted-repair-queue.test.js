import { describe, expect, it } from "vitest";
import { buildTargetedRepairQueue } from "../../scripts/worker/targeted-repair-queue.js";

describe("targeted repair queue", () => {
  it("prioritizes an incomplete followed fixture inside 24 hours", () => {
    const now = Date.parse("2026-08-31T08:00:00Z");
    const queue = buildTargetedRepairQueue([{
      id: "m1", league: "League", kickoff: "2026-08-31T20:00:00Z", homeTeamName: "A", awayTeamName: "B",
      h2h: { played: 0 }, homeRecent: { gamesPlayed: 2 }, awayRecent: { gamesPlayed: 2 },
    }], { now, followedCompetitions: ["League"] });
    expect(queue[0]).toMatchObject({ matchId: "m1", within24h: true });
    expect(queue[0].missing).toEqual(expect.arrayContaining(["h2h", "form", "lineups", "odds"]));
  });

  it("does not schedule nested squad profiles for repair", () => {
    const players = Array.from({ length: 11 }, (_, index) => ({ id: `player-${index}` }));
    const queue = buildTargetedRepairQueue([{
      id: "m2", league: "League", kickoff: "2026-09-02T20:00:00Z", homeTeamName: "A", awayTeamName: "B",
      homeTeamProfile: { squad: { playerCount: 11, players } },
      awayTeamProfile: { squad: { playerCount: 11, players } },
    }], { now: Date.parse("2026-08-31T08:00:00Z") });

    expect(queue[0].missing).not.toContain("squads");
    expect(queue[0].missing).not.toContain("playerIdentities");
  });
});
