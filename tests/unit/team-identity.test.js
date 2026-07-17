import { describe, expect, it } from "vitest";
import { buildTeamIdentity, getKnownProviderIds, normalizeTeamIdentityName } from "../../scripts/worker/team-identity.js";

describe("team identity provider mapping", () => {
  const index = new Map([
    ["ajax amsterdam", { espn: "123", apiFootball: "456" }],
    ["psv eindhoven", { sportmonks: "789" }],
  ]);

  it("normalizes aliases and returns only configured provider IDs", () => {
    expect(normalizeTeamIdentityName("Ajax  Amsterdam")).toBe("ajax amsterdam");
    expect(getKnownProviderIds("Ajax Amsterdam", { index })).toEqual({ espn: "123", apiFootball: "456" });
    expect(getKnownProviderIds("Unknown FC", { index })).toEqual({});
  });

  it("keeps canonical fixture IDs separate from provider IDs", () => {
    const identity = buildTeamIdentity("fixture-home", "fixture-away", "Ajax Amsterdam", "PSV Eindhoven", "espn", { index });
    expect(identity.status).toBe("provider_ids");
    expect(identity.home.id).toBe("fixture-home");
    expect(identity.home.providerIds.apiFootball).toBe("456");
    expect(identity.away.providerIds.sportmonks).toBe("789");
  });
});
