import { afterEach, describe, expect, it } from "vitest";
import { oddsQuotaFloor, oddsQuotaStopThreshold } from "../../scripts/odds-provider.js";

const previous = {
  regular: process.env.ODDS_API_MIN_REMAINING,
  critical: process.env.ODDS_API_CRITICAL_MIN_REMAINING,
  cost: process.env.ODDS_API_REQUEST_COST_RESERVE,
};

afterEach(() => {
  if (previous.regular == null) delete process.env.ODDS_API_MIN_REMAINING;
  else process.env.ODDS_API_MIN_REMAINING = previous.regular;
  if (previous.critical == null) delete process.env.ODDS_API_CRITICAL_MIN_REMAINING;
  else process.env.ODDS_API_CRITICAL_MIN_REMAINING = previous.critical;
  if (previous.cost == null) delete process.env.ODDS_API_REQUEST_COST_RESERVE;
  else process.env.ODDS_API_REQUEST_COST_RESERVE = previous.cost;
});

describe("odds quota floors", () => {
  it("protects a separate reserve for closing captures", () => {
    process.env.ODDS_API_MIN_REMAINING = "50";
    process.env.ODDS_API_CRITICAL_MIN_REMAINING = "10";
    expect(oddsQuotaFloor()).toBe(50);
    expect(oddsQuotaFloor({ allowQuotaReserve: true })).toBe(10);
  });

  it("never makes the critical floor stricter than the regular floor", () => {
    process.env.ODDS_API_MIN_REMAINING = "20";
    process.env.ODDS_API_CRITICAL_MIN_REMAINING = "30";
    expect(oddsQuotaFloor({ allowQuotaReserve: true })).toBe(20);
  });

  it("reserves the estimated request cost before crossing a quota floor", () => {
    process.env.ODDS_API_MIN_REMAINING = "50";
    process.env.ODDS_API_CRITICAL_MIN_REMAINING = "10";
    process.env.ODDS_API_REQUEST_COST_RESERVE = "10";
    expect(oddsQuotaStopThreshold()).toBe(60);
    expect(oddsQuotaStopThreshold({ allowQuotaReserve: true })).toBe(20);
  });
});
