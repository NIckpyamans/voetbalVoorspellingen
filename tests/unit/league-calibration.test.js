import { describe, expect, it } from "vitest";
import { applyLeagueCalibration, rebuildLeagueCalibrationProfilesFromReviews } from "../../scripts/worker/league-calibration.js";

describe("league calibration module", () => {
  it("normalizes static and dynamic league adjustments", () => {
    const result = applyLeagueCalibration(
      { homeProb: 0.5, drawProb: 0.3, awayProb: 0.2 },
      "Netherlands - Eredivisie",
      { homeBias: 0.01 }
    );
    expect(result.homeProb + result.drawProb + result.awayProb).toBeCloseTo(1, 3);
    expect(result.homeProb).toBeGreaterThan(0.5);
  });

  it("builds review profiles outside the worker orchestrator", () => {
    const createdAt = Date.parse("2026-08-15T12:00:00Z");
    const store = {
      postMatchReviews: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`m${index}`, {
        league: "Netherlands - Eredivisie",
        actualScore: index % 2 ? "1-1" : "2-0",
        predictedScore: "1-0",
        actualOutcome: index % 2 ? "D" : "H",
        predictedOutcome: "H",
        outcomeHit: index % 2 === 0,
        createdAt,
      }])),
    };
    rebuildLeagueCalibrationProfilesFromReviews(store, Date.parse("2026-08-16T12:00:00Z"));
    expect(store.leagueCalibrationProfilesByWindow["7"]["Netherlands - Eredivisie"].matches).toBe(8);
  });
});
