import { describe, expect, it } from "vitest";
import { compactSnapshotLedgerForApi, compactSnapshotLedgerForLocalRecovery } from "../../shared/predictionSnapshotLedger.js";

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

describe("snapshot API projection", () => {
  it("keeps query fields and removes heavyweight training details", () => {
    const compact = compactSnapshotLedgerForApi({
      predictionSnapshots: {
        prediction: {
          predictionId: "prediction",
          matchId: "match",
          modelVersion: "v1",
          generatedAt: "2026-08-01T11:00:00Z",
          features: { ppg_diff: 0.4 },
          inputSnapshot: {
            teamIdentity: { status: "provider_ids" },
            sourceAsOf: { fixture: "2026-08-01T10:59:00Z" },
            lineupStatus: "confirmed",
            rawProviderPayload: "x".repeat(100_000),
          },
          calibration: { samples: Array(500).fill(1) },
          explanation: { text: "x".repeat(10_000) },
        },
      },
    });

    const snapshot = compact.predictionSnapshots.prediction;
    expect(snapshot.features.ppg_diff).toBe(0.4);
    expect(snapshot.lineupStatus).toBe("confirmed");
    expect(snapshot.sourceAsOf.fixture).toBe("2026-08-01T10:59:00Z");
    expect(snapshot).not.toHaveProperty("inputSnapshot");
    expect(snapshot).not.toHaveProperty("calibration");
    expect(snapshot).not.toHaveProperty("explanation");
  });
});
