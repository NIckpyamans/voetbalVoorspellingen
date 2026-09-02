import { describe, expect, it } from "vitest";
import { buildSnapshotBackedReview, evaluateImmutableSnapshot } from "../../scripts/worker/snapshot-evaluation.js";

describe("immutable snapshot evaluation", () => {
  it("evaluates a pre-kickoff exact result", () => {
    const result = evaluateImmutableSnapshot({
      predictionId: "prediction",
      matchId: "match",
      generatedAt: "2026-07-23T10:00:00.000Z",
      kickoff: "2026-07-23T11:00:00.000Z",
      inputSnapshotHash: "immutable",
      features: { ppg_diff: 0.4 },
      probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
      expectedScore: { home: 1, away: 0 },
    }, { finalHomeGoals: 1, finalAwayGoals: 0, actualOutcome: "H" });
    expect(result).toMatchObject({ exactHit: true, outcomeHit: true });
  });

  it("links an immutable evaluation back to a snapshot-backed review", () => {
    const snapshot = {
      predictionId: "prediction",
      matchId: "match",
      date: "2026-08-13",
      league: "Netherlands - Eredivisie",
      homeTeam: "Ajax",
      awayTeam: "Excelsior",
      generatedAt: "2026-08-12T18:00:00.000Z",
      kickoff: "2026-08-13T18:00:00.000Z",
      inputSnapshotHash: "immutable",
      features: { ppg_diff: 0.5 },
      probabilities: { home: 0.6, draw: 0.25, away: 0.15 },
      expectedScore: { home: 2, away: 0 },
      modelVersion: "v23",
    };
    const evaluation = evaluateImmutableSnapshot(snapshot, {
      finalHomeGoals: 2,
      finalAwayGoals: 1,
      actualOutcome: "H",
    });
    expect(buildSnapshotBackedReview(snapshot, {}, evaluation)).toMatchObject({
      predictionId: "prediction",
      predictedScore: "2-0",
      actualScore: "2-1",
      outcomeHit: true,
      exactHit: false,
      evaluationSource: "prediction_snapshot",
      leakageRisk: null,
    });
  });
});
