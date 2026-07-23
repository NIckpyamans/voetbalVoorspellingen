import { describe, expect, it } from "vitest";
import { buildProviderAcceptanceState, buildTrainingAutomationState } from "../../scripts/worker/orchestration-policy.js";

describe("orchestration policy", () => {
  it("enforces the 50/150 training gates", () => {
    expect(buildTrainingAutomationState({ uniqueSnapshotMatches: 15 })).toMatchObject({ canCalibrate: false, calibrationGap: 35, promotionGap: 135 });
    expect(buildTrainingAutomationState({ uniqueSnapshotMatches: 50 })).toMatchObject({ canCalibrate: true, canPromote: false });
    expect(buildTrainingAutomationState({ uniqueSnapshotMatches: 150 })).toMatchObject({ canPromote: true });
  });

  it("keeps a suspended provider on a bounded retry cadence", () => {
    const report = { generatedAt: "2026-07-23T10:00:00Z", accepted: false, errors: [{ message: "Your account is suspended" }] };
    expect(buildProviderAcceptanceState(report, { now: "2026-07-23T12:00:00Z" })).toMatchObject({ externallyBlocked: true, checkDue: false });
    expect(buildProviderAcceptanceState(report, { now: "2026-07-24T12:00:00Z" })).toMatchObject({ checkDue: true });
  });
});
