import { PROVIDER_RESULT } from "./provider-observability.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_RESULTS = new Set([PROVIDER_RESULT.QUOTA, PROVIDER_RESULT.HTTP_ERROR]);

export function isH2HAttemptDue(attempt, { now = Date.now(), staleDays = 1 } = {}) {
  if (!attempt) return true;
  const status = String(attempt.status || "").toLowerCase();
  if (status === "filled") return false;
  const nextRetryAt = Date.parse(attempt.nextRetryAt || "");
  if (Number.isFinite(nextRetryAt)) return now >= nextRetryAt;
  const checkedAt = Date.parse(attempt.checkedAt || "");
  if (!Number.isFinite(checkedAt)) return true;
  const transient = TRANSIENT_RESULTS.has(attempt.result) || ["provider_unreachable", "error"].includes(status);
  const cooldown = transient ? Math.max(0, Number(attempt.backoffHours || 0)) * 60 * 60 * 1000
    : status === "no_direct_history" ? Math.max(0, Number(staleDays)) * DAY_MS : 0;
  return now - checkedAt >= cooldown;
}

export function buildH2HAttemptState(previous, { status, result, error = null, checkedAt = new Date().toISOString(), maxBackoffHours = 24 } = {}) {
  const previousAttempts = Number(previous?.attempts || 0);
  const attempts = Math.max(0, Number.isFinite(previousAttempts) ? previousAttempts : 0) + 1;
  const normalizedStatus = String(status || "error").toLowerCase();
  const transient = TRANSIENT_RESULTS.has(result) || ["provider_unreachable", "error"].includes(normalizedStatus);
  const configuredMaxBackoff = Number(maxBackoffHours);
  const backoffHours = transient ? Math.min(Math.max(1, Number.isFinite(configuredMaxBackoff) ? configuredMaxBackoff : 24), 2 ** Math.min(attempts - 1, 12)) : 0;
  const parsedTimestamp = Date.parse(checkedAt);
  const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now();
  return {
    attempts,
    checkedAt: new Date(timestamp).toISOString(),
    status: String(status || "error"),
    result: String(result || "unknown"),
    error: error ? String(error).slice(0, 500) : null,
    nextRetryAt: backoffHours ? new Date(timestamp + backoffHours * 60 * 60 * 1000).toISOString() : null,
    backoffHours,
  };
}

export function summarizeProviderMetrics(attempts = []) {
  const metrics = {};
  for (const attempt of attempts) {
    const provider = String(attempt?.provider || "unknown");
    const metric = metrics[provider] || (metrics[provider] = {
      attempts: 0,
      found: 0,
      noCoverage: 0,
      mappingFailed: 0,
      quota: 0,
      errors: 0,
      acceptanceBlocked: 0,
      latencyMsTotal: 0,
      latencySamples: 0,
    });
    metric.attempts += 1;
    if (attempt.result === PROVIDER_RESULT.FOUND) metric.found += 1;
    else if (attempt.result === PROVIDER_RESULT.NO_COVERAGE) metric.noCoverage += 1;
    else if (attempt.result === PROVIDER_RESULT.MAPPING_FAILED) metric.mappingFailed += 1;
    else if (attempt.result === PROVIDER_RESULT.QUOTA) metric.quota += 1;
    else if (attempt.result === PROVIDER_RESULT.HTTP_ERROR) metric.errors += 1;
    else if ([PROVIDER_RESULT.ACCEPTANCE_BLOCKED, PROVIDER_RESULT.NOT_CONFIGURED].includes(attempt.result)) metric.acceptanceBlocked += 1;
    const latency = Number(attempt.durationMs);
    const remaining = Number(attempt.quota?.remaining);
    const quotaLimit = Number(attempt.quota?.limit);
    if (Number.isFinite(remaining)) metric.quotaRemaining = remaining;
    if (Number.isFinite(quotaLimit)) metric.quotaLimit = quotaLimit;
    if (attempt.quota?.resetAt) metric.quotaResetAt = attempt.quota.resetAt;
    if (Number.isFinite(latency) && latency >= 0) {
      metric.latencyMsTotal += latency;
      metric.latencySamples += 1;
    }
  }
  return Object.fromEntries(Object.entries(metrics).map(([provider, metric]) => [provider, {
    ...metric,
    successRate: metric.attempts ? Number((metric.found / metric.attempts).toFixed(3)) : 0,
    averageLatencyMs: metric.latencySamples ? Math.round(metric.latencyMsTotal / metric.latencySamples) : null,
  }]));
}
