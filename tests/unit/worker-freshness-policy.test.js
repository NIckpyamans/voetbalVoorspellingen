import { describe, expect, it } from "vitest";
import { buildWorkerFreshnessState } from "../../scripts/worker/worker-freshness-policy.js";

describe("worker freshness policy", () => {
  it("dispatches before the 180 minute health limit", () => {
    const now = Date.parse("2026-08-31T12:00:00Z");
    expect(buildWorkerFreshnessState({ lastRun: now - 149 * 60_000 }, { now }).refreshDue).toBe(false);
    expect(buildWorkerFreshnessState({ lastRun: now - 150 * 60_000 }, { now })).toMatchObject({
      refreshDue: true,
      reason: "worker-data-nears-stale-limit",
    });
  });

  it("refreshes when no reliable last run exists", () => {
    expect(buildWorkerFreshnessState({}, { now: "2026-08-31T12:00:00Z" })).toMatchObject({
      refreshDue: true,
      reason: "worker-last-run-unknown",
    });
  });
});
