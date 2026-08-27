import { describe, expect, it } from "vitest";
import { runMonteCarloSimulation, scoreOutcome } from "../../scripts/worker/monte-carlo.js";

describe("wedstrijd Monte Carlo", () => {
  it("simuleert reproduceerbaar 10.000 wedstrijden en levert gemiddelden", () => {
    const first = runMonteCarloSimulation({ homeXG: 1.8, awayXG: 1.1, seed: 42, runs: 10000 });
    const second = runMonteCarloSimulation({ homeXG: 1.8, awayXG: 1.1, seed: 42, runs: 10000 });

    expect(first).toEqual(second);
    expect(first.simulations).toBe(10000);
    expect(first.averageHomeGoals).toBeGreaterThan(first.averageAwayGoals);
    expect(first.averageScore).toMatch(/^\d+-\d+$/);
    expect(first.homeProb + first.drawProb + first.awayProb).toBeCloseTo(1, 3);
  });

  it("classificeert een afgeronde gemiddelde score", () => {
    expect(scoreOutcome("2-1")).toBe("home");
    expect(scoreOutcome("1-1")).toBe("draw");
    expect(scoreOutcome("0-2")).toBe("away");
    expect(scoreOutcome("onbekend")).toBeNull();
  });
});
