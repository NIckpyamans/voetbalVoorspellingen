import { describe, expect, it } from "vitest";
import { summarizeLeagueCoverage } from "../../scripts/worker/coverage-summary.js";
import { buildMatchSourceCoverage } from "../../shared/database.js";

describe("league coverage summary", () => {
  it("ranks the weakest competition first", () => {
    const summary = summarizeLeagueCoverage([
      { league: "League A", status: "captured" },
      { league: "League A", status: "missing" },
      { league: "League B", status: "captured" },
    ]);
    expect(summary[0]).toMatchObject({ league: "League A", checked: 2, covered: 1, coverage: 0.5 });
    expect(summary[1]).toMatchObject({ league: "League B", coverage: 1 });
  });
});

describe("dashboard match source coverage", () => {
  it("counts fixture, result and recent form even without a stored coverage object", () => {
    const coverage = buildMatchSourceCoverage({
      id: "match",
      date: "2026-07-23",
      kickoff: "2026-07-23T18:00:00.000Z",
      homeTeamName: "Ajax",
      awayTeamName: "PSV",
      status: "FT",
      score: "2-1",
      homeRecent: { gamesPlayed: 3, source: "local-finished-results" },
      awayRecent: { gamesPlayed: 2, source: "local-finished-results" },
    });
    expect(coverage).toMatchObject({ available: 3, total: 8, percent: 38 });
    expect(coverage.entries.find((entry) => entry.key === "form")).toMatchObject({
      available: true,
      source: "local-finished-results",
    });
  });
});
