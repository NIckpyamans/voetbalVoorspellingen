import { describe, expect, it } from "vitest";
import { mapRawMatch } from "../../services/matchService.ts";

describe("compact match H2H summary", () => {
  it("preserves h2hPlayed while mapping the compact API response", () => {
    const match = mapRawMatch({
      id: "fixture-1",
      date: "2026-08-25",
      league: "Europe - Champions League",
      homeTeamName: "Bodø/Glimt",
      awayTeamName: "NEC Nijmegen",
      h2hPlayed: 1,
      h2hStatus: "previous-leg",
    });

    expect(match.h2hPlayed).toBe(1);
    expect(match.h2hStatus).toBe("previous-leg");
  });
});
