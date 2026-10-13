import { describe, expect, it } from "vitest";
import { buildLineupOutcomeModel, powerDevig } from "../../scripts/worker/outcome-ensemble.js";
import { buildPoissonScoreModel } from "../../scripts/worker/prediction.js";
import { runMonteCarloSimulation } from "../../scripts/worker/monte-carlo.js";

describe("lineup model draw calibration", () => {
  it("gives roughly the 27% base draw rate when the teams are level", () => {
    const result = buildLineupOutcomeModel({}, true);
    expect(result.drawProb).toBeGreaterThan(0.25);
    expect(result.drawProb).toBeLessThan(0.29);
  });
});

describe("power devigging of bookmaker odds", () => {
  it("sums to one and takes less margin from the outsiders than proportional devigging", () => {
    const implied = [1 / 2, 1 / 3.5, 1 / 4];
    const power = powerDevig(implied);
    const total = implied.reduce((sum, value) => sum + value, 0);
    const proportional = implied.map((value) => value / total);
    expect(power.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 9);
    expect(power[0]).toBeGreaterThan(proportional[0]);
    expect(power[1]).toBeLessThan(proportional[1]);
  });

  it("falls back to proportional normalisation when there is no margin", () => {
    const result = powerDevig([0.4, 0.3, 0.2]);
    expect(result.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 9);
  });
});

describe("Poisson score matrix coverage", () => {
  it("keeps more probability mass inside the matrix than the old 6-goal limit", () => {
    const wide = buildPoissonScoreModel(4.5, 4, {});
    const narrow = buildPoissonScoreModel(4.5, 4, { maxGoals: 6 });
    expect(wide.modelCoverage).toBeGreaterThan(narrow.modelCoverage);
    // Gemeten: maxGoals 10 dekt ~0,99 van de kansmassa bij xG 4,5 vs 4,0 (6 dekt 0,74).
    expect(wide.modelCoverage).toBeGreaterThan(0.97);
  });
});

describe("Monte Carlo consistency with the analytic model", () => {
  it("does not truncate high-scoring tails at 9 goals", () => {
    const simulated = runMonteCarloSimulation({ homeXG: 7, awayXG: 0.05, seed: 7, runs: 20000 });
    expect(simulated.averageHomeGoals).toBeGreaterThan(6.9);
    expect(simulated.averageHomeGoals).toBeLessThan(7.1);
  });

  it("matches the Poisson model's 1X2 probabilities for the same expected goals", () => {
    const analytic = buildPoissonScoreModel(1.4, 1.1, {});
    const simulated = runMonteCarloSimulation({ homeXG: 1.4, awayXG: 1.1, seed: 11, runs: 40000 });
    expect(Math.abs(simulated.drawProb - analytic.drawProb)).toBeLessThan(0.02);
    expect(Math.abs(simulated.homeProb - analytic.homeProb)).toBeLessThan(0.02);
    expect(Math.abs(simulated.awayProb - analytic.awayProb)).toBeLessThan(0.02);
  });
});
