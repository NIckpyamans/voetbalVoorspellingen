export function buildTrainingAutomationState(training = {}, options = {}) {
  const uniqueCompleted = Math.max(0, Number(
    training?.uniqueSnapshotMatches ?? training?.trainingPolicy?.uniqueSnapshotMatches ?? 0
  ));
  const rows = Array.isArray(training?.rows) ? training.rows : [];
  const regularMatchIds = new Set(rows
    .filter((row) => Number(row?.features?.phase_league || 0) >= 0.5 && !/friendl|oefen/i.test(String(row?.league || "")))
    .map((row) => String(row?.matchId || "").trim())
    .filter(Boolean));
  const uniqueRegularCompleted = Math.max(0, Number(
    training?.uniqueRegularSnapshotMatches ?? training?.trainingPolicy?.uniqueRegularSnapshotMatches ?? regularMatchIds.size
  ));
  const calibrationMin = Math.max(1, Number(options.calibrationMin || training?.trainingPolicy?.minSnapshotRows || 50));
  const promotionMin = Math.max(calibrationMin, Number(options.promotionMin || training?.trainingPolicy?.nextTargetRows || 150));
  const regularCalibrationMin = Math.max(1, Number(options.regularCalibrationMin || 50));
  return {
    uniqueCompleted,
    uniqueRegularCompleted,
    calibrationMin,
    promotionMin,
    regularCalibrationMin,
    canCalibrate: uniqueCompleted >= calibrationMin,
    canPromote: uniqueCompleted >= promotionMin,
    canCalibrateRegular: uniqueRegularCompleted >= regularCalibrationMin,
    calibrationGap: Math.max(0, calibrationMin - uniqueCompleted),
    promotionGap: Math.max(0, promotionMin - uniqueCompleted),
    regularCalibrationGap: Math.max(0, regularCalibrationMin - uniqueRegularCompleted),
  };
}

export function buildProviderAcceptanceState(report, options = {}) {
  const now = new Date(options.now || Date.now()).getTime();
  const retryHours = Math.max(1, Number(options.retryHours || 24));
  const generatedAt = Date.parse(report?.generatedAt || "");
  const ageHours = Number.isFinite(generatedAt) ? Math.max(0, (now - generatedAt) / 3600000) : Infinity;
  const errorText = JSON.stringify(report?.errors || []).toLowerCase();
  const externallyBlocked = /suspend|not subscribed|quota|rate.?limit|forbidden|access/.test(errorText);
  return {
    accepted: report?.accepted === true,
    externallyBlocked,
    checkDue: !report || ageHours >= retryHours,
    ageHours,
    reason: report?.accepted === true
      ? "accepted"
      : externallyBlocked
        ? "provider_account_or_plan_blocked"
        : report
          ? "coverage_targets_not_met"
          : "acceptance_not_checked",
  };
}
