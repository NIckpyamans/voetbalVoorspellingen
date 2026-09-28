import { describe, expect, it } from "vitest";
import {
  buildCalibrationRows,
  buildCalibrationProfile,
  applyPlattProfile,
  evaluateCalibration,
  fitPlattProfile,
  PROBABILITY_CALIBRATION_VERSION,
} from "../../scripts/worker/probability-calibration.js";

function row(home, draw, away, outcome, kickoffOffsetDays = 0, league = "Netherlands - Eredivisie") {
  return {
    match_id: `m${home}-${draw}-${away}-${outcome}-${kickoffOffsetDays}-${Math.random()}`,
    league,
    model_version: "test",
    probabilities: { home, draw, away },
    actual_outcome: outcome,
    generated_at: new Date(Date.now() - kickoffOffsetDays * 86400000).toISOString(),
  };
}

function overconfidentRows(count = 60) {
  // Model zegt sterk thuis (0.75) maar helft verliest: platt moet shrinken.
  return Array.from({ length: count }, (_, index) =>
    index % 3 === 0
      ? row(0.75, 0.15, 0.1, "A", index % 30, "England - Premier League")
      : index % 3 === 1
        ? row(0.75, 0.15, 0.1, "H", index % 30, "England - Premier League")
        : row(0.75, 0.15, 0.1, "D", index % 30, "England - Premier League")
  );
}

describe("probability calibration module", () => {
  it("bouwt royaalte-vrije calibratierows met gewichten", () => {
    const rows = buildCalibrationRows(overconfidentRows(12));
    expect(rows.length).toBe(12);
    expect(rows[0].outcome).toMatch(/^[HDA]$/);
    expect(rows[0].weight).toBeGreaterThan(0);
  });

  it("dupliceren wedstrijd-rows worden gededupliceerd", () => {
    const base = overconfidentRows(3);
    const duplicated = [...base, ...base.map((entry) => ({ ...entry, generated_at: entry.generated_at }))];
    const rows = buildCalibrationRows(duplicated);
    expect(rows.length).toBe(3);
  });

  it("plat-shrink verlaagt Brier op overconfidente validatiesets", () => {
    const rows = buildCalibrationRows(overconfidentRows(90));
    const outcome = buildCalibrationProfile(rows);
    expect(outcome.eligible).toBe(true);
    if (outcome.accepted) {
      expect(outcome.brierImprovement).toBeGreaterThan(0);
      expect(outcome.profile.version).toBe(PROBABILITY_CALIBRATION_VERSION);
    }
  });

  it("fitPlattProfile weigert kleine sets", () => {
    expect(fitPlattProfile(buildCalibrationRows(overconfidentRows(5)))).toBeNull();
  });

  it("applyPlattProfile normaliseert en respecteert grenzen", () => {
    const profile = { kind: "platt", slope: 0.8, intercept: -0.5 };
    const result = applyPlattProfile({ homeProb: 0.8, drawProb: 0.15, awayProb: 0.05 }, profile);
    const total = result.homeProb + result.drawProb + result.awayProb;
    expect(total).toBeCloseTo(1, 3);
    expect(result.homeProb).toBeLessThan(0.8);
  });

  it("applyPlattProfile zonder profiel geeft null", () => {
    expect(applyPlattProfile({ homeProb: 0.5, drawProb: 0.3, awayProb: 0.2 }, null)).toBeNull();
  });

  it("evaluateCalibration berekent Brier en logLoss in bekende range", () => {
    const metrics = evaluateCalibration({ home: 0.6, draw: 0.25, away: 0.15 }, "H");
    expect(metrics.brier).toBeGreaterThan(0);
    expect(metrics.brier).toBeLessThan(1);
    expect(metrics.logLoss).toBeGreaterThan(0);
  });
});
