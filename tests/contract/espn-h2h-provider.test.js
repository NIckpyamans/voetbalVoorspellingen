import { describe, expect, it } from "vitest";
import { normalizeEspnH2HEvents } from "../../scripts/providers/espn-h2h-provider.js";

describe("ESPN H2H contract", () => {
  const event = {
    id: "fixture-1",
    date: "2025-08-10T18:00:00.000Z",
    competitions: [{
      date: "2025-08-10T18:00:00.000Z",
      status: { type: { name: "STATUS_FINAL" } },
      competitors: [
        { homeAway: "home", team: { id: "away-id" }, score: "1" },
        { homeAway: "away", team: { id: "home-id" }, score: "2" },
      ],
    }],
  };

  it("orients a completed ESPN away match to the current fixture", () => {
    const results = normalizeEspnH2HEvents([event], {
      homeName: "Home FC", awayName: "Away FC", homeEspnId: "home-id", awayEspnId: "away-id", cutoffAt: "2026-01-01T00:00:00.000Z",
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ score: "2-1", homeScore: 2, awayScore: 1, winnerId: "home-id", source: "espn-team-schedule-h2h" });
  });

  it("rejects future and non-final ESPN events", () => {
    const planned = structuredClone(event);
    planned.competitions[0].status.type.name = "STATUS_SCHEDULED";
    expect(normalizeEspnH2HEvents([event], { homeEspnId: "home-id", awayEspnId: "away-id", cutoffAt: "2025-01-01T00:00:00.000Z" })).toEqual([]);
    expect(normalizeEspnH2HEvents([planned], { homeEspnId: "home-id", awayEspnId: "away-id", cutoffAt: "2026-01-01T00:00:00.000Z" })).toEqual([]);
  });
});
