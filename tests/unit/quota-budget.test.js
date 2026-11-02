import { describe, expect, it } from "vitest";
import { buildCentralQuotaPlan, buildQuotaBudget } from "../../scripts/worker/quota-budget.js";

describe("central quota budget", () => {
  it("protects reserve and caps per-run spending", () => {
    expect(buildQuotaBudget("provider", { quota: { remaining: 65 } }, { dailyLimit: 100, reserve: 20, perRun: 30 })).toMatchObject({ spendable: 30, reserve: 20 });
  });

  it("spends nothing for a suspended provider", () => {
    expect(buildQuotaBudget("provider", { configured: true, valid: false, status: "suspended" }, { dailyLimit: 100 })).toMatchObject({ available: false, spendable: 0 });
  });

  it("leest de ruwe providerheaders uit de quota-audit", () => {
    const health = {
      configured: true,
      valid: true,
      status: 200,
      quota: { "x-requests-remaining": "472", "x-requests-used": "28", "x-requests-last": "0" },
    };
    expect(buildQuotaBudget("the-odds-api", health, { reserve: 5, perRun: 8 })).toMatchObject({
      dailyLimit: 500,
      remaining: 472,
      reserve: 5,
      spendable: 8,
      available: true,
      policy: "targeted_only",
    });
  });

  it("beschermt de reserve zodra de headerquota bijna op is", () => {
    expect(
      buildQuotaBudget("provider", { quota: { "x-ratelimit-remaining": "3", "x-ratelimit-limit": "1000" } }, { reserve: 5, perRun: 8 })
    ).toMatchObject({ dailyLimit: 1000, remaining: 3, reserve: 3, spendable: 0, policy: "reserve_protected" });
  });

  it("geeft de odds-provider een echte daglimiet in het centrale plan", () => {
    const plan = buildCentralQuotaPlan({
      oddsApi: { configured: true, valid: true, status: 200, quota: { "x-requests-remaining": "472", "x-requests-used": "28" } },
    });
    expect(plan.providers.oddsApi).toMatchObject({ dailyLimit: 500, remaining: 472, spendable: 8, available: true, policy: "targeted_only" });
  });
});
