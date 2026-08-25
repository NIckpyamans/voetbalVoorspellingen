import { describe, expect, it } from "vitest";
import { cacheTimestampMs, shouldRefreshTeamFormCache } from "../../scripts/worker/team-form-cache-policy.js";

const hour = 60 * 60 * 1000;
const now = Date.parse("2026-08-25T08:00:00Z");
const policy = {
  now,
  targetMatches: 10,
  successTtlMs: 12 * hour,
  partialTtlMs: 2 * hour,
  unavailableTtlMs: 2 * hour,
};

describe("team form cache policy", () => {
  it("parses ISO timestamps written by the collector", () => {
    expect(cacheTimestampMs({ updatedAt: "2026-08-25T07:00:00Z" })).toBe(now - hour);
  });

  it("refreshes a partial cache after its short TTL", () => {
    expect(shouldRefreshTeamFormCache({
      ...policy,
      entry: { updatedAt: "2026-08-25T05:00:00Z", data: { recentMatches: [{}] } },
    })).toBe(true);
  });

  it("upgrades a thin local cache immediately when a FotMob ID becomes available", () => {
    expect(shouldRefreshTeamFormCache({
      ...policy,
      hasFotmobTarget: true,
      entry: { updatedAt: "2026-08-25T07:59:00Z", data: { source: "local-finished-results", recentMatches: [{}] } },
    })).toBe(true);
  });
});
