import { describe, expect, it } from "vitest";
import {
  extractGoalTimingFromMatch,
  goalQuarterFromMinute,
  summarizeGoalTiming,
} from "../../scripts/worker/goal-timing.js";

describe("stored goal timing", () => {
  it("handles regular and added-time minute labels", () => {
    expect(goalQuarterFromMinute("12")).toBe("q1_0_15");
    expect(goalQuarterFromMinute("45+2")).toBe("q3_31_45_plus");
    expect(goalQuarterFromMinute("90+4")).toBe("q6_76_90_plus");
  });

  it("extracts provider-neutral goal events for the requested side", () => {
    const match = {
      timeline: [
        { strTimeline: "Goal", side: "home", strTime: "14" },
        { strTimeline: "Goal", side: "away", strTime: "78" },
      ],
    };
    expect(extractGoalTimingFromMatch(match, "home")).toMatchObject({ q1_0_15: 1, q6_76_90_plus: 0 });
    expect(extractGoalTimingFromMatch(match, "away")).toMatchObject({ q1_0_15: 0, q6_76_90_plus: 1 });
  });

  it("summarizes scored and conceded timing with sample reliability", () => {
    const summary = summarizeGoalTiming([{
      goalQuartersFor: { q1_0_15: 1, q6_76_90_plus: 2 },
      goalQuartersAgainst: { q5_61_75: 1 },
    }]);
    expect(summary.scoredGoals).toBe(3);
    expect(summary.lateScoringShare).toBeCloseTo(2 / 3, 3);
    expect(summary.lateConcedingShare).toBe(1);
    expect(summary.reliability).toBe(0.2);
  });
});
