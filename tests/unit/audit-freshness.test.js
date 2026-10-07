import { describe, expect, it } from "vitest";
import { assessAuditFreshness, parseAuditTimestamp, summarizeUniqueFixtureEvaluations } from "../../scripts/worker/audit-freshness.js";

describe("audit freshness and fixture accounting", () => {
  it("accepts ISO, millisecond, and second timestamps without mistaking numbers for dates", () => {
    const now = Date.parse("2026-10-06T12:00:00.000Z");
    const timestamp = Date.parse("2026-10-06T11:00:00.000Z");
    expect(parseAuditTimestamp(timestamp)).toBe(timestamp);
    expect(parseAuditTimestamp(String(timestamp / 1000))).toBe(timestamp);
    expect(assessAuditFreshness({ generatedAt: timestamp }, { now }).status).toBe("fresh");
    expect(assessAuditFreshness({ generatedAt: "2026-10-04T12:00:00.000Z" }, { now }).status).toBe("stale");
    expect(assessAuditFreshness({ generatedAt: "unknown" }, { now }).status).toBe("unknown");
  });

  it("separates snapshot rows from unique fixture-level evaluation coverage", () => {
    expect(summarizeUniqueFixtureEvaluations([
      { matchId: "same", predictionId: "p1" },
      { matchId: "same", predictionId: "p2" },
      { matchId: "other", predictionId: "p3" },
      { predictionId: "no-match-id" },
    ], [{ predictionId: "p2" }])).toMatchObject({
      eligibleSnapshots: 3,
      eligibleFixtures: 2,
      evaluatedSnapshots: 1,
      evaluatedFixtures: 1,
      evaluatedFixturesMissing: 1,
      repeatedSnapshotRows: 1,
      coverage: 0.5,
    });
  });
});
