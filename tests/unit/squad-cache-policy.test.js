import { describe, expect, it } from "vitest";
import { selectFreshestSquadProfile } from "../../scripts/worker/squad-cache-policy.js";

describe("squad cache policy", () => {
  it("prefers a newer name-key roster over stale provider-id data", () => {
    const stale = { source: "TheSportsDB", fetchedAt: "2026-07-22T08:00:00Z", players: [{ name: "Old Player" }] };
    const current = { source: "FotMob", fetchedAt: "2026-08-25T08:00:00Z", players: [{ name: "Current Player" }] };
    expect(selectFreshestSquadProfile(stale, current)).toBe(current);
  });

  it("does not let a derived recomputation outrank a newer roster check", () => {
    const stale = { fetchedAt: "2026-07-22T08:00:00Z", lastComputedAt: Date.parse("2026-08-25T09:00:00Z") };
    const current = { fetchedAt: "2026-08-25T08:00:00Z", lastComputedAt: Date.parse("2026-08-25T08:01:00Z") };
    expect(selectFreshestSquadProfile(stale, current)).toBe(current);
  });
});
