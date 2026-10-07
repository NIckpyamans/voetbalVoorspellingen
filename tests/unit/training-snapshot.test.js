import { describe, expect, it } from "vitest";
import { mergeTrainingSnapshots } from "../../scripts/worker/training-snapshot.js";

describe("training snapshot compaction", () => {
  it("preserves separate immutable prediction ids for one fixture", () => {
    const result = mergeTrainingSnapshots({ rows: [] }, {
      rows: [
        { matchId: "match-1", predictionId: "p1", modelVersion: "v1", snapshotBacked: true, featureVector: { x: 1 } },
        { matchId: "match-1", predictionId: "p2", modelVersion: "v1", snapshotBacked: true, featureVector: { x: 2 } },
      ],
    });
    expect(result.rows.map((row) => row.predictionId)).toEqual(["p1", "p2"]);
  });

  it("deduplicates repeated immutable copies by prediction id and keeps fallback rows compact", () => {
    const result = mergeTrainingSnapshots({ rows: [
      { matchId: "match-1", predictionId: "p1", modelVersion: "v1", snapshotBacked: true, featureVector: { x: 1 } },
      { matchId: "match-1", predictionId: "p1", modelVersion: "v1", snapshotBacked: true, featureVector: { x: 1 }, generatedAt: "2026-07-20T10:30:00.000Z" },
      { matchId: "match-2", modelVersion: "fallback", review: { actualScore: "1-0", raw: "not retained" }, ensembleMeta: { active: true, debug: "not retained" } },
    ] }, { rows: [] });
    expect(result.rows.filter((row) => row.predictionId === "p1")).toHaveLength(1);
    const fallback = result.rows.find((row) => row.matchId === "match-2");
    expect(fallback.review).toEqual({ actualScore: "1-0" });
    expect(fallback.ensembleMeta).toEqual({ active: true });
  });
});
