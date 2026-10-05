import { describe, expect, it } from "vitest";
import { advanceRollingCalendarStart, countFixturesByDate, rollingCalendarEnd } from "../../shared/calendarMatches.js";

describe("rolling compact calendar helpers", () => {
  it("counts each fixture once by date, including followed European competitions", () => {
    const counts = countFixturesByDate([
      { id: "domestic", date: "2026-10-03", league: "Netherlands - Eerste Divisie" },
      { id: "ucl", kickoff: "2026-10-20T16:45:00.000Z", league: "Europe - Champions League" },
      { id: "outside", date: "2026-10-22", league: "Europe - Europa League" },
      { id: "invalid", date: "", league: "England - Premier League" },
    ], "2026-10-01", "2026-10-21");

    expect([...counts.entries()]).toEqual([["2026-10-03", 1], ["2026-10-20", 1]]);
  });

  it("keeps the calendar rolling from today and spans exactly 21 days", () => {
    expect(advanceRollingCalendarStart("2026-10-01", "2026-10-02")).toBe("2026-10-02");
    expect(advanceRollingCalendarStart("2026-10-10", "2026-10-02", false)).toBe("2026-10-10");
    expect(advanceRollingCalendarStart("2026-10-10", "2026-10-11", true)).toBe("2026-10-11");
    expect(rollingCalendarEnd("2026-10-02", 21)).toBe("2026-10-22");
  });
});
