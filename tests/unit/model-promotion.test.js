import { describe, expect, it } from "vitest";
import { buildModelPromotionGate } from "../../scripts/worker/model-promotion.js";

describe("model promotion gate", () => {
  it.each([
    [49, "collecting", false, false, 1, 101],
    [50, "experimental_ready", true, false, 0, 100],
    [149, "experimental_ready", true, false, 0, 1],
    [150, "professional_ready", true, true, 0, 0],
  ])("classifies %s unique matches", (matches, stage, canCalibrate, canPromote, calibrationGap, promotionGap) => {
    expect(buildModelPromotionGate(matches)).toEqual(
      expect.objectContaining({ stage, canCalibrate, canPromote, calibrationGap, promotionGap })
    );
  });
});

describe("quality-aware model promotion", () => {
  it("blocks a large sample when walk-forward quality does not improve", () => {
    const gate = buildModelPromotionGate(180, {
      requireQualityEvidence: true,
      validationRows: 45,
      leakageCoverage: 0.98,
      brierImprovement: 0.001,
      logLossImprovement: 0.002,
    });
    expect(gate.sampleCanPromote).toBe(true);
    expect(gate.canPromote).toBe(false);
    expect(gate.quality.reasons).toContain("insufficient_brier_improvement");
  });

  it("promotes only with enough leakage-free validation improvement", () => {
    expect(buildModelPromotionGate(180, {
      requireQualityEvidence: true,
      validationRows: 45,
      leakageCoverage: 0.98,
      brierImprovement: 0.004,
      logLossImprovement: 0.003,
    }).canPromote).toBe(true);
  });
});
