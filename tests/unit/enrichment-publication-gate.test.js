import { describe, expect, it } from "vitest";
import { evaluateEnrichmentPublication } from "../../scripts/worker/enrichment-publication-gate.js";

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
});
