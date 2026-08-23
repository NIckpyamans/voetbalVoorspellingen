import { describe, expect, it } from "vitest";
import { compactStaticPredictionSnapshot, selectStaticSnapshotIds } from "../../scripts/worker/archive.js";

describe("static day snapshot export", () => {
  it("keeps the earliest and latest immutable snapshot for Git while R2 retains the full ledger", () => {
    const snapshots = {
      first: { generatedAt: "2026-08-13T08:00:00Z" },
      middle: { generatedAt: "2026-08-13T12:00:00Z" },
      latest: { generatedAt: "2026-08-13T18:00:00Z" },
    };
    expect(selectStaticSnapshotIds(["middle", "latest", "first"], snapshots, 2)).toEqual(["first", "latest"]);
  });
});

describe("compactStaticPredictionSnapshot", () => {
  it("keeps audit evidence but removes heavy model payloads from Git exports", () => {
    const compacted = compactStaticPredictionSnapshot({
      predictionId: "p1",
      matchId: "m1",
      generatedAt: "2026-08-23T10:00:00Z",
      cutoffAt: "2026-08-23T10:00:00Z",
      inputSnapshotHash: "hash",
      probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
      leakageGuard: { cutoffBeforeKickoff: true },
      prediction: { very: "large" },
      inputSnapshot: { very: "large" },
      features: { very: "large" },
      explanation: { very: "large" },
    });
    expect(compacted).toMatchObject({ predictionId: "p1", matchId: "m1", inputSnapshotHash: "hash" });
    expect(compacted).not.toHaveProperty("prediction");
    expect(compacted).not.toHaveProperty("inputSnapshot");
    expect(compacted).not.toHaveProperty("features");
    expect(compacted).not.toHaveProperty("explanation");
  });
});
