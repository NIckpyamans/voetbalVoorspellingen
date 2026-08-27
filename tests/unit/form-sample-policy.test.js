import { describe, expect, it } from "vitest";
import { dedupeRecentTeamMatches, shrinkVenueSplit, stabilizeOverallForm } from "../../scripts/worker/form-sample-policy.js";

describe("form sample policy", () => {
  it("shrinks a one-match venue split toward overall form", () => {
    const result = shrinkVenueSplit({
      gamesPlayed: 2,
      avgScored: 2.5,
      avgConceded: 1.5,
      splits: { home: { games: 1, avgScored: 4, avgConceded: 0 } },
    }, "home");

    expect(result).toMatchObject({ games: 1, avgScored: 2.26, avgConceded: 1.04, sampleWeight: 0.25 });
  });

  it("shrinks sparse overall form toward a neutral prior", () => {
    expect(stabilizeOverallForm({ gamesPlayed: 2, avgScored: 2.5, avgConceded: 1.5 })).toEqual({
      avgScored: 1.68,
      avgConceded: 1.39,
      sampleWeight: 0.29,
    });
  });

  it("retains more venue evidence as the sample grows", () => {
    const result = shrinkVenueSplit({
      avgScored: 1.5,
      avgConceded: 1.2,
      splits: { away: { games: 9, avgScored: 2.1, avgConceded: 0.8 } },
    }, "away");

    expect(result.sampleWeight).toBe(0.75);
    expect(result.avgScored).toBe(1.91);
    expect(result.avgConceded).toBe(0.94);
  });

  it("deduplicates the same provider-neutral team result", () => {
    const rows = dedupeRecentTeamMatches([
      { date: "2026-08-20", venue: "A", goalsFor: 1, goalsAgainst: 3, opponent: "TBC", source: "r2" },
      { date: "2026-08-20", venue: "A", goalsFor: 1, goalsAgainst: 3, opponent: "Getafe", source: "sky" },
      { date: "2026-08-20", venue: "A", goalsFor: 1, goalsAgainst: 3, opponent: "Getafe", source: "fotmob" },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ opponent: "Getafe", source: "fotmob" });
  });
});
