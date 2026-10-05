import { describe, expect, it } from "vitest";
import { buildH2HAttemptState, isH2HAttemptDue, summarizeProviderMetrics } from "../../scripts/worker/h2h-backfill-ledger.js";
import { PROVIDER_RESULT } from "../../scripts/worker/provider-observability.js";

describe("H2H attempt ledger", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");

  it("schedules transient errors with capped exponential backoff", () => {
    const first = buildH2HAttemptState(null, { status: "error", result: PROVIDER_RESULT.HTTP_ERROR, checkedAt: new Date(now).toISOString() });
    const second = buildH2HAttemptState(first, { status: "error", result: PROVIDER_RESULT.HTTP_ERROR, checkedAt: first.checkedAt });
    expect(first).toMatchObject({ attempts: 1, backoffHours: 1 });
    expect(isH2HAttemptDue(first, { now: now + 30 * 60 * 1000 })).toBe(false);
    expect(isH2HAttemptDue(first, { now: now + 59 * 60 * 1000 })).toBe(false);
    expect(isH2HAttemptDue(first, { now: now + 60 * 60 * 1000 })).toBe(true);
    expect(second.backoffHours).toBe(2);
  });

  it("uses the configured freshness interval for confirmed no-history and stops filled retries", () => {
    const empty = buildH2HAttemptState(null, { status: "no_direct_history", result: PROVIDER_RESULT.NO_COVERAGE, checkedAt: new Date(now).toISOString() });
    expect(isH2HAttemptDue(empty, { now: now + 23 * 60 * 60 * 1000, staleDays: 1 })).toBe(false);
    expect(isH2HAttemptDue(empty, { now: now + 24 * 60 * 60 * 1000, staleDays: 1 })).toBe(true);
    const filled = buildH2HAttemptState(null, { status: "filled", result: PROVIDER_RESULT.FOUND });
    expect(isH2HAttemptDue(filled)).toBe(false);
  });

  it("aggregates provider outcomes and latency for reporting", () => {
    expect(summarizeProviderMetrics([
      { provider: "espn", result: PROVIDER_RESULT.FOUND, durationMs: 100 },
      { provider: "espn", result: PROVIDER_RESULT.QUOTA, durationMs: 300 },
    ]).espn).toMatchObject({ attempts: 2, found: 1, quota: 1, successRate: 0.5, averageLatencyMs: 200 });
  });
});
