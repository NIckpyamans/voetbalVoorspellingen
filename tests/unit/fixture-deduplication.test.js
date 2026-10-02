import { describe, expect, it } from "vitest";
import { dedupeStoredMatches, dedupeStoredPredictions, h2hProvenanceRank } from "../../scripts/worker/fixture-deduplication.js";

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

  it("lets a fresh provider verdict replace a stale contract-fallback stub", () => {
    const rows = dedupeStoredMatches([
      {
        id: "stored",
        date: "2026-10-03",
        homeTeamName: "Ajax",
        awayTeamName: "Twente",
        status: "NS",
        dataSource: "espn+fotmob",
        h2h: { played: 0, results: [], status: "h2h-agent-empty", source: "contract-fallback" },
        h2hStatus: "h2h-agent-empty",
      },
      {
        id: "fresh",
        date: "2026-10-03",
        homeTeamName: "Ajax",
        awayTeamName: "Twente",
        status: "NS",
        dataSource: "espn+fotmob",
        h2h: {
          played: 0,
          results: [],
          status: "provider_acceptance_blocked",
          availabilityStatus: "provider_acceptance_blocked",
          source: "api-football, espn-team-schedule",
          asOf: "2026-10-02T11:55:42.000Z",
        },
        h2hStatus: "provider_acceptance_blocked",
        h2hSource: "api-football, espn-team-schedule",
        h2hAsOf: "2026-10-02T11:55:42.000Z",
        h2hAvailability: "provider_acceptance_blocked",
        h2hPlayed: 0,
        h2hCompetitionPlayed: 0,
      },
    ], options);

    expect(rows).toHaveLength(1);
    expect(rows[0].h2h).toMatchObject({
      status: "provider_acceptance_blocked",
      availabilityStatus: "provider_acceptance_blocked",
      source: "api-football, espn-team-schedule",
    });
    expect(rows[0]).toMatchObject({
      h2hStatus: "provider_acceptance_blocked",
      h2hSource: "api-football, espn-team-schedule",
      h2hAsOf: "2026-10-02T11:55:42.000Z",
      h2hAvailability: "provider_acceptance_blocked",
    });
  });

  it("keeps the newest verdict when neither side found meetings", () => {
    const rows = dedupeStoredMatches([
      {
        id: "stored",
        date: "2026-10-03",
        homeTeamName: "Ajax",
        awayTeamName: "Twente",
        h2h: { played: 0, status: "no_direct_history", availabilityStatus: "no_direct_history", asOf: "2026-10-01T09:00:00.000Z" },
        h2hStatus: "no_direct_history",
      },
      {
        id: "fresh",
        date: "2026-10-03",
        homeTeamName: "Ajax",
        awayTeamName: "Twente",
        h2h: { played: 0, status: "provider_unreachable", availabilityStatus: "provider_unreachable", asOf: "2026-10-02T09:00:00.000Z" },
        h2hStatus: "provider_unreachable",
      },
    ], options);

    expect(rows[0].h2h?.status).toBe("provider_unreachable");
    expect(rows[0].h2hStatus).toBe("provider_unreachable");
  });

  it("never lets an empty fresh verdict downgrade a stored head-to-head", () => {
    const rows = dedupeStoredMatches([
      {
        id: "stored",
        date: "2026-10-03",
        homeTeamName: "Ajax",
        awayTeamName: "Twente",
        h2h: { played: 3, results: [{ score: "1-2" }], status: "previous-leg", availabilityStatus: "available", asOf: "2026-10-01T09:00:00.000Z" },
        h2hStatus: "previous-leg",
        h2hPlayed: 3,
      },
      {
        id: "fresh",
        date: "2026-10-03",
        homeTeamName: "Ajax",
        awayTeamName: "Twente",
        h2h: { played: 0, results: [], status: "provider_unreachable", availabilityStatus: "provider_unreachable", asOf: "2026-10-02T09:00:00.000Z" },
        h2hStatus: "provider_unreachable",
        h2hPlayed: 0,
      },
    ], options);

    expect(rows[0].h2h).toMatchObject({ played: 3, status: "previous-leg" });
    expect(rows[0].h2hStatus).toBe("previous-leg");
    expect(rows[0].h2hPlayed).toBe(3);
  });

  it("ranks explicit availability verdicts above legacy stubs", () => {
    const legacy = { played: 0, status: "h2h-agent-empty", source: "contract-fallback" };
    const blocked = { played: 0, status: "provider_acceptance_blocked", availabilityStatus: "provider_acceptance_blocked", asOf: "2026-10-02T09:00:00.000Z" };
    expect(h2hProvenanceRank(blocked)).toBeGreaterThan(h2hProvenanceRank(legacy));
    expect(h2hProvenanceRank({ played: 1, status: "previous-leg", availabilityStatus: "available" })).toBeGreaterThan(h2hProvenanceRank(blocked));
    expect(h2hProvenanceRank(null)).toBeLessThan(h2hProvenanceRank(legacy));
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
