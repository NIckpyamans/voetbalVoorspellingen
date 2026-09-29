import { describe, expect, it } from "vitest";
import {
  normalizeSquadTeamKey,
  squadQueryVariants,
  providerTeamMatches,
} from "../../scripts/worker/squad-team-matching.js";

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
});
