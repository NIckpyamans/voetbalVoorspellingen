import { describe, expect, it } from "vitest";
import {
  materializeSnapshotBackedReviews,
  rebindFallbackReviewsToSnapshots,
  rebindReviewToSnapshot,
  mostLikelyOutcome,
  brierFromProbabilities,
  logLossFromProbabilities,
} from "../../scripts/worker/snapshot-review-materialization.js";

describe("snapshot review materialization", () => {
  it("replaces only a matching fallback review with immutable evidence", () => {
    const result = materializeSnapshotBackedReviews({
      matches: [{ id: "match-1" }, { id: "match-2" }],
      reviews: { "match-1": { evaluationSource: "current_prediction_fallback" } },
    }, {
      "match-1": { matchId: "match-1", predictionId: "pred-1", evaluationSource: "prediction_snapshot" },
      "other": { matchId: "other", predictionId: "pred-other", evaluationSource: "prediction_snapshot" },
    });
    expect(result.linked).toBe(1);
    expect(result.day.reviews["match-1"]).toMatchObject({ predictionId: "pred-1", evaluationSource: "prediction_snapshot" });
    expect(result.day.reviews.other).toBeUndefined();
  });

  it("berekent kansmetrics volgens dezelfde conventie als de worker", () => {
    const probabilities = { home: 0.5, draw: 0.3, away: 0.2 };
    expect(brierFromProbabilities(probabilities, "H")).toBe(0.38);
    expect(logLossFromProbabilities(probabilities, "H")).toBe(0.6931);
    expect(mostLikelyOutcome(probabilities)).toBe("H");
  });

  it("bindt een fallback-review opnieuw aan een pre-kickoff snapshot en bewaart oude waarden", () => {
    const review = {
      matchId: "match-1",
      predictionId: "pred-fallback",
      evaluationSource: "current_prediction_fallback",
      actualScore: "2-1",
      actualOutcome: "H",
      actualBtts: true,
      actualOver25: true,
      predictedScore: "0-0",
      predictedOutcome: "D",
      brierScore: 2.0,
    };
    const snapshot = {
      predictionId: "pred-immutable",
      matchId: "match-1",
      generatedAt: "2026-09-28T12:00:00.000Z",
      cutoffAt: "2026-09-28T12:00:00.000Z",
      kickoff: "2026-09-28T18:00:00.000Z",
      modelVersion: "v-test",
      probabilities: { home: 0.6, draw: 0.25, away: 0.15 },
      expectedScore: { home: 2, away: 1 },
      confidence: 0.55,
    };
    const result = rebindFallbackReviewsToSnapshots(
      { matches: [{ id: "match-1", kickoff: "2026-09-28T18:00:00.000Z" }], reviews: { "match-1": review } },
      { "pred-immutable": snapshot }
    );
    const rebound = result.day.reviews["match-1"];
    expect(result.rebound).toBe(1);
    expect(rebound.evaluationSource).toBe("prediction_snapshot");
    expect(rebound.predictionId).toBe("pred-immutable");
    expect(rebound.predictedScore).toBe("2-1");
    expect(rebound.outcomeHit).toBe(true);
    expect(rebound.exactHit).toBe(true);
    expect(rebound.brierScore).toBeLessThan(1);
    expect(rebound.reboundFrom.previousEvaluationSource).toBe("current_prediction_fallback");
    expect(rebound.reboundFrom.previousMetrics.brierScore).toBe(2.0);
  });

  it("laat post-kickoff snapshots liggen (geen lek) en houdt snapshot-backed reviews intact", () => {
    const review = { matchId: "match-1", evaluationSource: "current_prediction_fallback", actualScore: "2-1", actualOutcome: "H" };
    const lateSnapshot = {
      predictionId: "pred-late",
      matchId: "match-1",
      generatedAt: "2026-09-28T20:00:00.000Z",
      probabilities: { home: 0.6, draw: 0.25, away: 0.15 },
      expectedScore: { home: 2, away: 1 },
    };
    const result = rebindFallbackReviewsToSnapshots(
      { matches: [{ id: "match-1", kickoff: "2026-09-28T18:00:00.000Z" }], reviews: { "match-1": review } },
      { "pred-late": lateSnapshot }
    );
    expect(result.rebound).toBe(0);
    expect(result.kept).toBe(1);
    expect(result.day.reviews["match-1"].evaluationSource).toBe("current_prediction_fallback");
    expect(rebindReviewToSnapshot({ evaluationSource: "prediction_snapshot" }, null)).toBeNull();
  });
});
