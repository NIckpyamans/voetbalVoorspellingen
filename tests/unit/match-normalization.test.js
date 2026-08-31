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
  });

  it("maps Dutch U21 aliases to Jong teams without merging the first team", () => {
    expect(canonicalDedupeTeam("FC Utrecht U21")).toBe("jong utrecht");
    expect(canonicalDedupeTeam("Jong FC Utrecht")).toBe("jong utrecht");
    expect(canonicalDedupeTeam("Ajax U21")).toBe("jong ajax");
    expect(canonicalDedupeTeam("Ajax")).toBe("ajax");
  });
});
