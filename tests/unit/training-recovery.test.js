import { describe, expect, it } from "vitest";
import { buildLocalRecoveryLedger, recoverTrainingRows, serializeBoundedRecoveryLedger, snapshotTrainingRow } from "../../scripts/worker/training-recovery.js";

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

  it("projects a bounded local ledger retaining each required training window and only needed evaluation fields", () => {
    const preferred = { ...snapshot, predictionId: "preferred", snapshotWindow: "t20", dbFeatureContext: { noisyRawPayload: "x".repeat(100_000) } };
    const older = { ...snapshot, predictionId: "older", snapshotWindow: "t75", generatedAt: "2026-07-20T09:45:00.000Z", cutoffAt: "2026-07-20T09:45:00.000Z" };
    const projected = buildLocalRecoveryLedger({
      predictionSnapshots: { preferred, older },
      postMatchReviews: { "match-1": { matchId: "match-1", actualOutcome: "H", oversizedPayload: "x".repeat(100_000) } },
      evaluations: {
        preferred: { actualOutcome: "H", finalHomeGoals: 2, finalAwayGoals: 1, rawPayload: "x".repeat(100_000) },
        older: { actualOutcome: "A" },
      },
    });
    expect(Object.keys(projected.predictionSnapshots).sort()).toEqual(["older", "preferred"]);
    expect(projected.evaluations).toEqual({
      preferred: { actualOutcome: "H", finalHomeGoals: 2, finalAwayGoals: 1 },
      older: { actualOutcome: "A" },
    });
    expect(projected.postMatchReviews["match-1"]).not.toHaveProperty("oversizedPayload");
    expect(recoverTrainingRows(projected)).toHaveLength(1);
    expect(serializeBoundedRecoveryLedger(projected, { maxBytes: 10_000 })).toBe(JSON.stringify(projected));
  });

  it("rejects an oversized or circular recovery projection before serialization", () => {
    expect(() => serializeBoundedRecoveryLedger({ payload: "x".repeat(1000) }, { maxBytes: 100 }))
      .toThrow(/exceeds 100 byte limit/);
    const circular = {};
    circular.self = circular;
    expect(() => serializeBoundedRecoveryLedger(circular, { maxBytes: 1000 })).toThrow(/circular reference/);
  });

  it("selects only one preferred immutable snapshot per match and model during recovery", () => {
    const second = {
      ...snapshot,
      predictionId: "prediction-2",
      generatedAt: "2026-07-20T10:30:00.000Z",
      cutoffAt: "2026-07-20T10:30:00.000Z",
    };
    const rows = recoverTrainingRows({
      predictionSnapshots: { "prediction-1": snapshot, "prediction-2": second },
      postMatchReviews: {},
      evaluations: {
        "prediction-1": { actualOutcome: "H", finalHomeGoals: 2, finalAwayGoals: 1 },
        "prediction-2": { actualOutcome: "D", finalHomeGoals: 1, finalAwayGoals: 1 },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].predictionId).toBe("prediction-2");
  });
});
