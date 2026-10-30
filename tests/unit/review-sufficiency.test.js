import { describe, expect, it } from "vitest";
import { rebindReviewToSnapshot } from "../../scripts/worker/snapshot-review-materialization.js";

function snapshot(overrides = {}) {
  return {
    matchId: "m1",
    generatedAt: "2026-08-13T10:00:00.000Z",
    kickoff: "2026-08-13T18:00:00.000Z",
    probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
    expectedScore: { home: 1, away: 0 },
    dataCompleteness: { score: 0.92, missing: [] },
    oddsAtPrediction: {
      home: 1.9,
      draw: 3.4,
      away: 4,
      capturedAt: "2026-08-13T09:00:00.000Z",
    },
    ...overrides,
  };
}

const review = {
  matchId: "m1",
  date: "2026-08-13",
  actualScore: "2-1",
  actualOutcome: "H",
  confidence: 0.5,
  predictedScore: "1-0",
};

describe("sufficiency bij het vastleggen van een review", () => {
  it("leidt de datakwaliteit af wanneer de snapshot die niet meelevert", () => {
    const bound = rebindReviewToSnapshot(review, snapshot());
    expect(bound.dataSufficiency).toMatchObject({ status: "voldoende", enoughInformation: true });
    expect(bound.dataCompleteness).toMatchObject({ score: 0.92 });
  });

  it("noemt de invoer onvoldoende bij een lage compleetheid", () => {
    const bound = rebindReviewToSnapshot(
      review,
      snapshot({ dataCompleteness: { score: 0.4, missing: ["h2h", "lineups", "odds"] } }),
    );
    expect(bound.dataSufficiency.status).toBe("onvoldoende");
    expect(bound.dataSufficiency.enoughInformation).toBe(false);
    expect(bound.dataSufficiency.reasons).toContain("te-veel-ontbrekende-bronnen");
  });

  it("houdt de vastgelegde status van de snapshot wanneer die er wel is", () => {
    const bound = rebindReviewToSnapshot(
      review,
      snapshot({ prediction: { dataSufficiency: { status: "beperkt", score: 0.7 } } }),
    );
    expect(bound.dataSufficiency.status).toBe("beperkt");
  });

  it("meldt onbekend in plaats van voldoende als er niets is vastgelegd", () => {
    const bound = rebindReviewToSnapshot(
      review,
      snapshot({ dataCompleteness: null, oddsAtPrediction: null }),
    );
    expect(bound.dataSufficiency.status).toBe("onbekend");
  });
});
