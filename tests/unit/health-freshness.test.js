import { describe, expect, it } from "vitest";
import { selectFreshestWorkerSource } from "../../shared/healthFreshness.js";

describe("system health freshness source", () => {
  it("uses repository worker data when Neon is older", () => {
    expect(selectFreshestWorkerSource({
      databaseLastRun: 1_000,
      repositoryLastRun: 2_000,
      repositorySource: "github-worker-data",
    })).toEqual({
      lastRun: 2_000,
      sourceOfTruth: "github-worker-data",
      databaseCurrent: false,
    });
  });

  it("keeps Neon authoritative when it is at least as recent", () => {
    expect(selectFreshestWorkerSource({
      databaseLastRun: 2_000,
      repositoryLastRun: 2_000,
      repositorySource: "github-worker-data",
    })).toEqual({
      lastRun: 2_000,
      sourceOfTruth: "neon",
      databaseCurrent: true,
    });
  });
});
