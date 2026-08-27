import { describe, expect, it } from "vitest";
import { calibrateOutcomeProbabilities } from "../../scripts/prediction-analytics.js";

describe("outcome probability calibration", () => {
  const performance = {
    overall: { matches: 500 },
    calibrationSummary: { averageAbsoluteError: 0.18 },
    calibrationBuckets: [
      { key: "75-100", matches: 60, calibrationError: -0.3 },
    ],
  };

  it("shrinks an overconfident competition segment without changing the selected outcome", () => {
    const result = calibrateOutcomeProbabilities(
      { homeProb: 0.72, drawProb: 0.18, awayProb: 0.1 },
      performance,
      { segmentPerformance: { matches: 120, probabilityOutcomeHitRate: 0.48 } },
    );
    expect(result.applied).toBe(true);
    expect(result.method).toBe("league_phase_empirical_shrinkage");
    expect(result.probabilities.homeProb).toBeLessThan(0.72);
    expect(result.probabilities.homeProb).toBeGreaterThan(result.probabilities.drawProb);
    expect(result.segmentShrinkage).toBeGreaterThan(0);
  });
});
