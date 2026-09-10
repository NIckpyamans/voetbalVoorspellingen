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

  it("does not mislabel a form-derived squad score as measured club strength", () => {
    const profile = buildClubStrengthProfile({ squadProfile: { rating: 90, playerCount: 25, coverage: 1 } });
    expect(profile.rating).toBeNull();
    expect(profile.quality).toBe("laag");
  });
});
