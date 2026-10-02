import { describe, expect, it } from "vitest";
import { compactDashboardMatch, h2hAvailabilityLabel, h2hMetadata, h2hSummaryWithSource } from "../../shared/dashboardCompact.js";

describe("compact dashboard match standings positions", () => {
  it("retains home and away competition positions in the compact API payload", () => {
    const compact = compactDashboardMatch({
      id: "fixture-1",
      league: "Europe - Conference League",
      homeTeamName: "TOP Oss",
      awayTeamName: "MVV Maastricht",
      homePos: 20,
      awayPos: 3,
      standingProvisional: true,
      standingCompetition: "Europe - Conference League",
      standingsSourceLabel: "fotmob",
    });

    expect(compact).toMatchObject({
      homePos: 20,
      awayPos: 3,
      standingProvisional: true,
      standingCompetition: "Europe - Conference League",
      standingsSourceLabel: "fotmob",
    });
  });

  it("carries H2H sample size, source, and freshness in compact match metadata", () => {
    const match = {
      id: "fixture-h2h",
      h2h: { played: 3, sameCompetitionPlayed: 2, source: "espn-team-schedule-h2h", asOf: "2026-08-20T10:30:00Z" },
    };
    expect(h2hMetadata(match)).toMatchObject({
      status: "beschikbaar",
      sampleSize: 3,
      sameCompetitionSampleSize: 2,
      source: "espn-team-schedule-h2h",
      updatedAt: "2026-08-20T10:30:00Z",
    });
    expect(compactDashboardMatch(match)).toMatchObject({ h2hPlayed: 3, h2hSource: "espn-team-schedule-h2h", h2hCompetitionPlayed: 2 });
    expect(h2hSummaryWithSource(match)).toContain("3 geldige ontmoetingen");
  });

  it("distinguishes no history from provider outage and blocked sources", () => {
    expect(h2hAvailabilityLabel({ h2hStatus: "no_direct_history" })).toBe("geen ontmoetingen gevonden");
    expect(h2hAvailabilityLabel({ h2hStatus: "provider_unreachable" })).toBe("bron niet bereikbaar");
    expect(h2hAvailabilityLabel({ h2hStatus: "provider_acceptance_blocked" })).toBe("bron uitgeschakeld");
    expect(h2hAvailabilityLabel({ h2hStatus: "acceptance_gate_closed" })).toBe("bron uitgeschakeld");
    expect(h2hAvailabilityLabel({ h2hStatus: "no_coverage" })).toBe("geen ontmoetingen gevonden");
    expect(h2hAvailabilityLabel({ h2hStatus: "not_checked" })).toBe("nog niet gecontroleerd");
    expect(h2hAvailabilityLabel({ h2hStatus: "fetch_unavailable" })).toBe("bron niet bereikbaar");
    expect(compactDashboardMatch({ h2hStatus: "provider_unreachable" }).h2hStatus).toBe("provider_unreachable");
  });

  it("keeps missing ranks null rather than inventing positions", () => {
    const compact = compactDashboardMatch({ id: "fixture-2", homePos: null });
    expect(compact.homePos).toBeNull();
    expect(compact.awayPos).toBeNull();
  });
});
