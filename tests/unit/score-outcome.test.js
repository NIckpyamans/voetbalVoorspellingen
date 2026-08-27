import { describe, expect, it } from "vitest";
import { scoreOutcome } from "../../shared/scoreOutcome.ts";

describe("score outcome", () => {
  it("separates 1X2 from the exact score", () => {
    expect(scoreOutcome("2-1")).toBe("H");
    expect(scoreOutcome("4-0")).toBe("H");
    expect(scoreOutcome("2-2")).toBe("D");
    expect(scoreOutcome("1-2")).toBe("A");
  });

  it("rejects missing score labels", () => {
    expect(scoreOutcome(null)).toBeNull();
    expect(scoreOutcome("-")).toBeNull();
  });
});
