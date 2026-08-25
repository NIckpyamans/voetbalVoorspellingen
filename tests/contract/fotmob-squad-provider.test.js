import { describe, expect, it, vi } from "vitest";
import { fetchFotMobSquad, parseFotMobSquad } from "../../scripts/providers/fotmob-squad-provider.js";

describe("FotMob squad provider", () => {
  const payload = {
    details: { name: "Ajax" },
    squad: { squad: [
      { title: "coach", members: [{ id: 1, name: "Oude Trainer", role: { key: "coach" } }] },
      { title: "keepers", members: [{ id: 2, name: "Test Keeper", rating: 7.2, transferValue: 1000000, positionIdsDesc: "GK" }] },
      { title: "defenders", members: [{ id: 3, name: "Test Defender", rating: 6.8, positionIdsDesc: "CB" }] },
    ] },
  };

  it("excludes staff and preserves ratings and market values", () => {
    const players = parseFotMobSquad(payload);
    expect(players).toHaveLength(2);
    expect(players).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "Oude Trainer" })]));
    expect(players[0]).toEqual(expect.objectContaining({ name: "Test Keeper", rating: 7.2, marketValueEur: 1000000, source: "FotMob" }));
  });

  it("resolves a FotMob team id and returns a current snapshot", async () => {
    const fetchJson = vi.fn().mockResolvedValue(payload);
    const profile = await fetchFotMobSquad({ teamName: "Ajax", teamIds: ["fotmob-8593"], fetchJson });
    expect(profile).toEqual(expect.objectContaining({ providerTeamId: "8593", providerTeamName: "Ajax" }));
    expect(fetchJson).toHaveBeenCalledWith(expect.stringContaining("id=8593"));
  });
});
