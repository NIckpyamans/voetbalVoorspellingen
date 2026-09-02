const DEFAULT_CALIBRATION_MIN = 50;
const DEFAULT_PROMOTION_MIN = 150;
const DEFAULT_VALIDATION_MIN = 30;
const DEFAULT_LEAKAGE_COVERAGE = 0.95;
const DEFAULT_BRIER_IMPROVEMENT = 0.003;
const DEFAULT_LOG_LOSS_IMPROVEMENT = 0.001;

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
  const sampleCanPromote = uniqueMatches >= promotionMin;
  const qualityEvidenceProvided = options.requireQualityEvidence === true || [
    options.validationRows,
    options.leakageCoverage,
    options.brierImprovement,
    options.logLossImprovement,
  ].some((value) => value != null);
  const validationMin = positiveInteger(options.validationMin, DEFAULT_VALIDATION_MIN);
  const validationRows = Math.max(0, Number(options.validationRows || 0));
  const leakageCoverage = Math.max(0, Math.min(1, Number(options.leakageCoverage || 0)));
  const minLeakageCoverage = Number(options.minLeakageCoverage ?? DEFAULT_LEAKAGE_COVERAGE);
  const brierImprovement = Number(options.brierImprovement || 0);
  const minBrierImprovement = Number(options.minBrierImprovement ?? DEFAULT_BRIER_IMPROVEMENT);
  const logLossImprovement = Number(options.logLossImprovement || 0);
  const minLogLossImprovement = Number(options.minLogLossImprovement ?? DEFAULT_LOG_LOSS_IMPROVEMENT);
  const qualityReasons = qualityEvidenceProvided ? [
    validationRows < validationMin ? "insufficient_walk_forward_validation_rows" : null,
    leakageCoverage < minLeakageCoverage ? "insufficient_leakage_free_coverage" : null,
    brierImprovement < minBrierImprovement ? "insufficient_brier_improvement" : null,
    logLossImprovement < minLogLossImprovement ? "insufficient_log_loss_improvement" : null,
  ].filter(Boolean) : [];
  const canPromote = sampleCanPromote && qualityReasons.length === 0;

  return {
    uniqueCompletedMatches: uniqueMatches,
    calibrationMin,
    promotionMin,
    calibrationGap: Math.max(0, calibrationMin - uniqueMatches),
    promotionGap: Math.max(0, promotionMin - uniqueMatches),
    canCalibrate,
    canPromote,
    sampleCanPromote,
    qualityEvidenceProvided,
    quality: {
      validationRows,
      validationMin,
      leakageCoverage,
      minLeakageCoverage,
      brierImprovement,
      minBrierImprovement,
      logLossImprovement,
      minLogLossImprovement,
      reasons: qualityReasons,
    },
    stage: canPromote ? "professional_ready" : canCalibrate ? "experimental_ready" : "collecting",
  };
}

export const MODEL_PROMOTION_DEFAULTS = Object.freeze({
  calibrationMin: DEFAULT_CALIBRATION_MIN,
  promotionMin: DEFAULT_PROMOTION_MIN,
  validationMin: DEFAULT_VALIDATION_MIN,
  minLeakageCoverage: DEFAULT_LEAKAGE_COVERAGE,
  minBrierImprovement: DEFAULT_BRIER_IMPROVEMENT,
  minLogLossImprovement: DEFAULT_LOG_LOSS_IMPROVEMENT,
});
