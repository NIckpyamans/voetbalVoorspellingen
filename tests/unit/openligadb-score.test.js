import { describe, expect, it } from "vitest";
import { selectOpenLigaDbFinalScore } from "../../scripts/worker/data-collection.js";

describe("OpenLigaDB final score selection", () => {
  const results = [
    {
      resultName: "Halbzeit",
      resultOrderID: 1,
      resultTypeKind: "HalfTime",
      pointsTeam1: 2,
      pointsTeam2: 0,
    },
    {
      resultName: "Endergebnis",
      resultOrderID: 2,
      resultTypeKind: "After90Minutes",
      pointsTeam1: 4,
      pointsTeam2: 1,
    },
  ];

  it("uses the final result instead of the first, usually half-time, result", () => {
    expect(selectOpenLigaDbFinalScore(results, true)).toEqual({ home: 4, away: 1 });
  });

  it("does not publish a partial score as final before the match is finished", () => {
    expect(selectOpenLigaDbFinalScore(results.slice(0, 1), false)).toEqual({ home: null, away: null });
  });
});
