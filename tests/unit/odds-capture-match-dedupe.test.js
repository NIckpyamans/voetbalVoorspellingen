import { describe, expect, it } from "vitest";
import { dedupeUpcomingMatches } from "../../scripts/worker/odds-fixture-dedupe.js";

function row(matchId, overrides = {}) {
  return {
    matchId,
    kickoff: "2026-11-03T20:00:00.000Z",
    league: "Europe - Champions League",
    homeTeam: "Bodø/Glimt",
    awayTeam: "Lille",
    ...overrides,
  };
}

describe("odds fixture dedupe", () => {
  it("keeps one representative per fixture and prefers the FotMob id", () => {
    const rows = dedupeUpcomingMatches([
      row("ss-espn-uefa.champions-401915384"),
      row("ss-fotmob-6106316"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].matchId).toBe("ss-fotmob-6106316");
    expect(rows[0].duplicateIds).toEqual(["ss-espn-uefa.champions-401915384"]);
  });

  it("keeps different fixtures and different kickoff dates apart", () => {
    const rows = dedupeUpcomingMatches([
      row("ss-1"),
      row("ss-2", { homeTeam: "Feyenoord", awayTeam: "Inter" }),
      row("ss-3", { kickoff: "2026-11-04T20:00:00.000Z" }),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.every((item) => !item.duplicateIds)).toBe(true);
  });

  it("collects the ids of more than two provider rows for one fixture", () => {
    const rows = dedupeUpcomingMatches([
      row("ss-espn-a-1"),
      row("ss-99"),
      row("ss-fotmob-5"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].matchId).toBe("ss-fotmob-5");
    expect([...rows[0].duplicateIds].sort()).toEqual(["ss-99", "ss-espn-a-1"]);
  });
});