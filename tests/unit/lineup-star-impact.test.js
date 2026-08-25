import { describe, expect, it } from "vitest";
import { attachConfirmedLineupStarImpact, buildConfirmedLineupStarImpact } from "../../scripts/worker/lineup-star-impact.js";

const squad = {
  source: "FotMob",
  players: [
    { name: "Ster Speler", rating: 8.2 },
    { name: "Goede Keeper", rating: 7.7 },
    { name: "Vaste Middenvelder", rating: 7.4 },
    { name: "Snelle Aanvaller", rating: 7.1 },
  ],
};

function lineup(players, substitutes = []) {
  return { confirmed: true, players: players.map((name) => ({ name })), substitutes: substitutes.map((name) => ({ name })) };
}

describe("confirmed lineup star impact", () => {
  it("penalizes a rated star missing from the matchday squad", () => {
    const result = buildConfirmedLineupStarImpact(
      lineup(["Goede Keeper", "Vaste Middenvelder", "Snelle Aanvaller", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11"]),
      squad,
    );
    expect(result.usable).toBe(true);
    expect(result.missing.map((player) => player.name)).toContain("Ster Speler");
    expect(result.penalty).toBeGreaterThan(0);
  });

  it("uses a smaller penalty when a star is available on the bench", () => {
    const missing = buildConfirmedLineupStarImpact(
      lineup(["Goede Keeper", "Vaste Middenvelder", "Snelle Aanvaller", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11"]),
      squad,
    );
    const benched = buildConfirmedLineupStarImpact(
      lineup(["Goede Keeper", "Vaste Middenvelder", "Snelle Aanvaller", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11"], ["Ster Speler"]),
      squad,
    );
    expect(benched.benched.map((player) => player.name)).toContain("Ster Speler");
    expect(benched.penalty).toBeLessThan(missing.penalty);
  });

  it("attaches a differential only to confirmed lineups", () => {
    const summary = attachConfirmedLineupStarImpact({ confirmed: false }, squad, squad);
    expect(summary.starPlayerImpact).toBeUndefined();
  });
});
