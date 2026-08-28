import { describe, expect, it } from "vitest";
import { findBestProviderFixture, providerTeamSimilarity } from "../../scripts/worker/provider-fixture-matching.js";

describe("provider fixture matching", () => {
  it.each([
    ["Lillestrom", "Lillestrøm"],
    ["PAOK Salonika", "PAOK Thessaloniki"],
    ["FC Copenhagen", "FC København"],
    ["Sint-Truidense VV", "St.Truiden"],
    ["KS Dynamo Tirana", "FC Dinamo City"],
  ])("maps provider alias %s to %s", (left, right) => {
    expect(providerTeamSimilarity(left, right)).toBeGreaterThanOrEqual(0.94);
  });

  it("links a Sky fixture to the corresponding FotMob fixture within the kickoff tolerance", () => {
    const result = findBestProviderFixture({
      kickoff: "2026-08-27T16:00:00.000Z",
      homeTeamName: "Brann",
      awayTeamName: "PAOK Salonika",
    }, [{
      id: 5988088,
      home: { name: "Brann" },
      away: { name: "PAOK Thessaloniki" },
      status: { utcTime: "2026-08-27T17:00:00.000Z" },
    }]);
    expect(result).toMatchObject({ fixtureId: "5988088", score: 1, kickoffGapHours: 1 });
  });

  it("rejects a similarly named fixture outside the kickoff tolerance", () => {
    const result = findBestProviderFixture({
      kickoff: "2026-08-27T16:00:00.000Z",
      homeTeamName: "Brann",
      awayTeamName: "PAOK Salonika",
    }, [{
      id: 1,
      home: { name: "Brann" },
      away: { name: "PAOK Thessaloniki" },
      status: { utcTime: "2026-08-28T16:00:00.000Z" },
    }]);
    expect(result).toBeNull();
  });
});
