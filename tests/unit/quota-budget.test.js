import { describe, expect, it } from "vitest";
import { buildQuotaBudget } from "../../scripts/worker/quota-budget.js";

describe("central quota budget", () => {
  it("protects reserve and caps per-run spending", () => {
    expect(buildQuotaBudget("provider", { quota: { remaining: 65 } }, { dailyLimit: 100, reserve: 20, perRun: 30 })).toMatchObject({ spendable: 30, reserve: 20 });
  });

  it("spends nothing for a suspended provider", () => {
    expect(buildQuotaBudget("provider", { configured: true, valid: false, status: "suspended" }, { dailyLimit: 100 })).toMatchObject({ available: false, spendable: 0 });
  });
});
