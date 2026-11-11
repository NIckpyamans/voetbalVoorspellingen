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

function identifiedCount(profile) {
  return (profile?.squad?.players || []).filter((player) => player?.id).length;
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

  it("keeps identified players when a fresher roster arrives without ids", () => {
    const players = Array.from({ length: 11 }, (_, index) => ({ id: `player-${index}` }));
    const anonymous = Array.from({ length: 11 }, (_, index) => ({ name: `speler-${index}` }));
    const previous = match("identities", {
      homeTeamProfile: { squad: { fetchedAt: Date.now() - 30 * 86400000, players } },
      awayTeamProfile: { squad: { fetchedAt: Date.now() - 30 * 86400000, players } },
    });
    const incoming = match("identities", {
      homeTeamProfile: { squad: { fetchedAt: Date.now(), players: anonymous } },
      awayTeamProfile: { squad: { fetchedAt: Date.now(), players: anonymous } },
    });

    const [restored] = preserveEnrichmentEvidence([previous], [incoming]);
    expect(restored.homeTeamProfile).toEqual(previous.homeTeamProfile);
    expect(restored.awayTeamProfile).toEqual(previous.awayTeamProfile);
    expect(evaluateEnrichmentPublication([previous], [restored])).toMatchObject({ allowed: true, evidenceLosses: [] });
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

  it("treat a shrinking finished window as normal when coverage stays complete", () => {
    const finished = (id) => match(id, { status: "FT", homeScore: 2, awayScore: 1 });
    const previous = Array.from({ length: 16 }, (_, index) => finished(`ft-${index}`));
    const next = previous.slice(1);
    const result = evaluateEnrichmentPublication(previous, next);
    expect(result.allowed).toBe(true);
    expect(result.next.finalScores).toMatchObject({ covered: 15, total: 15 });
    expect(result.regressions).toEqual([]);
  });

  it("still blocks when a shared finished fixture loses its score", () => {
    const finished = (id) => match(id, { status: "FT", homeScore: 2, awayScore: 1 });
    const previous = [finished("a"), finished("b"), finished("c"), finished("d")];
    const next = [{ ...finished("a"), status: "NS", homeScore: null, awayScore: null }, finished("b"), finished("c"), finished("d")];
    const result = evaluateEnrichmentPublication(previous, next);
    expect(result.allowed).toBe(false);
    expect(result.regressions.map((row) => row.field)).toContain("finalScores");
  });

  it("keeps a fresh roster when a richer but expired cache arrives", () => {
    const profile = (days, count) => ({ squad: { fetchedAt: Date.now() - days * 86400000, players: Array.from({ length: count }, (_, i) => ({ id: String(i) })) } });
    const previous = match("fresh", { homeTeamProfile: profile(1, 18), awayTeamProfile: profile(1, 18) });
    const incoming = match("fresh", { homeTeamProfile: profile(30, 25), awayTeamProfile: profile(30, 25) });
    const [restored] = preserveEnrichmentEvidence([previous], [incoming]);
    expect(restored.homeTeamProfile).toEqual(previous.homeTeamProfile);
    expect(evaluateEnrichmentPublication([previous], [restored]).allowed).toBe(true);
    const [reverse] = preserveEnrichmentEvidence([incoming], [previous]);
    expect(reverse.homeTeamProfile).toEqual(previous.homeTeamProfile);
  });

  it("ranks usable identities above freshness and above completeness", () => {
    const profile = (days, count, withIds = true) => ({
      squad: {
        fetchedAt: Date.now() - days * 86400000,
        players: Array.from({ length: count }, (_, index) => (withIds ? { id: String(index) } : { name: `speler-${index}` })),
      },
    });

    // 1. Onbruikbare identiteiten verliezen van bruikbare, ook als ze verser zijn.
    const [keptIdentities] = preserveEnrichmentEvidence(
      [match("order-ids", { homeTeamProfile: profile(30, 25), awayTeamProfile: profile(30, 25) })],
      [match("order-ids", { homeTeamProfile: profile(0, 18, false), awayTeamProfile: profile(0, 18, false) })],
    );
    expect(identifiedCount(keptIdentities.homeTeamProfile)).toBe(25);

    // 2. Zijn beide bruikbaar, dan wint versheid boven aantal spelers.
    const [keptFresh] = preserveEnrichmentEvidence(
      [match("order-fresh", { homeTeamProfile: profile(1, 18), awayTeamProfile: profile(1, 18) })],
      [match("order-fresh", { homeTeamProfile: profile(30, 25), awayTeamProfile: profile(30, 25) })],
    );
    expect(identifiedCount(keptFresh.homeTeamProfile)).toBe(18);

    // 3. Zonder bruikbare identiteiten beslist volledigheid.
    const [keptFuller] = preserveEnrichmentEvidence(
      [match("order-full", { homeTeamProfile: profile(2, 12, false), awayTeamProfile: profile(2, 12, false) })],
      [match("order-full", { homeTeamProfile: profile(2, 14, false), awayTeamProfile: profile(2, 14, false) })],
    );
    expect(keptFuller.homeTeamProfile.squad.players).toHaveLength(14);
  });

});
