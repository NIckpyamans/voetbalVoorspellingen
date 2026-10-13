import { describe, expect, it } from "vitest";
import { buildPoissonScoreModel } from "../../scripts/worker/prediction.js";

const fullMatrixOptions = { maxGoals: 12, minMatrixProbability: 0 };

describe("poisson scoremodel", () => {
  it("normaliseert de volledige scorematrix tot 1 (inclusief Dixon-Coles tau)", () => {
    const model = buildPoissonScoreModel(1.4, 1.1, fullMatrixOptions);
    const total = Object.values(model.scoreMatrix).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it("houdt over/under en BTTS consistent met de genormaliseerde matrix", () => {
    const model = buildPoissonScoreModel(1.4, 1.1, fullMatrixOptions);
    const over25FromMatrix = Object.entries(model.scoreMatrix)
      .filter(([score]) => {
        const [homeGoals, awayGoals] = score.split("-").map(Number);
        return homeGoals + awayGoals > 2.5;
      })
      .reduce((sum, [, value]) => sum + value, 0);
    expect(model.over25).toBeCloseTo(over25FromMatrix, 2);
    expect(model.over25).toBeGreaterThanOrEqual(model.over35);
    expect(model.over15).toBeGreaterThanOrEqual(model.over25);
    expect(model.btts).toBeGreaterThan(0);
    expect(model.btts).toBeLessThanOrEqual(1);
  });

  it("komt overeen met de matrixcel van de beste exacte score", () => {
    const model = buildPoissonScoreModel(1.4, 1.1, fullMatrixOptions);
    expect(model.bestProb).toBeCloseTo(model.scoreMatrix[model.bestScore], 3);
  });

  it("houdt 1x2-kansen genormaliseerd tot 1", () => {
    const model = buildPoissonScoreModel(1.4, 1.1);
    expect(model.homeProb + model.drawProb + model.awayProb).toBeCloseTo(1, 6);
  });
});
