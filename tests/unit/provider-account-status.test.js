import { describe, expect, it } from "vitest";
import { interpretApiFootballStatus } from "../../scripts/worker/provider-account-status.js";

describe("API-Football account status", () => {
  it("rejects a HTTP 200 response when the provider reports a suspended account", () => {
    const result = interpretApiFootballStatus(true, { errors: { access: "Your account is suspended" }, response: [] });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toContain("suspended");
  });

  it("requires an active plan and positive daily allowance", () => {
    const result = interpretApiFootballStatus(true, {
      errors: [],
      response: { subscription: { plan: "Pro", end: "2027-01-01" }, requests: { current: 12, limit_day: 7500 } },
    });
    expect(result.valid).toBe(true);
    expect(result.requests.remaining).toBe(7488);
  });
});
