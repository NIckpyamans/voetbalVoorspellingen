import { describe, expect, it } from "vitest";
import { buildApiFootballH2HPolicy } from "../../scripts/worker/api-football-h2h-policy.js";

describe("API-Football H2H provider policy", () => {
  it("does not consume or depend on the UEFA/friendly fixture acceptance report", () => {
    expect(buildApiFootballH2HPolicy({ configured: true, enabledSetting: "true", maxPairsPerRun: 3 })).toEqual({
      configured: true,
      enabled: true,
      enabledByOperator: true,
      pairLimit: 3,
      gate: "h2h_enabled_independent_of_fixture_acceptance",
    });
  });

  it("hard-caps requests even if the environment asks for an unsafe budget", () => {
    expect(buildApiFootballH2HPolicy({ configured: true, maxPairsPerRun: 500 }).pairLimit).toBe(5);
    expect(buildApiFootballH2HPolicy({ configured: true, maxPairsPerRun: 0 }).pairLimit).toBe(1);
  });

  it("respects operator disablement and missing credentials", () => {
    expect(buildApiFootballH2HPolicy({ configured: true, enabledSetting: "false" }).gate).toBe("disabled_by_operator");
    expect(buildApiFootballH2HPolicy({ configured: false }).gate).toBe("provider_not_configured");
  });
});
