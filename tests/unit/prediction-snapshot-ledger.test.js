import { describe, expect, it } from "vitest";
import { compactSnapshotLedgerForLocalRecovery } from "../../shared/predictionSnapshotLedger.js";

describe("local snapshot recovery projection", () => {
  it("keeps the latest immutable snapshot per match and model", () => {
    const compact = compactSnapshotLedgerForLocalRecovery({
      predictionSnapshots: {
        old: { predictionId: "old", matchId: "match", modelVersion: "v1", generatedAt: "2026-08-01T10:00:00Z" },
        latest: { predictionId: "latest", matchId: "match", modelVersion: "v1", generatedAt: "2026-08-01T11:00:00Z" },
        otherModel: { predictionId: "otherModel", matchId: "match", modelVersion: "v2", generatedAt: "2026-08-01T09:00:00Z" },
      },
      evaluations: {
        old: { predictionId: "old" },
        latest: { predictionId: "latest" },
        otherModel: { predictionId: "otherModel" },
      },
    });
    expect(Object.keys(compact.predictionSnapshots).sort()).toEqual(["latest", "otherModel"]);
    expect(Object.keys(compact.evaluations).sort()).toEqual(["latest", "otherModel"]);
    expect(compact.predictionSnapshotIndex.match.sort()).toEqual(["latest", "otherModel"]);
  });
});
