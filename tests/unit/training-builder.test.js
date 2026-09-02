import { describe, expect, it } from "vitest";
import { buildTrainingSnapshot } from "../../scripts/worker/training-builder.js";

describe("training snapshot builder", () => {
  it("preserves snapshots after their match left the active date window", () => {
    const store = {
      matches: {},
      predictions: {},
      postMatchReviews: { old: { actualOutcome: "H", actualScore: "2-0" } },
      predictionSnapshots: {
        old: [{
          matchId: "old", predictionId: "pred-old", generatedAt: "2026-07-01T10:00:00.000Z",
          kickoff: "2026-07-02T10:00:00.000Z", inputSnapshotHash: "immutable", features: { ppg_diff: 0.4 },
          date: "2026-07-02", league: "Netherlands - Eredivisie",
        }],
      },
    };
    const result = buildTrainingSnapshot(store, { isHiddenEntity: () => false });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ matchId: "old", label: "H", snapshotBacked: true });
  });

  it("does not create training rows for hidden entities", () => {
    const result = buildTrainingSnapshot({
      matches: { "2026-07-01": [{ id: "hidden", league: "World - FIFA World Cup", status: "FT", score: "1-0" }] },
      predictions: {}, predictionSnapshots: {}, postMatchReviews: {},
    }, { isHiddenEntity: () => true });
    expect(result.rows).toEqual([]);
  });
});
