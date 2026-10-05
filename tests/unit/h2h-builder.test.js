import { describe, expect, it } from "vitest";
import { buildH2HAgentProfile } from "../../scripts/worker/h2h.js";

const deps = {
  mergeH2HResultLists: (left, right) => {
    const rows = [...left, ...right];
    return [...new Map(rows.map((row) => [row.id, row])).values()];
  },
  lookupCuratedH2HBackfill: () => null,
  lookupHistoricalH2HBackfill: (profile) => profile?.h2h || null,
  summarizeH2HResults: (results, homeName, awayName, homeId, awayId, status, sameCompetitionPlayed) => ({
    played: results.length,
    homeWins: results.filter((row) => row.winnerId === homeId).length,
    awayWins: results.filter((row) => row.winnerId === awayId).length,
    draws: results.filter((row) => !row.winnerId).length,
    results,
    status,
    sameCompetitionPlayed,
  }),
};

describe("H2H source merger", () => {
  it("deduplicates results and preserves source lineage", () => {
    const profile = buildH2HAgentProfile({
      baseH2H: { status: "live-h2h", results: [{ id: "a", winnerId: "home" }] },
      marketProfile: { h2h: { status: "historical", results: [{ id: "a", winnerId: "home" }, { id: "b" }], sameCompetitionPlayed: 2 } },
      apiFootballProfile: { status: "api-football-h2h", results: [{ id: "c", winnerId: "away" }], played: 1 },
      homeName: "Home",
      awayName: "Away",
      homeId: "home",
      awayId: "away",
    }, deps);
    expect(profile.played).toBe(3);
    expect(profile.sameCompetitionPlayed).toBe(3);
    expect(profile.agent.sources).toEqual(["live-h2h", "historical", "api-football-h2h"]);
    expect(profile.coverage).toBe(0.6);
  });

  it("keeps an unchecked empty profile distinct from missing historical coverage", () => {
    const profile = buildH2HAgentProfile({ homeName: "A", awayName: "B" }, deps);
    expect(profile).toMatchObject({
      played: 0,
      results: [],
      status: "not_checked",
      availabilityStatus: "not_checked",
      source: "h2h-agent",
    });
    expect(profile.asOf).toBeTruthy();
  });

  it("classifies reachable providers with no matching history separately", () => {
    const profile = buildH2HAgentProfile({
      homeName: "A",
      awayName: "B",
      providerAttempts: [{ provider: "espn-team-schedule", status: "not_found" }],
    }, deps);
    expect(profile).toMatchObject({ status: "no_direct_history", availabilityStatus: "no_direct_history" });
  });

  it("surfaces provider outages instead of labelling them as no history", () => {
    const profile = buildH2HAgentProfile({
      homeName: "A",
      awayName: "B",
      providerAttempts: [{ provider: "espn-team-schedule", status: "provider_unreachable" }],
    }, deps);
    expect(profile).toMatchObject({ status: "provider_unreachable", availabilityStatus: "provider_unreachable" });
  });

  it("surfaces acceptance gates instead of labelling them as no history", () => {
    const profile = buildH2HAgentProfile({
      homeName: "A",
      awayName: "B",
      providerAttempts: [{ provider: "api-football", status: "acceptance_gate_closed" }],
    }, deps);
    expect(profile).toMatchObject({ status: "provider_acceptance_blocked", availabilityStatus: "provider_acceptance_blocked" });
  });

  it("does not hide an outage behind another provider's empty coverage", () => {
    const profile = buildH2HAgentProfile({
      homeName: "A",
      awayName: "B",
      providerAttempts: [
        { provider: "api-football", status: "acceptance_gate_closed" },
        { provider: "espn-team-schedule", status: "provider_unreachable" },
      ],
    }, deps);
    expect(profile.status).toBe("provider_unreachable");
  });

  it("preserves explicit available H2H provenance", () => {
    const profile = buildH2HAgentProfile({
      baseH2H: { status: "live-h2h", results: [{ id: "a", winnerId: "home" }] },
      asOf: "2026-10-02T09:00:00Z",
      homeName: "Home",
      awayName: "Away",
      homeId: "home",
      awayId: "away",
    }, deps);
    expect(profile).toMatchObject({ availabilityStatus: "available", played: 1, asOf: "2026-10-02T09:00:00Z" });
  });
});
