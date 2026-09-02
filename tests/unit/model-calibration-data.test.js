import { describe, expect, it } from "vitest";
import { ledgerCalibrationRows, mergeCalibrationRows, trainingCalibrationRows } from "../../scripts/worker/model-calibration-data.js";

describe("shadow calibration data", () => {
  it("uses only completed immutable rows with three-way probabilities", () => {
    const rows = trainingCalibrationRows({ rows: [{
      snapshotBacked: true,
      status: "FT",
      predictionId: "prediction",
      matchId: "match",
      league: "Netherlands - Eredivisie",
      label: "H",
      generatedAt: "2026-07-20T10:00:00.000Z",
      kickoff: "2026-07-20T11:15:00.000Z",
      inputSnapshotHash: "immutable",
      featureVector: { ppg_diff: 0.4 },
      probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
    }, {
      snapshotBacked: false,
      status: "FT",
      predictionId: "fallback",
      matchId: "fallback-match",
      league: "Netherlands - Eredivisie",
      label: "H",
      probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
    }] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ prediction_id: "prediction", actual_outcome: "H", competition_segment: "regular_league" });
  });

  it("uses one latest snapshot per unique match and model", () => {
    const base = {
      snapshotBacked: true,
      status: "FT",
      matchId: "same-match",
      league: "Europe - Champions League",
      label: "D",
      modelVersion: "v1",
      kickoff: "2026-08-01T13:15:00.000Z",
      inputSnapshotHash: "immutable",
      featureVector: { ppg_diff: 0.2 },
      probabilities: { home: 0.4, draw: 0.3, away: 0.3 },
    };
    const rows = trainingCalibrationRows({ rows: [
      { ...base, predictionId: "early", generatedAt: "2026-07-31T13:15:00.000Z" },
      { ...base, predictionId: "latest", generatedAt: "2026-08-01T12:00:00.000Z" },
    ] });
    expect(rows).toHaveLength(1);
    expect(rows[0].prediction_id).toBe("latest");
  });

  it("builds leakage-safe rows from immutable ledger evaluations", () => {
    const rows = ledgerCalibrationRows({
      predictionSnapshots: {
        p1: {
          predictionId: "p1", matchId: "m1", league: "Netherlands - Eredivisie", modelVersion: "v1",
          generatedAt: "2026-08-01T10:00:00.000Z", kickoff: "2026-08-01T11:15:00.000Z",
          inputSnapshotHash: "immutable", features: { ppg_diff: 0.4 },
          probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
        },
      },
      evaluations: { p1: { predictionId: "p1", matchId: "m1", actualOutcome: "H" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ match_id: "m1", actual_outcome: "H", competition_segment: "regular_league" });
  });

  it("rejects post-kickoff ledger snapshots", () => {
    const rows = ledgerCalibrationRows({
      predictionSnapshots: {
        p1: {
          predictionId: "p1", matchId: "m1", league: "England - Premier League",
          generatedAt: "2026-08-01T19:00:00.000Z", kickoff: "2026-08-01T18:00:00.000Z",
          probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
        },
      },
      evaluations: { p1: { actualOutcome: "H" } },
    });
    expect(rows).toHaveLength(0);
  });

  it("merges training and ledger rows without counting a fixture/model twice", () => {
    const base = { match_id: "m1", model_version: "v1", probabilities: { home: 0.5, draw: 0.3, away: 0.2 } };
    const rows = mergeCalibrationRows(
      [{ ...base, prediction_id: "old", generated_at: "2026-08-01T10:00:00Z" }],
      [{ ...base, prediction_id: "new", generated_at: "2026-08-01T11:00:00Z" }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].prediction_id).toBe("new");
  });
});
