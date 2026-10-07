import { describe, expect, it } from "vitest";
import { buildLeaguePerformance, buildWagerReadiness } from "../../shared/dashboard.ts";

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
      ...reviews("Netherlands - Eredivisie", 12, 8, 2).map((item, index) => ({ ...item, date: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00Z`, homeTeam: `Home ${index}`, awayTeam: `Away ${index}` })),
      ...reviews("Germany - Bundesliga", 12, 7, 4).map((item, index) => ({ ...item, date: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00Z`, homeTeam: `Home ${index}`, awayTeam: `Away ${index}` })),
      ...reviews("World - Club Friendlies", 30, 30, 30),
      ...reviews("France - Ligue 1", 20, 20, 20, { leakageRisk: "post_match" }).map((item, index) => ({ ...item, date: `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00Z`, homeTeam: `France home ${index}`, awayTeam: `France away ${index}` })),
    ];
    const result = buildLeaguePerformance(rows, 10);
    expect(result.method).toBe("immutable_snapshots");
    expect(result.best?.league).toBe("Netherlands - Eredivisie");
    expect(result.best?.trustworthyUniqueFixtures).toBe(12);
    expect(result.rows.map((row) => row.league)).not.toContain("World - Club Friendlies");
    expect(result.rows.map((row) => row.league)).not.toContain("France - Ligue 1");
  });

  it("counts unique fixtures before selecting immutable evidence and sample thresholds", () => {
    const duplicatedSnapshots = Array.from({ length: 20 }, (_, index) => ({
      ...reviews("England - Championship", 1, 1, 1)[0],
      matchId: `same-${index}`,
      date: "2026-09-01T12:00:00Z",
      homeTeam: "Ajax",
      awayTeam: "PSV",
      timestamp: Date.parse("2026-09-01T12:00:00Z"),
    }));
    const result = buildLeaguePerformance(duplicatedSnapshots, 10);
    expect(result.method).toBe("all_evaluated_reviews");
    expect(result.trustworthyUniqueFixtures).toBe(1);
    expect(result.rows).toHaveLength(0);
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

describe("buildWagerReadiness", () => {
  const league = { league: "Germany - Bundesliga", total: 180, exact: 28, outcome: 108, exactPct: 16, outcomePct: 60, avgGoalError: 1.6, avgBrierScore: 0.2, calibrationError: 0.01, roiTotal: null, roiSamples: 0, evaluationMethod: "immutable_snapshots" };
  const prematch = "2099-08-23T15:00:00Z";
  const now = Date.parse("2099-08-23T14:30:00Z");

  it("only marks a pick eligible after every evidence gate passes", () => {
    const result = buildWagerReadiness({
      league: league.league,
      status: "NS",
      date: prematch,
      homeProb: 0.62,
      drawProb: 0.22,
      awayProb: 0.16,
      oddsAtPrediction: { home: 2.1, draw: 3.4, away: 3.8, capturedAt: "2099-08-23T14:20:00Z" },
      oddsStatus: "available",
      predictionCapturedAt: "2099-08-23T14:00:00Z",
      dataCompleteness: { score: 0.9 },
      qualityGate: { blockedHighConfidence: false },
      lineupSummary: { confirmed: true, firstConfirmedAt: "2099-08-23T14:00:00Z" },
      ensembleMeta: { agreement: 0.75 },
    }, league, { now });
    expect(result.status).toBe("eligible");
    expect(result.evidenceCoverage.complete).toBe(true);
    expect(result.recommendedOutcome).toBe("Thuis");
    expect(result.edge).toBeGreaterThanOrEqual(0.03);
  });

  it("blocks wagering when prematch evidence is incomplete", () => {
    const result = buildWagerReadiness({
      league: league.league,
      status: "NS",
      homeProb: 0.56,
      drawProb: 0.24,
      awayProb: 0.2,
      dataCompleteness: { score: 0.52 },
      qualityGate: { blockedHighConfidence: true },
      lineupSummary: { confirmed: false },
    }, league, { now });
    expect(result.status).toBe("analysis_only");
    expect(result.blockers).toContain("geen complete actuele 1X2-odds");
    expect(result.blockers.some((item) => item.includes("bevestigde opstelling ontbreekt"))).toBe(true);
  });

  it("blocks odds without a trustworthy prematch timestamp", () => {
    const result = buildWagerReadiness({
      league: league.league,
      status: "NS",
      date: prematch,
      homeProb: 0.56,
      drawProb: 0.24,
      awayProb: 0.2,
      oddsAtPrediction: { home: 2.1, draw: 3.4, away: 3.8 },
      oddsStatus: "available",
      predictionCapturedAt: "2099-08-23T14:00:00Z",
      dataCompleteness: { score: 0.82 },
      qualityGate: { blockedHighConfidence: false },
      lineupSummary: { confirmed: true, firstConfirmedAt: "2099-08-23T14:00:00Z" },
    }, league, { now });
    expect(result.status).not.toBe("eligible");
    expect(result.blockers.some((item) => item.includes("odds hebben geen betrouwbare timestamp"))).toBe(true);
  });

  it("rejects future-dated prediction, lineup, and odds evidence", () => {
    const result = buildWagerReadiness({
      league: league.league,
      status: "NS",
      date: "2026-10-07T20:00:00Z",
      homeProb: 0.62,
      drawProb: 0.22,
      awayProb: 0.16,
      oddsAtPrediction: { home: 2.1, draw: 3.4, away: 3.8, capturedAt: "2026-10-06T13:00:00Z" },
      oddsStatus: "available",
      predictionCapturedAt: "2026-10-06T13:05:00Z",
      dataCompleteness: { score: 0.9 },
      qualityGate: { blockedHighConfidence: false },
      lineupSummary: { confirmed: true, firstConfirmedAt: "2026-10-06T13:10:00Z" },
      ensembleMeta: { agreement: 0.75 },
    }, league, { now: Date.parse("2026-10-06T12:00:00Z") });
    expect(result.status).not.toBe("eligible");
    expect(result.blockers).toContain("odds-timestamp ligt in de toekomst");
    expect(result.blockers).toContain("opstellingsbevestigingstimestamp ligt in de toekomst");
    expect(result.blockers.some((item) => item.includes("voorspelling ontbreekt, ligt in de toekomst"))).toBe(true);
  });
});
