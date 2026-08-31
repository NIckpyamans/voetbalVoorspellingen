export const PROVIDER_RESULT = Object.freeze({
  FOUND: "found",
  NO_COVERAGE: "no_coverage",
  MAPPING_FAILED: "mapping_failed",
  QUOTA: "quota",
  HTTP_ERROR: "http_error",
  NOT_PUBLISHED: "not_published_yet",
  ACCEPTANCE_BLOCKED: "acceptance_blocked",
  NOT_CONFIGURED: "not_configured",
});

export function classifyProviderResult(input = {}) {
  const status = String(input.status || "").toLowerCase();
  const code = Number(input.statusCode || status.match(/http_(\d+)/)?.[1] || 0);
  if (input.found || input.lineup || Number(input.records || 0) > 0) return PROVIDER_RESULT.FOUND;
  if (/acceptance|gate_closed|plan_unavailable|account_or_plan/.test(status)) return PROVIDER_RESULT.ACCEPTANCE_BLOCKED;
  if (/not_configured|missing_key/.test(status)) return PROVIDER_RESULT.NOT_CONFIGURED;
  if (/quota|rate|reserve|local_quota/.test(status) || code === 429) return PROVIDER_RESULT.QUOTA;
  if (/mapping|fixture_id_missing|no_fixture/.test(status) || input.fixtureMapped === false) return PROVIDER_RESULT.MAPPING_FAILED;
  if (code >= 400 || /request_failed|provider_error|http_/.test(status)) return PROVIDER_RESULT.HTTP_ERROR;
  if (/not_published|lineup_unavailable|too_early/.test(status)) return PROVIDER_RESULT.NOT_PUBLISHED;
  return PROVIDER_RESULT.NO_COVERAGE;
}

export function normalizeProviderAttempt(attempt = {}) {
  return { ...attempt, result: classifyProviderResult(attempt) };
}
