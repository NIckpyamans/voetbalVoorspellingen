import { describe, expect, it } from "vitest";
import { materializeSnapshotBackedReviews } from "../../scripts/worker/snapshot-review-materialization.js";

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
});
