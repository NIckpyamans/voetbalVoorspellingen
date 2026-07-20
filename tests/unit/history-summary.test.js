import { describe, expect, it } from "vitest";
import { compactHistorySummary } from "../../scripts/worker/archive.js";

describe("compactHistorySummary", () => {
  it("keeps audit fields but removes heavy immutable snapshot payloads", () => {
    const compacted = compactHistorySummary({
      predictionSnapshots: {
        p1: {
          matchId: "m1",
          confidence: 0.61,
          expectedScore: "2-1",
          inputSnapshot: { allSourcePayloads: ["large"] },
          featureVector: { ppg_diff: 0.4 },
        },
      },
      postMatchReviews: {
        m1: { predictedOutcome: "H", confidence: 0.61, featureImportance: [{ key: "ppg_diff" }] },
      },
      phaseReliability: { league: { sampleSize: 4 } },
    });

    expect(compacted.predictionSnapshots.p1).toEqual({
      predictionId: "p1",
      matchId: "m1",
      confidence: 0.61,
      expectedScore: "2-1",
    });
    expect(compacted.postMatchReviews.m1).toEqual({ predictedOutcome: "H", confidence: 0.61 });
    expect(compacted.phaseReliability).toEqual({ league: { sampleSize: 4 } });
  });
});
