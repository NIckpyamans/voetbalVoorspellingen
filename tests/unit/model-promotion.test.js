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
  const passingEvidence = {
    requireQualityEvidence: true,
    validationRows: 45,
    leakageCoverage: 0.98,
    brierImprovement: 0.004,
    logLossImprovement: 0.003,
  };

  it("blocks otherwise promising quality when fewer than 150 independent fixtures exist", () => {
    const gate = buildModelPromotionGate(90, passingEvidence);
    expect(gate.sampleCanPromote).toBe(false);
    expect(gate.canPromote).toBe(false);
    expect(gate.promotionGap).toBe(60);
  });

  it("blocks a large sample when the holdout is too small", () => {
    const gate = buildModelPromotionGate(180, { ...passingEvidence, validationRows: 29 });
    expect(gate.sampleCanPromote).toBe(true);
    expect(gate.canPromote).toBe(false);
    expect(gate.quality.reasons).toContain("insufficient_walk_forward_validation_rows");
  });

  it("blocks a large sample when walk-forward quality does not improve", () => {
    const gate = buildModelPromotionGate(180, {
      ...passingEvidence,
      brierImprovement: 0.001,
      logLossImprovement: 0.0001,
    });
    expect(gate.sampleCanPromote).toBe(true);
    expect(gate.canPromote).toBe(false);
    expect(gate.quality.reasons).toEqual(expect.arrayContaining([
      "insufficient_brier_improvement",
      "insufficient_log_loss_improvement",
    ]));
  });

  it("promotes only with enough leakage-free validation improvement", () => {
    expect(buildModelPromotionGate(180, passingEvidence).canPromote).toBe(true);
  });
});
