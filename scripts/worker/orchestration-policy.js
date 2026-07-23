export function buildTrainingAutomationState(training = {}, options = {}) {
  const uniqueCompleted = Math.max(0, Number(
    training?.uniqueSnapshotMatches ?? training?.trainingPolicy?.uniqueSnapshotMatches ?? 0
  ));
  const calibrationMin = Math.max(1, Number(options.calibrationMin || training?.trainingPolicy?.minSnapshotRows || 50));
  const promotionMin = Math.max(calibrationMin, Number(options.promotionMin || training?.trainingPolicy?.nextTargetRows || 150));
  return {
    uniqueCompleted,
    calibrationMin,
    promotionMin,
    canCalibrate: uniqueCompleted >= calibrationMin,
    canPromote: uniqueCompleted >= promotionMin,
    calibrationGap: Math.max(0, calibrationMin - uniqueCompleted),
    promotionGap: Math.max(0, promotionMin - uniqueCompleted),
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
