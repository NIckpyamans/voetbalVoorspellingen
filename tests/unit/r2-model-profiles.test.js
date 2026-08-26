import { describe, expect, it } from "vitest";
import { applyR2ModelProfiles, validateActiveCalibration } from "../../scripts/worker/r2-model-profiles.js";

function artifact(profiles = { "Netherlands - Eredivisie": { homeBias: 0.01 } }) {
  return {
    schemaVersion: "league-calibration-r2-v1",
    active: true,
    generatedAt: "2026-08-13T10:00:00.000Z",
    versionKey: "model/calibration/versions/v1.json",
    promotionGate: { canPromote: true },
    profiles,
  };
}

describe("R2 model profiles", () => {
  it("accepts only promoted active calibration artifacts", () => {
    expect(validateActiveCalibration(artifact())).not.toBeNull();
    expect(validateActiveCalibration({ ...artifact(), active: false })).toBeNull();
    expect(validateActiveCalibration({ ...artifact(), promotionGate: { canPromote: false } })).toBeNull();
  });

  it("overlays approved profiles and phase reliability", () => {
    const store = { leagueCalibrationProfiles: {}, phaseReliability: {}, backtestSegmentation: { driftAlerts: [] } };
    const result = applyR2ModelProfiles(store, {
      calibration: artifact(),
      phaseReliability: { phaseReliability: { regular_league: { matches: 20, reliabilityScore: 0.6 } } },
    });
    expect(result.calibrationProfiles).toBe(1);
    expect(result.phaseProfiles).toBe(1);
    expect(store.leagueCalibrationProfiles["Netherlands - Eredivisie"].activeVersionKey).toContain("v1.json");
    expect(store.phaseReliability.regular_league.reliabilityScore).toBe(0.6);
  });

  it("does not reactivate a league blocked by high drift", () => {
    const store = {
      leagueCalibrationProfiles: {},
      phaseReliability: {},
      backtestSegmentation: { driftAlerts: [{ scope: "league", severity: "high", key: "Netherlands - Eredivisie" }] },
    };
    const result = applyR2ModelProfiles(store, { calibration: artifact(), phaseReliability: null });
    expect(result.skippedForDrift).toEqual(["Netherlands - Eredivisie"]);
    expect(store.leagueCalibrationProfiles).toEqual({});
  });
});
