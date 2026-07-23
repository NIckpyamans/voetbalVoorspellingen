import { describe, expect, it } from "vitest";
import { summarizeLeagueCoverage } from "../../scripts/worker/coverage-summary.js";

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
