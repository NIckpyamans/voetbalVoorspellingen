import { describe, expect, it } from "vitest";
import { buildProviderCooldown } from "../../scripts/worker/provider-quota.js";

describe("provider quota cooldown", () => {
  const report = {
    generatedAt: "2026-07-23T10:00:00.000Z",
    apiFootball: {
      lastCheckedAt: "2026-07-23T10:00:00.000Z",
      lastStatusCode: 429,
      errorCategories: { quota_or_rate_limit: 15, http_403: 1 },
    },
  };

  it("suppresses scheduled retries during the cooldown", () => {
    expect(buildProviderCooldown(report, { now: "2026-07-23T16:00:00.000Z" })).toMatchObject({
      active: true,
      blockedRequests: 16,
      remainingHours: 6,
    });
  });

  it("releases scheduled retries after the cooldown", () => {
    expect(buildProviderCooldown(report, { now: "2026-07-23T23:00:00.000Z" })).toMatchObject({
      active: false,
      remainingHours: 0,
    });
  });
});
