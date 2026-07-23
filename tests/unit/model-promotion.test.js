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
