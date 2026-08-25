import { describe, expect, it } from "vitest";
import { buildClubStrengthProfile, lookupClubEloProfile, parseClubEloSnapshot } from "../../scripts/worker/club-strength.js";

describe("Club strength profile", () => {
  it("parses ClubElo metadata and aliases", () => {
    const snapshot = parseClubEloSnapshot(
      "Rank,Club,Country,Level,Elo,From,To\n12,Ajax,NED,1,1712.42,2026-08-25,2026-08-26",
      { asOf: "2026-08-25", buildPossibleNames: (name) => [name, name.toLowerCase()] }
    );
    expect(lookupClubEloProfile(snapshot, "Ajax", (name) => [name, name.toLowerCase()])).toMatchObject({
      elo: 1712,
      rank: 12,
      country: "NED",
      asOf: "2026-08-25",
    });
  });

  it("combines current squad, Elo and a confirmed lineup transparently", () => {
    const profile = buildClubStrengthProfile({
      clubEloProfile: { elo: 1712, rank: 12, country: "NED", asOf: "2026-08-25" },
      squadProfile: { rating: 74, playerCount: 25, coverage: 1 },
      lineupSide: { avgRating: 7.1, confirmed: true },
    });
    expect(profile.rating).toBeGreaterThan(65);
    expect(profile.quality).toBe("hoog");
    expect(profile.lineupConfirmed).toBe(true);
    expect(profile.uefaCoefficient).toBeNull();
  });
});
