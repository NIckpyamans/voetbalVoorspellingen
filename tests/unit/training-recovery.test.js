import { describe, expect, it } from "vitest";
import { recoverTrainingRows, snapshotTrainingRow } from "../../scripts/worker/training-recovery.js";

const snapshot = {
  predictionId: "prediction-1",
  matchId: "match-1",
  date: "2026-07-20",
  league: "Netherlands - Eredivisie",
  homeTeam: "Ajax",
  awayTeam: "FC Twente",
  generatedAt: "2026-07-20T10:00:00.000Z",
  kickoff: "2026-07-20T11:15:00.000Z",
  inputSnapshotHash: "immutable",
  probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
  featureVector: { ppg_diff: 0.4 },
};

describe("immutable training recovery", () => {
  it("uses an immutable evaluation when a post-match review is absent", () => {
    expect(snapshotTrainingRow(snapshot, null, {
      actualOutcome: "H",
      finalHomeGoals: 2,
      finalAwayGoals: 1,
      evaluationSource: "r2-evaluator",
    })).toMatchObject({
      label: "H",
      score: "2-1",
      probabilities: snapshot.probabilities,
      recoverySource: "immutable_evaluation",
      review: { evaluationSource: "r2-evaluator" },
    });
  });

  it("does not create training evidence without a completed evaluation", () => {
    expect(snapshotTrainingRow(snapshot, null, null)).toBeNull();
  });

  it("joins evaluations by prediction id", () => {
    expect(recoverTrainingRows({
      predictionSnapshots: { "prediction-1": snapshot },
      postMatchReviews: {},
      evaluations: { "prediction-1": { actualOutcome: "D", finalHomeGoals: 1, finalAwayGoals: 1 } },
    })).toHaveLength(1);
  });
});
