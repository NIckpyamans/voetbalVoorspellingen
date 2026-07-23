import { describe, expect, it } from "vitest";
import { dedupeStoredMatches, dedupeStoredPredictions } from "../../scripts/worker/fixture-deduplication.js";

const options = {
  teamKey: (value) => String(value).toLowerCase().replace(/\bfc\b/g, "").replace(/[^a-z0-9]+/g, " ").trim(),
  leagueKey: (value) => String(value).toLowerCase().replace("uefa ", ""),
};

describe("fixture deduplication", () => {
  it("keeps the completed, scored fixture and merges source metadata", () => {
    const rows = dedupeStoredMatches([
      { id: "a", date: "2026-07-23", league: "UEFA Europa", homeTeamName: "FC Ajax", awayTeamName: "Twente", status: "NS", dataSource: "bbc" },
      { id: "b", date: "2026-07-23", league: "Europa", homeTeamName: "Ajax", awayTeamName: "FC Twente", status: "FT", homeScore: 2, awayScore: 1, dataSource: "espn" },
    ], options);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "b", status: "FT", homeScore: 2, awayScore: 1 });
    expect(rows[0].dataSource).toContain("bbc");
  });

  it("points predictions at the retained canonical fixture", () => {
    const matches = [{ id: "b", date: "2026-07-23", league: "Europa", homeTeamName: "Ajax", awayTeamName: "Twente" }];
    const predictions = dedupeStoredPredictions([
      { matchId: "a", date: "2026-07-23", league: "UEFA Europa", homeTeam: "FC Ajax", awayTeam: "FC Twente" },
      { matchId: "b", date: "2026-07-23", league: "Europa", homeTeam: "Ajax", awayTeam: "Twente" },
    ], matches, options);
    expect(predictions).toHaveLength(1);
    expect(predictions[0].matchId).toBe("b");
  });
});
