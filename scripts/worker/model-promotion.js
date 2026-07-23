const DEFAULT_CALIBRATION_MIN = 50;
const DEFAULT_PROMOTION_MIN = 150;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function buildModelPromotionGate(uniqueCompletedMatches, options = {}) {
  const calibrationMin = positiveInteger(options.calibrationMin, DEFAULT_CALIBRATION_MIN);
  const promotionMin = Math.max(
    calibrationMin,
    positiveInteger(options.promotionMin, DEFAULT_PROMOTION_MIN)
  );
  const uniqueMatches = Math.max(0, Math.floor(Number(uniqueCompletedMatches) || 0));
  const canCalibrate = uniqueMatches >= calibrationMin;
  const canPromote = uniqueMatches >= promotionMin;

  return {
    uniqueCompletedMatches: uniqueMatches,
    calibrationMin,
    promotionMin,
    calibrationGap: Math.max(0, calibrationMin - uniqueMatches),
    promotionGap: Math.max(0, promotionMin - uniqueMatches),
    canCalibrate,
    canPromote,
    stage: canPromote ? "professional_ready" : canCalibrate ? "experimental_ready" : "collecting",
  };
}

export const MODEL_PROMOTION_DEFAULTS = Object.freeze({
  calibrationMin: DEFAULT_CALIBRATION_MIN,
  promotionMin: DEFAULT_PROMOTION_MIN,
});
