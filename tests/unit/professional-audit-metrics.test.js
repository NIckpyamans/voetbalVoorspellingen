import { describe, expect, it } from "vitest";
import { buildAppRecommendations, summarizeRecentDays } from "../../scripts/professional-audit-metrics.js";

describe("professional audit metrics", () => {
  it("counts object-backed reviews and reports clean result coverage", () => {
    const summary = summarizeRecentDays([{
      matches: [{ id: "m1", status: "FT", score: "2-1" }],
      predictions: [{ matchId: "m1", dataCompletenessScore: 0.8, sourceAsOf: "2026-08-01" }],
      reviews: { m1: { matchId: "m1", league: "Netherlands - Eredivisie", actualScore: "2-1", predictedScore: "1-0", outcomeHit: true, brierScore: 0.2, logLoss: 0.4 } },
      predictionSnapshots: { p1: { matchId: "m1" } },
    }]);
    expect(summary.resultCoverage).toBe(1);
    expect(summary.evaluationCoverage).toBe(1);
    expect(summary.performance.outcomeHitRate).toBe(1);
    expect(summary.segments.domestic_competitions.reviews).toBe(1);
  });

  it("does not keep recommending a snapshot target that is already reached", () => {
    const result = buildAppRecommendations({
      recent: { resultCoverage: 1, evaluationCoverage: 1, actualOddsCoverage: 0, confirmedLineupCoverage: 0, snapshotBackedReviewCoverage: 0.5 },
      snapshotGrowth: { training: { uniqueEvaluatedMatches: 231 } },
      lineupMonitor: { confirmedLineupCoverage: 0 },
      recalibrationReport: null,
      databaseAvailable: false,
    });
    expect(result.completed.join(" ")).toContain("231");
    expect(result.recommendations.some((item) => item.key === "snapshot_growth")).toBe(false);
    expect(result.recommendations.some((item) => item.key === "shadow_calibration")).toBe(true);
    expect(result.recommendations[0].priority).toBe(1);
  });

  it("marks a completed shadowrun without accepted profiles instead of recommending promotion", () => {
    const result = buildAppRecommendations({
      recent: { resultCoverage: 1, evaluationCoverage: 1, actualOddsCoverage: 1, confirmedLineupCoverage: 1, snapshotBackedReviewCoverage: 1 },
      snapshotGrowth: { training: { uniqueEvaluatedMatches: 231 } },
      lineupMonitor: { confirmedLineupCoverage: 1 },
      recalibrationReport: { calibrationRows: 283, accepted: 0 },
      databaseAvailable: true,
    });
    expect(result.completed.join(" ")).toContain("283");
    expect(result.recommendations.some((item) => item.key === "shadow_calibration")).toBe(false);
  });

  it("keeps club friendlies separate from domestic calibration", () => {
    const summary = summarizeRecentDays([{
      reviews: [{ matchId: "f1", league: "World - Club Friendlies", actualScore: "1-0", predictedScore: "1-0", exactHit: true }],
    }]);
    expect(summary.segments.club_friendlies.reviews).toBe(1);
    expect(summary.segments.domestic_competitions.reviews).toBe(0);
  });
});
