import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workerPath = path.resolve(process.cwd(), "scripts/server-worker.js");

describe("prediction input ordering", () => {
  it("captures timestamped odds before prediction and passes segmentation context", () => {
    const source = fs.readFileSync(workerPath, "utf8");
    const runStart = source.indexOf("let oddsCapture = ODDS_FETCH_ENABLED");
    const predictionStart = source.indexOf("const prediction = predict({", runStart);

    expect(runStart).toBeGreaterThan(-1);
    expect(predictionStart).toBeGreaterThan(runStart);

    const predictionInput = source.slice(predictionStart, predictionStart + 1_500);
    expect(predictionInput).toContain("league: leagueInfo.label");
    expect(predictionInput).toContain("phaseBucket,");
    expect(predictionInput).toContain("kickoff,");
    expect(predictionInput).toContain("oddsAtPrediction");
  });
});
