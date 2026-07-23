import { describe, expect, it } from "vitest";
import {
  addEvaluationResult,
  createEvaluationResultIndex,
  resolveEvaluationResult,
} from "../../scripts/worker/evaluation-result-matching.js";

const result = {
  id: "sky-123",
  date: "2026-07-22",
  homeTeamName: "Bohemians",
  awayTeamName: "Ballkani",
  status: "FT",
  score: "2-1",
};

describe("evaluation result matching", () => {
  it("prefers an exact provider id", () => {
    const index = createEvaluationResultIndex();
    addEvaluationResult(index, result.id, result);
    expect(resolveEvaluationResult(index, { matchId: result.id })).toMatchObject({ matchType: "direct", result });
  });

  it("links a pre-match snapshot after a provider id migration", () => {
    const index = createEvaluationResultIndex();
    addEvaluationResult(index, result.id, result);
    expect(resolveEvaluationResult(index, {
      matchId: "bbc-old-id",
      date: "2026-07-22",
      homeTeam: "Bohemians FC",
      awayTeam: "Ballkani",
    })).toMatchObject({ matchType: "canonical", result });
  });

  it("does not link a reverse fixture", () => {
    const index = createEvaluationResultIndex();
    addEvaluationResult(index, result.id, result);
    expect(resolveEvaluationResult(index, {
      matchId: "reverse-leg",
      date: "2026-07-22",
      homeTeam: "Ballkani",
      awayTeam: "Bohemians",
    }).result).toBeNull();
  });

  it("rejects conflicting scores for the same canonical fixture", () => {
    const index = createEvaluationResultIndex();
    addEvaluationResult(index, result.id, result);
    addEvaluationResult(index, "other-source", { ...result, id: "other-source", score: "1-1" });
    expect(resolveEvaluationResult(index, {
      matchId: "legacy-source",
      date: "2026-07-22",
      homeTeam: "Bohemians",
      awayTeam: "Ballkani",
    })).toMatchObject({ result: null, matchType: "ambiguous" });
  });
});
