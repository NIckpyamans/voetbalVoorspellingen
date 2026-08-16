import { describe, expect, it } from "vitest";
import { normalizeFotMob } from "../../scripts/providers/lineup-normalizers.js";

function players(prefix, count = 11) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    name: `${prefix} Player ${index}`,
    usualPlayingPositionId: index === 0 ? 0 : 1,
    shirtNumber: index + 1,
    performance: { rating: 6.5 + index / 10 },
  }));
}

describe("FotMob lineup normalizer", () => {
  it("accepts complete standard lineups as confirmed", () => {
    const lineup = normalizeFotMob({ content: { lineup: {
      lineupType: "standard",
      homeTeam: { formation: "4-3-3", starters: players("Home"), subs: [], unavailable: [] },
      awayTeam: { formation: "4-4-2", starters: players("Away"), subs: [], unavailable: [] },
    } } });
    expect(lineup).toMatchObject({ confirmed: true, projected: false, source: "FotMob confirmed lineups" });
    expect(lineup.home.players).toHaveLength(11);
    expect(lineup.home.avgRating).toBeGreaterThan(0);
  });

  it("keeps predicted lineups out of confirmed coverage", () => {
    const lineup = normalizeFotMob({ content: { lineup: {
      lineupType: "predicted",
      homeTeam: { starters: players("Home"), subs: [] },
      awayTeam: { starters: players("Away"), subs: [] },
    } } });
    expect(lineup).toMatchObject({ confirmed: false, projected: true, source: "FotMob projected lineups" });
  });
});
