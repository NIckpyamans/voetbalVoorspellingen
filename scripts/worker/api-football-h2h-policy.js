const MAX_H2H_PAIRS_PER_RUN = 5;

/** H2H readiness is intentionally independent of the UEFA/friendly fixture acceptance report. */
export function buildApiFootballH2HPolicy({ configured, enabledSetting = "true", maxPairsPerRun = 3 } = {}) {
  const enabledByOperator = String(enabledSetting).toLowerCase() !== "false";
  const configuredLimit = Number(maxPairsPerRun);
  const pairLimit = Math.min(MAX_H2H_PAIRS_PER_RUN, Math.max(1, Number.isFinite(configuredLimit) ? Math.floor(configuredLimit) : 3));
  const providerConfigured = Boolean(configured);
  const enabled = providerConfigured && enabledByOperator;
  return {
    configured: providerConfigured,
    enabled,
    enabledByOperator,
    pairLimit,
    gate: !providerConfigured ? "provider_not_configured" : !enabledByOperator ? "disabled_by_operator" : "h2h_enabled_independent_of_fixture_acceptance",
  };
}
