import { describe, expect, it } from "vitest";
import { buildLeaguePerformance } from "../../shared/dashboard.ts";

function reviews(league, total, outcome, exact, extra = {}) {
  return Array.from({ length: total }, (_, index) => ({
    matchId: `${league}-${index}`,
    league,
    prediction: "1-0",
    actual: index < exact ? "1-0" : "2-0",
    wasCorrect: index < exact,
    winnerCorrect: index < outcome,
    errorMargin: index < exact ? 0 : 1,
    evaluationSource: "prediction_snapshot",
    leakageRisk: null,
    ...extra,
  }));
}

describe("buildLeaguePerformance", () => {
  it("ranks only active leagues with a meaningful immutable sample", () => {
    const rows = [
      ...reviews("Netherlands - Eredivisie", 12, 8, 2),
      ...reviews("Germany - Bundesliga", 12, 7, 4),
      ...reviews("World - Club Friendlies", 30, 30, 30),
      ...reviews("France - Ligue 1", 20, 20, 20, { leakageRisk: "post_match" }),
    ];
    const result = buildLeaguePerformance(rows, 10);
    expect(result.method).toBe("immutable_snapshots");
    expect(result.best?.league).toBe("Netherlands - Eredivisie");
    expect(result.rows.map((row) => row.league)).not.toContain("World - Club Friendlies");
    expect(result.rows.map((row) => row.league)).not.toContain("France - Ligue 1");
  });

  it("falls back to evaluated reviews when immutable history is still too small", () => {
    const result = buildLeaguePerformance(
      reviews("England - Championship", 12, 7, 2, { evaluationSource: "current_prediction_fallback" }),
      10
    );
    expect(result.method).toBe("all_evaluated_reviews");
    expect(result.best?.league).toBe("England - Championship");
  });
});
