import { describe, expect, it } from "vitest";
import { dedupeStoredMatches, dedupeStoredPredictions } from "../../scripts/worker/fixture-deduplication.js";

const options = {
  teamKey: (value) => String(value).toLowerCase().replace(/\bfc\b/g, "").replace(/[^a-z0-9]+/g, " ").trim(),
  leagueKey: (value) => String(value).toLowerCase().replace("uefa ", ""),
};

describe("fixture deduplication", () => {
  it("preserves richer H2H when a later provider refresh is empty", () => {
    const rows = dedupeStoredMatches([
      {
        id: "old",
        date: "2026-08-31",
        homeTeamName: "Aston Villa",
        awayTeamName: "Arsenal",
        status: "NS",
        h2h: { played: 5, results: [{ score: "1-2" }], source: "football-data.co.uk" },
      },
      {
        id: "fresh",
        date: "2026-08-31",
        homeTeamName: "Aston Villa",
        awayTeamName: "Arsenal",
        status: "NS",
        h2h: { played: 0, results: [], source: "contract-fallback" },
      },
    ], options);

    expect(rows).toHaveLength(1);
    expect(rows[0].h2h).toMatchObject({ played: 5, source: "football-data.co.uk" });
  });

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

  it("merges a provider duplicate even when one provider assigns the wrong league", () => {
    const rows = dedupeStoredMatches([
      { id: "espn", date: "2026-08-28", league: "Germany - 2. Bundesliga", homeTeamName: "Eintracht Braunschweig", awayTeamName: "Hertha BSC", status: "NS", dataSource: "espn" },
      { id: "openliga", date: "2026-08-28", league: "Germany - Bundesliga", homeTeamName: "Eintracht Braunschweig", awayTeamName: "Hertha BSC", status: "NS", dataSource: "openligadb" },
    ], options);

    expect(rows).toHaveLength(1);
    expect(rows[0].dataSource).toContain("openligadb");
  });

  it("prefers FotMob over Sky for the same unresolved fixture", () => {
    const rows = dedupeStoredMatches([
      { id: "sky", date: "2026-08-27", homeTeamName: "Partizan", awayTeamName: "Getafe", status: "NS", dataSource: "sky-fixture-fallback", homeForm: "WWWWL" },
      { id: "fotmob", date: "2026-08-27", homeTeamName: "Partizan", awayTeamName: "Getafe", status: "NS", dataSource: "fotmob-fixture-fallback", homeForm: "WL" },
    ], options);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "fotmob", homeForm: "WL" });
  });

  it("keeps the prediction generated for the retained canonical fixture", () => {
    const matches = [{ id: "fotmob", date: "2026-08-27", homeTeamName: "Partizan", awayTeamName: "Getafe" }];
    const predictions = dedupeStoredPredictions([
      { matchId: "sky", date: "2026-08-27", homeTeam: "Partizan", awayTeam: "Getafe", homeProb: 0.6, dataSource: "sky-fixture-fallback" },
      { matchId: "fotmob", date: "2026-08-27", homeTeam: "Partizan", awayTeam: "Getafe", homeProb: 0.32, dataSource: "fotmob-fixture-fallback" },
    ], matches, options);

    expect(predictions).toHaveLength(1);
    expect(predictions[0]).toMatchObject({ matchId: "fotmob", homeProb: 0.32 });
  });

  it("retains the richer squad and timestamped odds evidence", () => {
    const players = Array.from({ length: 11 }, (_, index) => ({ id: `p${index}`, name: `Player ${index}` }));
    const rows = dedupeStoredMatches([
      { id: "old", date: "2026-09-01", homeTeamName: "Ajax", awayTeamName: "Twente", homeTeamProfile: { players, playerCount: 11 }, oddsAtPrediction: { home: 2, draw: 3, away: 4, capturedAt: "2026-09-01T10:00:00Z" } },
      { id: "new", date: "2026-09-01", homeTeamName: "Ajax", awayTeamName: "Twente", homeTeamProfile: { players: [] }, oddsAtPrediction: null },
    ], options);
    expect(rows[0].homeTeamProfile.playerCount).toBe(11);
    expect(rows[0].oddsAtPrediction.capturedAt).toBe("2026-09-01T10:00:00Z");
  });
});
