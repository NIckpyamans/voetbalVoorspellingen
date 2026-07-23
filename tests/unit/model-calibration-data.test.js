import { describe, expect, it } from "vitest";
import { trainingCalibrationRows } from "../../scripts/worker/model-calibration-data.js";

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
    expect(rows[0]).toMatchObject({ prediction_id: "prediction", actual_outcome: "H" });
  });
});
