import { describe, expect, it } from "vitest";
import { buildH2HAgentProfile } from "../../scripts/worker/h2h.js";

const deps = {
  mergeH2HResultLists: (left, right) => {
    const rows = [...left, ...right];
    return [...new Map(rows.map((row) => [row.id, row])).values()];
  },
  lookupCuratedH2HBackfill: () => null,
  lookupHistoricalH2HBackfill: (profile) => profile?.h2h || null,
  summarizeH2HResults: (results, homeName, awayName, homeId, awayId, status, sameCompetitionPlayed) => ({
    played: results.length,
    homeWins: results.filter((row) => row.winnerId === homeId).length,
    awayWins: results.filter((row) => row.winnerId === awayId).length,
    draws: results.filter((row) => !row.winnerId).length,
    results,
    status,
    sameCompetitionPlayed,
  }),
};

describe("H2H source merger", () => {
  it("deduplicates results and preserves source lineage", () => {
    const profile = buildH2HAgentProfile({
      baseH2H: { status: "live-h2h", results: [{ id: "a", winnerId: "home" }] },
      marketProfile: { h2h: { status: "historical", results: [{ id: "a", winnerId: "home" }, { id: "b" }], sameCompetitionPlayed: 2 } },
      apiFootballProfile: { status: "api-football-h2h", results: [{ id: "c", winnerId: "away" }], played: 1 },
      homeName: "Home",
      awayName: "Away",
      homeId: "home",
      awayId: "away",
    }, deps);
    expect(profile.played).toBe(3);
    expect(profile.sameCompetitionPlayed).toBe(3);
    expect(profile.agent.sources).toEqual(["live-h2h", "historical", "api-football-h2h"]);
    expect(profile.coverage).toBe(0.6);
  });

  it("returns an explicit empty contract without inventing history", () => {
    expect(buildH2HAgentProfile({ homeName: "A", awayName: "B" }, deps)).toEqual({
      played: 0,
      homeWins: 0,
      draws: 0,
      awayWins: 0,
      results: [],
      status: "h2h-agent-empty",
    });
  });
});
