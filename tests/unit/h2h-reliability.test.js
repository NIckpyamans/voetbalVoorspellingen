import { describe, expect, it } from "vitest";
import { buildH2HReliability } from "../../scripts/worker/prediction.js";

describe("H2H reliability", () => {
  const kickoff = "2026-08-20T19:00:00Z";

  it("excludes matches on or after kickoff from the effective sample", () => {
    const reliability = buildH2HReliability({
      played: 3,
      sameCompetitionPlayed: 3,
      results: [
        { date: "2026-08-10", winnerId: "home" },
        { date: "2026-08-20", winnerId: "away" },
        { date: "2026-08-21", winnerId: "home" },
      ],
    }, { kickoff });
    expect(reliability.sampleSize).toBe(1);
    expect(reliability.excludedResults).toBe(2);
    expect(reliability.eligibleResults.map((result) => result.date)).toEqual(["2026-08-10"]);
    expect(reliability.sameCompetitionPlayed).toBe(1);
  });

  it("weights recent samples more than stale samples", () => {
    const recent = buildH2HReliability({ played: 5, sameCompetitionPlayed: 3, results: [{ date: "2026-08-10" }, { date: "2026-05-01" }, { date: "2026-02-01" }, { date: "2025-11-01" }, { date: "2025-08-01" }] }, { kickoff });
    const stale = buildH2HReliability({ played: 5, sameCompetitionPlayed: 3, results: [{ date: "2022-08-01" }, { date: "2021-08-01" }, { date: "2020-08-01" }, { date: "2019-08-01" }, { date: "2018-08-01" }] }, { kickoff });
    expect(recent.score).toBeGreaterThan(stale.score);
    expect(stale.reason).toBe("H2H is verouderd");
  });

  it("returns an empty model sample rather than trusting post-cutoff played totals", () => {
    const reliability = buildH2HReliability({ played: 8, sameCompetitionPlayed: 8 }, { kickoff });
    expect(reliability).toMatchObject({ sampleSize: 0, score: 0, excludedResults: 0, label: "empty" });
  });

  it("segregates explicit competition identifiers in a cross-competition sample", () => {
    const reliability = buildH2HReliability({
      played: 2,
      sameCompetitionPlayed: 2,
      results: [
        { date: "2026-08-10", competitionId: "cup-1" },
        { date: "2026-08-11", competitionId: "league-2" },
      ],
    }, { kickoff, competitionId: "league-2" });
    expect(reliability.sameCompetitionPlayed).toBe(1);
  });

  it("caps same-competition count to the eligible sample", () => {
    const reliability = buildH2HReliability({
      played: 2,
      sameCompetitionPlayed: 7,
      results: [{ date: "2026-08-10" }, { date: "2026-08-21" }],
    }, { kickoff });
    expect(reliability.sameCompetitionPlayed).toBe(1);
  });

  it("does not infer history from an aggregate count when all known results are post-kickoff", () => {
    const reliability = buildH2HReliability({ played: 8, sameCompetitionPlayed: 8, results: [{ date: "2026-08-21" }] }, { kickoff });
    expect(reliability).toMatchObject({ sampleSize: 0, score: 0, label: "empty", excludedResults: 1 });
  });
});
