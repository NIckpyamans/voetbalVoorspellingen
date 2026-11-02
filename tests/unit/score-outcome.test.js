import { describe, expect, it } from "vitest";
import { parseScoreline, scoreOutcome } from "../../shared/scoreOutcome.ts";

describe("score outcome", () => {
  it("separates 1X2 from the exact score", () => {
    expect(scoreOutcome("2-1")).toBe("H");
    expect(scoreOutcome("4-0")).toBe("H");
    expect(scoreOutcome("2-2")).toBe("D");
    expect(scoreOutcome("1-2")).toBe("A");
  });

  it("rejects missing or unsafe score labels", () => {
    expect(scoreOutcome(null)).toBeNull();
    expect(scoreOutcome("-")).toBeNull();
    expect(parseScoreline("" )).toBeNull();
    expect(parseScoreline("1-9007199254740992")).toBeNull();
  });

  it("parses valid scorelines consistently", () => {
    expect(parseScoreline(" 2 : 1 ")).toEqual({ home: 2, away: 1 });
  });
});
