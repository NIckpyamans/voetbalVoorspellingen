import { describe, expect, it } from "vitest";
import { predictWithMlEnsemble, ML_ENSEMBLE_VERSION, ML_FEATURES } from "../../scripts/worker/ml-ensemble.js";

const MODEL = {
  version: ML_ENSEMBLE_VERSION,
  featureSchema: ML_FEATURES,
  classes: ["H", "D", "A"],
  base: [-0.1, 0.05, -0.05],
  stumps: [
    { feature: "ppg_diff", threshold: 0.4, left: [-0.2, 0.05, 0.15], right: [0.2, 0.0, -0.2], gain: 0.01 },
    { feature: "club_elo_diff", threshold: 50, left: [-0.1, 0.1, 0.0], right: [0.15, -0.05, -0.1], gain: 0.008 },
  ],
  trainingMeta: { rows: 500, trainedAt: "2026-09-01T00:00:00Z" },
};

describe("ml ensemble inference", () => {
  it("geeft geldige genormaliseerde kansen bij een geldig model", () => {
    const result = predictWithMlEnsemble({ ppg_diff: 0.8, club_elo_diff: 120 }, MODEL);
    const total = result.homeProb + result.drawProb + result.awayProb;
    expect(total).toBeCloseTo(1, 2);
    expect(result.version).toBe(ML_ENSEMBLE_VERSION);
  });

  it("pakt de juiste kant van de stump", () => {
    const strong = predictWithMlEnsemble({ ppg_diff: 2.0, club_elo_diff: 0 }, MODEL);
    const weak = predictWithMlEnsemble({ ppg_diff: -2.0, club_elo_diff: 0 }, MODEL);
    expect(strong.homeProb).toBeGreaterThan(weak.homeProb);
    expect(weak.awayProb).toBeGreaterThan(strong.awayProb);
  });

  it("ontbrekende features worden als 0 behandeld zonder crash", () => {
    const result = predictWithMlEnsemble({}, MODEL);
    expect(result).not.toBeNull();
  });

  it("geeft null zonder model of bij onjuiste versie", () => {
    expect(predictWithMlEnsemble({}, null)).toBeNull();
    expect(predictWithMlEnsemble({}, { ...MODEL, version: "oude-versie" })).toBeNull();
    expect(predictWithMlEnsemble({}, { ...MODEL, stumps: [] })).toBeNull();
  });
});
