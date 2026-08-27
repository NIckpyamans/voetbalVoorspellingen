import fs from "fs";
import { describe, expect, it } from "vitest";

describe("worker aggregate prediction contract", () => {
  it("passes the computed two-leg aggregate into predict", () => {
    const source = fs.readFileSync(new URL("../../scripts/server-worker.js", import.meta.url), "utf8");
    const predictionCall = source.match(/const prediction = predict\(\{[\s\S]*?\n\s*\}\);/u)?.[0] || "";

    expect(predictionCall).toContain("leagueType: leagueInfo.type");
    expect(predictionCall).toMatch(/leagueType: leagueInfo\.type,\s*aggregate,\s*context,/u);
  });
});
