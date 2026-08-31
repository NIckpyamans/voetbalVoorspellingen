import { describe, expect, it } from "vitest";
import {
  buildLocalTeamFormIndex,
  dayPayloadsFromSnapshotLedger,
  dayPayloadsFromHistorySummary,
  mergeLocalTeamForm,
  mergePersistedTeamFormCache,
} from "../../scripts/worker/local-team-form-history.js";

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
    postMatchStats: {
      goalQuarters: {
        home: { q4_46_60: 1 },
        away: {},
      },
    },
  };

  it("converts evaluated immutable snapshots into completed form history", () => {
    const days = dayPayloadsFromSnapshotLedger({
      predictionSnapshots: {
        p1: { predictionId: "p1", matchId: "m1", date: "2026-08-01", league: "Netherlands - Eredivisie", homeTeam: "Ajax", awayTeam: "Twente" },
      },
      evaluations: { p1: { finalHomeGoals: 2, finalAwayGoals: 1, evaluationSource: "r2-evaluator" } },
    });
    expect(days[0].matches[0]).toMatchObject({ homeTeamName: "Ajax", awayTeamName: "Twente", score: "2-1", status: "FT" });
  });

  it("converts immutable review summaries into finished history", () => {
    const days = dayPayloadsFromHistorySummary({ postMatchReviews: {
      r1: { matchId: "m1", date: "2026-08-02", league: "League", homeTeamName: "Ajax", awayTeamName: "Twente", actualScore: "3-1" },
    } });
    expect(days[0].matches[0]).toMatchObject({ score: "3-1", status: "FT", homeTeamName: "Ajax" });
  });

  it("does not turn missing final scores into a false 0-0 result", () => {
    const days = dayPayloadsFromSnapshotLedger({
      predictionSnapshots: { p1: { predictionId: "p1", matchId: "m1", date: "2026-08-01", homeTeam: "Ajax", awayTeam: "Twente" } },
      evaluations: { p1: { finalHomeGoals: null, finalAwayGoals: null } },
    });
    expect(days).toHaveLength(0);
  });

  it("orients a completed friendly for both clubs and ignores pending fixtures", () => {
    const index = buildLocalTeamFormIndex([{ matches: [
      completedFriendly,
      { ...completedFriendly, id: "pending", status: "RESULT_PENDING", score: null },
    ] }], { now: Date.parse("2026-07-23T00:00:00.000Z") });
    expect(index.get("tottenham hotspur")).toMatchObject([{ result: "W", score: "1-0", venue: "H", friendly: true }]);
    expect(index.get("milton keynes dons")).toMatchObject([{ result: "L", score: "0-1", venue: "A", friendly: true }]);
    expect(index.get("tottenham hotspur")[0].goalQuartersFor).toMatchObject({ q4_46_60: 1 });
    expect(index.get("milton keynes dons")[0].goalQuartersAgainst).toMatchObject({ q4_46_60: 1 });
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
    expect(profile.goalTiming).toMatchObject({ scoredGoals: 1, firstHalfScoringShare: 0 });
    expect(profile).toMatchObject({ gamesPlayed: 2, weightingPolicy: "competitive=1,friendly=0.35" });
    expect(profile.last10.weightedGames).toBe(1.35);
  });

  it("deduplicates the same fixture coming from different provider IDs", () => {
    const profile = mergeLocalTeamForm({
      providerTeamName: "Anderlecht",
      source: "provider+local-finished-results+local-finished-results",
      recentMatches: [{ date: "2026-08-20", eventId: "fotmob-1", venue: "A", opponent: "Kairat Almaty", score: "3-0" }],
    }, [{ date: "2026-08-20", eventId: "sky-2", venue: "A", opponent: "Kairat Almaty", score: "3-0" }], "Anderlecht");
    expect(profile.recentMatches).toHaveLength(1);
    expect(profile.source).toBe("provider+local-finished-results");
  });

  it("lets the separately refreshed cache replace stale worker state", () => {
    expect(mergePersistedTeamFormCache(
      { ajax: { updatedAt: "old", data: { recentMatches: [] } } },
      { ajax: { updatedAt: "new", data: { recentMatches: [{ eventId: "latest" }] } } },
    ).ajax).toMatchObject({ updatedAt: "new", data: { recentMatches: [{ eventId: "latest" }] } });
  });
});
