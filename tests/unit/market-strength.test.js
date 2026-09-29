import { describe, expect, it } from "vitest";
import { overroundOf, removeVig, buildOverroundProfiles, buildClvTracker } from "../../scripts/worker/market-strength.js";

describe("market strength", () => {
  it("berekent overround (bookmakersmarge) en verwijdert de vig", () => {
    expect(overroundOf(2.0, 3.5, 3.8)).toBeCloseTo(0.0489, 3);
    expect(overroundOf(0, 3.5, 3.8)).toBe(0);
    const fair = removeVig(2.0, 3.5, 3.8);
    expect(fair.home + fair.draw + fair.away).toBeCloseTo(1, 3);
    expect(fair.home).toBeGreaterThan(fair.draw);
  });

  it("bouwt overround-profielen per competitie", () => {
    const profiles = buildOverroundProfiles([
      { league: "Netherlands - Eredivisie", home: 2.0, draw: 3.5, away: 3.8, closingHome: 1.9, closingDraw: 3.6, closingAway: 4.0 },
      { league: "Netherlands - Eredivisie", home: 1.8, draw: 3.6, away: 4.2, closingHome: 1.85, closingDraw: 3.5, closingAway: 4.1 },
      { league: "England - Premier League", home: 2.2, draw: 3.4, away: 3.3 },
    ]);
    const eredivisie = profiles.find((profile) => profile.league === "Netherlands - Eredivisie");
    expect(eredivisie.samples).toBe(2);
    expect(eredivisie.closingSamples).toBe(2);
    expect(eredivisie.avgOverround).toBeGreaterThan(0);
    expect(eredivisie.avgClosingOverround).toBeGreaterThan(0);
    const premier = profiles.find((profile) => profile.league === "England - Premier League");
    expect(premier.closingSamples).toBe(0);
    expect(premier.avgClosingOverround).toBeNull();
  });

  it("blokkeert CLV/ROI-publicatie totdat er 100 timestamped paren zijn", () => {
    const collecting = buildClvTracker(Array.from({ length: 40 }, () => ({ league: "X", roi: 0.1, clv: 0.02 })), { minPairs: 100 });
    expect(collecting.status).toBe("collecting");
    expect(collecting.timestampedPairs).toBe(40);
    expect(collecting.pairGap).toBe(60);
    expect(collecting.avgClv).toBeNull();
    expect(collecting.avgRoi).toBeNull();

    const active = buildClvTracker(Array.from({ length: 120 }, (_, index) => ({ league: index % 2 ? "X" : "Y", roi: 0.1, clv: 0.02 })), { minPairs: 100 });
    expect(active.status).toBe("active");
    expect(active.avgClv).toBeCloseTo(0.02, 4);
    expect(active.avgRoi).toBeCloseTo(0.1, 4);
    expect(active.byLeague).toHaveLength(2);
    expect(active.byLeague[0].pairs).toBe(60);
  });
});
