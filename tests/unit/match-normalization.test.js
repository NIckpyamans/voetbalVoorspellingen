import { describe, expect, it } from "vitest";
import { canonicalDedupeTeam, mergeDuplicateServedMatches } from "../../shared/matchNormalization.js";

describe("match normalization", () => {
  it("merges Rapid Wien versus Hearts aliases into one fixture", () => {
    expect(canonicalDedupeTeam("SK Rapid Wien")).toBe(canonicalDedupeTeam("Rapid Wien"));
    expect(canonicalDedupeTeam("Hearts")).toBe(canonicalDedupeTeam("Heart of Midlothian"));

    const matches = mergeDuplicateServedMatches([
      {
        id: "sky",
        date: "2026-08-26",
        league: "Europe - Conference League",
        homeTeamName: "SK Rapid Wien",
        awayTeamName: "Hearts",
        status: "FT",
        score: "2-2",
      },
      {
        id: "fotmob",
        date: "2026-08-26",
        league: "Europe - Conference League",
        homeTeamName: "Rapid Wien",
        awayTeamName: "Heart of Midlothian",
        status: "FT",
        score: "2-2",
      },
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0].score).toBe("2-2");
  });  it("uses canonical team IDs from the stable alias map before merging pair keys", () => {
    expect(canonicalDedupeTeam("NEC Nijmegen")).toBe("nec nijmegen");
    expect(canonicalDedupeTeam("Ajax")).toBe("ajax");
  });

  it("keeps served match H2H profile and flat provenance in sync after dedupe", () => {
    const matches = mergeDuplicateServedMatches([
      {
        id: "stored",
        date: "2026-10-03",
        league: "Netherlands - Eredivisie",
        homeTeamName: "Almere City",
        awayTeamName: "FC Volendam",
        h2h: {
          played: 3,
          results: [{ score: "1-0" }, { score: "0-0" }, { score: "2-1" }],
          status: "historical-competition",
          source: "football-data.co.uk historical results",
          asOf: "2026-10-02T11:41:17.596Z",
        },
        h2hStatus: "h2h-agent-empty",
        h2hAvailability: "nog niet gecontroleerd",
        h2hSource: "contract-fallback",
      },
      {
        id: "fresh",
        date: "2026-10-03",
        league: "Netherlands - Eredivisie",
        homeTeamName: "Almere City",
        awayTeamName: "FC Volendam",
        h2h: {
          played: 0,
          results: [],
          status: "provider_acceptance_blocked",
          availabilityStatus: "provider_acceptance_blocked",
          source: "api-football",
          asOf: "2026-10-02T12:00:00.000Z",
        },
        h2hStatus: "provider_acceptance_blocked",
        h2hAvailability: "provider_acceptance_blocked",
        h2hSource: "api-football",
      },
    ]);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      h2h: { played: 3, status: "historical-competition" },
      h2hStatus: "historical-competition",
      h2hAvailability: "beschikbaar",
      h2hSource: "football-data.co.uk historical results",
      h2hPlayed: 3,
    });
  });

  it("keeps Europa-, Conference- and Cup-phases of the same club pair as separate fixtures", () => {
    const sameClubsDifferentPhase = [
      { id: "el", date: "2026-10-15", league: "Europe - Europa League", homeTeamName: "AZ Alkmaar", awayTeamName: "Hapoel Beer Sheva" },
      { id: "ecl", date: "2026-10-15", league: "Europe - Conference League", homeTeamName: "AZ Alkmaar", awayTeamName: "Hapoel Beer Sheva" },
    ];
    expect(mergeDuplicateServedMatches(sameClubsDifferentPhase)).toHaveLength(2);
  });

  it("maps Dutch U21 aliases to Jong teams without merging the first team", () => {
    expect(canonicalDedupeTeam("FC Utrecht U21")).toBe("jong utrecht");
    expect(canonicalDedupeTeam("Jong FC Utrecht")).toBe("jong utrecht");
    expect(canonicalDedupeTeam("Ajax U21")).toBe("jong ajax");
    expect(canonicalDedupeTeam("Ajax")).toBe("ajax");
  });
});
