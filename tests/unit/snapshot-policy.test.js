import { describe, expect, it } from "vitest";
import {
  classifyPredictionSnapshotWindow,
  selectPreferredTrainingSnapshot,
  snapshotTrainingEligibility,
} from "../../scripts/worker/snapshot-policy.js";

const base = {
  matchId: "m1",
  kickoff: "2026-09-01T20:00:00Z",
  features: { ppg_diff: 0.4 },
  inputSnapshotHash: "immutable",
};

describe("immutable prediction snapshot policy", () => {
  it("classifies the required pre-kickoff windows", () => {
    expect(classifyPredictionSnapshotWindow(base.kickoff, "2026-08-31T20:00:00Z")).toBe("t24");
    expect(classifyPredictionSnapshotWindow(base.kickoff, "2026-09-01T18:45:00Z")).toBe("t75");
    expect(classifyPredictionSnapshotWindow(base.kickoff, "2026-09-01T19:15:00Z")).toBe("t45");
    expect(classifyPredictionSnapshotWindow(base.kickoff, "2026-09-01T19:40:00Z")).toBe("t20");
  });

  it("rejects post-kickoff and trace-only snapshots for training", () => {
    expect(snapshotTrainingEligibility({ ...base, predictionId: "late", generatedAt: "2026-09-01T20:01:00Z" }).eligible).toBe(false);
    expect(snapshotTrainingEligibility({ ...base, predictionId: "early", generatedAt: "2026-08-30T20:00:00Z" }).eligible).toBe(false);
  });

  it("prefers the latest required decision window without counting all revisions", () => {
    const selected = selectPreferredTrainingSnapshot([
      { ...base, predictionId: "t24", generatedAt: "2026-08-31T20:00:00Z" },
      { ...base, predictionId: "t75", generatedAt: "2026-09-01T18:45:00Z" },
      { ...base, predictionId: "t20", generatedAt: "2026-09-01T19:40:00Z" },
    ]);
    expect(selected.predictionId).toBe("t20");
  });
});
