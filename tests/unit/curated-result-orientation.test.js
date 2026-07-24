import { describe, expect, it } from "vitest";
import { lookupCuratedResultBackfill } from "../../scripts/worker/validation.js";

const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const pairKey = (home, away) => [normalize(home), normalize(away)].sort().join("__");

describe("curated result orientation", () => {
  const results = [{ date: "2026-07-24", home: "Swansea City", away: "Udinese", score: "2-0", status: "FT" }];

  it("keeps a result in the original home-away order", () => {
    expect(lookupCuratedResultBackfill(results, pairKey, "2026-07-24", "Swansea City", "Udinese")?.score).toBe("2-0");
  });

  it("flips the score when a provider reports the fixture in reverse order", () => {
    expect(lookupCuratedResultBackfill(results, pairKey, "2026-07-24", "Udinese", "Swansea City")).toMatchObject({
      score: "0-2",
      orientedFromReverse: true,
    });
  });
});
