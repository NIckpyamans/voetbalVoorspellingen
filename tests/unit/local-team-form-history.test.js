import { describe, expect, it } from "vitest";
import { buildLocalTeamFormIndex, mergeLocalTeamForm } from "../../scripts/worker/local-team-form-history.js";

describe("local completed fixture form history", () => {
  const completedFriendly = {
    id: "friendly-1",
    date: "2026-07-22",
    kickoff: "2026-07-22T18:00:00.000Z",
    league: "World - Club Friendlies",
    homeTeamName: "Tottenham Hotspur",
    awayTeamName: "Milton Keynes Dons",
    status: "FT",
    score: "1-0",
    dataSource: "espn-scoreboard-fallback",
  };

  it("orients a completed friendly for both clubs and ignores pending fixtures", () => {
    const index = buildLocalTeamFormIndex([{ matches: [
      completedFriendly,
      { ...completedFriendly, id: "pending", status: "RESULT_PENDING", score: null },
    ] }], { now: Date.parse("2026-07-23T00:00:00.000Z") });
    expect(index.get("tottenham hotspur")).toMatchObject([{ result: "W", score: "1-0", venue: "H", friendly: true }]);
    expect(index.get("milton keynes dons")).toMatchObject([{ result: "L", score: "0-1", venue: "A", friendly: true }]);
  });

  it("merges provider and local history without duplicate events", () => {
    const local = buildLocalTeamFormIndex([{ matches: [completedFriendly] }]).get("tottenham hotspur");
    const profile = mergeLocalTeamForm({
      providerTeamName: "Tottenham Hotspur",
      source: "provider",
      recentMatches: [{ date: "2026-05-20", eventId: "old", opponent: "Arsenal", score: "2-1" }],
    }, [...local, ...local], "Tottenham Hotspur", { now: Date.parse("2026-07-23T00:00:00.000Z") });
    expect(profile.recentMatches).toHaveLength(2);
    expect(profile.source).toContain("local-finished-results");
  });
});
