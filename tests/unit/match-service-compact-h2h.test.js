import { describe, expect, it } from "vitest";
import { mapRawMatch, resolveMatchPredictionH2H } from "../../services/matchService.ts";
import { synchronizeMatchPredictionH2H } from "../../shared/h2hProvenance.js";

describe("compact match H2H summary", () => {
  it("synchronizes compact API H2H provenance on the paired client prediction", () => {
    const match = mapRawMatch({
      id: "fixture-mismatch",
      date: "2026-10-03",
      homeTeamName: "Almere City",
      awayTeamName: "FC Volendam",
      h2h: {
        played: 4,
        results: [{ score: "1-0" }, { score: "0-0" }, { score: "2-1" }, { score: "1-1" }],
        status: "historical-competition",
        source: "football-data.co.uk",
        asOf: "2026-10-02T11:00:00.000Z",
      },
      h2hStatus: "h2h-agent-empty",
      h2hAvailability: "nog niet gecontroleerd",
      h2hSource: "contract-fallback",
    });
    const prediction = resolveMatchPredictionH2H(match, {
      matchId: match.id,
      h2h: { played: 0, status: "provider_acceptance_blocked", availabilityStatus: "provider_acceptance_blocked" },
      h2hStatus: "provider_acceptance_blocked",
      h2hAvailability: "provider_acceptance_blocked",
    });

    expect(prediction).toMatchObject({
      h2h: { played: 4, status: "historical-competition", source: "football-data.co.uk" },
      h2hStatus: "historical-competition",
      h2hAvailability: "beschikbaar",
      h2hSource: "football-data.co.uk",
      h2hPlayed: 4,
    });
  });

  it("preserves h2hPlayed while mapping the compact API response", () => {
    const match = mapRawMatch({
      id: "fixture-1",
      date: "2026-08-25",
      league: "Europe - Champions League",
      homeTeamName: "Bodø/Glimt",
      awayTeamName: "NEC Nijmegen",
      h2hPlayed: 1,
      h2hStatus: "previous-leg",
      h2hAvailability: "beschikbaar",
      h2hSource: "espn-team-schedule-h2h",
      h2hAsOf: "2026-08-24T10:00:00Z",
      h2hCompetitionPlayed: 1,
    });

    expect(match.h2hPlayed).toBe(1);
    expect(match.h2hStatus).toBe("previous-leg");
    expect(match.h2hAvailability).toBe("beschikbaar");
    expect(match.h2hSource).toBe("espn-team-schedule-h2h");
    expect(match.h2hAsOf).toBe("2026-08-24T10:00:00Z");
    expect(match.h2hCompetitionPlayed).toBe(1);
  });
});
