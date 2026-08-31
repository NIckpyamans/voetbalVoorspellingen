import { describe, expect, it } from "vitest";
import { evaluateEnrichmentPublication, preserveEnrichmentEvidence } from "../../scripts/worker/enrichment-publication-gate.js";

function match(id, overrides = {}) {
  return {
    id,
    status: "NS",
    h2h: { played: 2 },
    homeRecent: { gamesPlayed: 10 },
    awayRecent: { gamesPlayed: 10 },
    ...overrides,
  };
}

describe("enrichment publication gate", () => {
  it("blocks loss of existing H2H and form evidence", () => {
    const before = [match("1"), match("2"), match("3")];
    const after = before.map((row) => ({ ...row, h2h: { played: 0 }, homeRecent: null, awayRecent: null }));
    expect(evaluateEnrichmentPublication(before, after).regressions.map((row) => row.field)).toEqual(expect.arrayContaining(["h2h", "form"]));
  });

  it("allows new incomplete fixtures without deleting existing evidence", () => {
    const before = [match("1"), match("2"), match("3")];
    const after = [...before, ...Array.from({ length: 7 }, (_, index) => match(`new-${index}`, { h2h: { played: 0 } }))];
    expect(evaluateEnrichmentPublication(before, after).allowed).toBe(true);
  });

  it("blocks evidence loss on one fixture even when another fixture gains it", () => {
    const before = [match("1"), match("2"), match("3")];
    const after = [
      { ...match("1"), h2h: { played: 0 } },
      match("2"),
      match("3"),
      match("4", { h2h: { played: 5 } }),
    ];
    const result = evaluateEnrichmentPublication(before, after);
    expect(result.allowed).toBe(false);
    expect(result.evidenceLosses).toContainEqual({ matchId: "1", field: "h2h" });
  });

  it("does not count a missing post-match contract as real statistics", () => {
    const rows = Array.from({ length: 3 }, (_, index) => match(String(index), {
      status: "FT", homeScore: 1, awayScore: 0,
      postMatchStats: { source: "missing", home: { shots: null }, away: { shots: null }, events: [] },
    }));
    expect(evaluateEnrichmentPublication([], rows).next.postMatchStats.covered).toBe(0);
  });

  it("recognizes nested squad players and their identities", () => {
    const players = Array.from({ length: 11 }, (_, index) => ({ id: `player-${index}`, rating: 70 }));
    const result = evaluateEnrichmentPublication([], [match("squad", {
      homeTeamProfile: { squad: { playerCount: 11, fetchedAt: Date.now(), players } },
      awayTeamProfile: { squad: { playerCount: 11, fetchedAt: Date.now(), players } },
    })]);

    expect(result.next.squads.covered).toBe(1);
    expect(result.next.squadFreshness.covered).toBe(1);
    expect(result.next.playerIdentities.covered).toBe(1);
  });

  it("restores richer evidence before a lightweight refresh is published", () => {
    const players = Array.from({ length: 11 }, (_, index) => ({ id: `player-${index}`, rating: 70 }));
    const previous = match("stable", {
      date: "2026-08-31",
      homeTeamName: "Ajax",
      awayTeamName: "PSV",
      h2h: { played: 5 },
      homeRecent: { gamesPlayed: 10 },
      awayRecent: { gamesPlayed: 10 },
      lineupSummary: { confirmed: true },
      homeTeamProfile: { squad: { playerCount: 11, players } },
      awayTeamProfile: { squad: { playerCount: 11, players } },
    });
    const refreshed = match("stable", {
      date: "2026-08-31",
      homeTeamName: "Ajax",
      awayTeamName: "PSV",
      h2h: { played: 0 },
      homeRecent: { gamesPlayed: 2 },
      awayRecent: { gamesPlayed: 3 },
      homeTeamProfile: { squad: { playerCount: 0, players: [] } },
      awayTeamProfile: { squad: { playerCount: 0, players: [] } },
    });

    const [restored] = preserveEnrichmentEvidence([previous], [refreshed]);
    expect(restored.h2h.played).toBe(5);
    expect(restored.homeRecent.gamesPlayed).toBe(10);
    expect(restored.awayRecent.gamesPlayed).toBe(10);
    expect(restored.lineupSummary.confirmed).toBe(true);
    expect(restored.homeTeamProfile.squad.players).toHaveLength(11);
    expect(evaluateEnrichmentPublication([previous], [restored]).allowed).toBe(true);
  });

  it("reports provider conflicts without blocking the complete calendar", () => {
    const previous = match("conflict", { providerDiagnostics: { conflicts: [] } });
    const next = match("conflict", { providerDiagnostics: { conflicts: [{ field: "kickoff", resolved: false }] } });
    const result = evaluateEnrichmentPublication([previous], [next]);
    expect(result.allowed).toBe(true);
    expect(result.next.providerConflicts.coverage).toBe(0);
  });

  it("allows a rolling window to replace enriched fixtures with new incomplete fixtures", () => {
    const previous = [match("old-1"), match("old-2"), match("shared")];
    const next = [match("shared"), match("new-1", { h2h: { played: 0 } }), match("new-2", { h2h: { played: 0 } })];
    const result = evaluateEnrichmentPublication(previous, next);
    expect(result.allowed).toBe(true);
    expect(result.evidenceLosses).toEqual([]);
  });
});
