import { describe, expect, it } from "vitest";
import {
  buildOutcomeEnsemble,
  devigThreeWayOdds,
  summarizeScoreCoverage,
} from "../../scripts/worker/outcome-ensemble.js";

describe("independent 1X2 outcome ensemble", () => {
  it("removes the bookmaker margin before using market probabilities", () => {
    const result = devigThreeWayOdds(
      { home: 2, draw: 3.5, away: 4, capturedAt: "2026-08-27T17:00:00Z" },
      "2026-08-27T19:00:00Z",
    );
    expect(result).not.toBeNull();
    expect(result.homeProb + result.drawProb + result.awayProb).toBeCloseTo(1, 3);
    expect(result.overround).toBeGreaterThan(1);
  });

  it("rejects odds captured after kickoff to prevent leakage", () => {
    expect(devigThreeWayOdds(
      { home: 2, draw: 3.5, away: 4, capturedAt: "2026-08-27T20:00:00Z" },
      "2026-08-27T19:00:00Z",
    )).toBeNull();
  });

  it("combines only available models and keeps unpromoted boosting inactive", () => {
    const result = buildOutcomeEnsemble({
      poisson: { homeProb: 0.5, drawProb: 0.28, awayProb: 0.22 },
      heuristic: { homeProb: 0.55, drawProb: 0.25, awayProb: 0.2 },
      monteCarlo: { homeProb: 0.52, drawProb: 0.27, awayProb: 0.21 },
      homeElo: 1700,
      awayElo: 1550,
    });
    expect(result.probabilities.homeProb).toBeGreaterThan(result.probabilities.awayProb);
    expect(result.components.find((item) => item.key === "gradient_boosting")).toMatchObject({ active: false });
    expect(result.probabilities.homeProb + result.probabilities.drawProb + result.probabilities.awayProb).toBeCloseTo(1, 3);
  });

  it("reports honest top-3 and top-5 score coverage", () => {
    const coverage = summarizeScoreCoverage({ "1-0": 0.14, "1-1": 0.13, "2-0": 0.12, "2-1": 0.1, "0-0": 0.08 });
    expect(coverage.top1).toBe(0.14);
    expect(coverage.top3).toBe(0.39);
    expect(coverage.top5).toBe(0.57);
  });
});
