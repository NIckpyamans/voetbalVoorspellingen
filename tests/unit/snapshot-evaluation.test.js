import { describe, expect, it } from "vitest";
import { evaluateImmutableSnapshot } from "../../scripts/worker/snapshot-evaluation.js";

describe("immutable snapshot evaluation", () => {
  it("evaluates a pre-kickoff exact result", () => {
    const result = evaluateImmutableSnapshot({
      predictionId: "prediction",
      matchId: "match",
      generatedAt: "2026-07-23T10:00:00.000Z",
      kickoff: "2026-07-23T11:00:00.000Z",
      probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
      expectedScore: { home: 1, away: 0 },
    }, { finalHomeGoals: 1, finalAwayGoals: 0, actualOutcome: "H" });
    expect(result).toMatchObject({ exactHit: true, outcomeHit: true });
  });
});
