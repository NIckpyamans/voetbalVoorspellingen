import { describe, expect, it } from "vitest";
import {
  normalizeSquadTeamKey,
  squadQueryVariants,
  providerTeamMatches,
  suggestAliasCandidates,
  canonicalizeSquadCache,
} from "../../scripts/worker/squad-team-matching.js";
import { canonicalDedupeTeam } from "../../shared/matchNormalization.js";

describe("squad team matching", () => {
  it("normaliseert clubvoorvoegsels en diacritics weg", () => {
    expect(normalizeSquadTeamKey("FC Drita")).toBe("drita");
    expect(normalizeSquadTeamKey("KF Drita")).toBe("drita");
    expect(normalizeSquadTeamKey("Qarabağ")).toBe("qarabag");
    expect(normalizeSquadTeamKey("FK Qarabag")).toBe("qarabag");
  });

  it("combineert Drita Gjilan, FC Drita, KF Drita en Drita als provideraliassen", () => {
    for (const name of ["Drita Gjilan", "FC Drita", "KF Drita", "Drita"]) {
      const variants = squadQueryVariants(name);
      expect(variants).toContain("Drita");
      expect(variants).toContain("FC Drita");
      expect(variants).toContain("KF Drita");
      expect(variants.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("combineert Qarabag-spellingen en Karabakh-transliteratie", () => {
    for (const name of ["FK Qarabag", "Qarabağ", "Qarabag FK", "Qarabag Agdam", "Karabakh Agdam"]) {
      const variants = squadQueryVariants(name);
      expect(variants.some((variant) => /qarabag/i.test(variant))).toBe(true);
      expect(variants.some((variant) => /karabakh/i.test(variant))).toBe(true);
    }
  });

  it("matcht providernamen los over voorvoegsels heen", () => {
    expect(providerTeamMatches("FC Drita", "Drita")).toBe(true);
    expect(providerTeamMatches("FC Drita", "KF Drita")).toBe(true);
    expect(providerTeamMatches("Qarabag FK", "FK Qarabag")).toBe(true);
    expect(providerTeamMatches("FC Drita", "Drita Gjilan")).toBe(false);
  });

  it("matcht niet op substrings zodat Tokyo != Tokyo Verdy", () => {
    expect(providerTeamMatches("Tokyo Verdy", "Tokyo")).toBe(false);
    expect(providerTeamMatches("Tokyo", "Tokyo Verdy")).toBe(false);
    expect(providerTeamMatches("", "")).toBe(false);
  });

  it("stelt kandidaat-aliassen voor uit provider-zoekresultaten", () => {
    const suggestions = suggestAliasCandidates(["FC Drita", "Dinamo City", "Drita Gjilan", "KF Drita"], "Drita Gjilan");
    expect(suggestions.map((item) => item.name)).toEqual(["FC Drita", "KF Drita"]);
    expect(suggestions[0].score).toBe(1);
  });

  it("canonicaliseert dubbele squad-cache-sleutels zonder informatie te verliezen", () => {
    const cache = {
      "name:drita gjilan": {
        teamName: "Drita Gjilan",
        players: [{ name: "A" }, { name: "B" }],
        playerCount: 2,
        fetchedAt: "2026-09-28T10:00:00.000Z",
        sourceIds: { fotmob: "111" },
      },
      "name:drita": {
        teamName: "Drita",
        players: [{ name: "A" }, { name: "B" }, { name: "C" }],
        playerCount: 3,
        fetchedAt: "2026-09-28T12:00:00.000Z",
        sourceIds: { theSportsDb: "222" },
      },
      "name:ajax": { teamName: "Ajax", players: [{ name: "X" }], playerCount: 1 },
    };
    const result = canonicalizeSquadCache(cache, { canonicalOf: canonicalDedupeTeam });
    expect(result.mergedGroups).toBe(1);
    expect(result.mergedKeys).toBe(1);
    expect(cache["name:drita gjilan"].canonicalTeamName).toBe("Drita");
    expect(cache["name:drita gjilan"].players).toHaveLength(3);
    expect(cache["name:drita gjilan"].sourceIds).toEqual({ fotmob: "111", theSportsDb: "222" });
    expect(cache["name:drita"].duplicateKeys).toEqual(["name:drita gjilan", "name:drita"]);
    expect(cache["name:ajax"].canonicalKey).toBeUndefined();
  });
});
