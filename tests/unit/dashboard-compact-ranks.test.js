import { describe, expect, it } from "vitest";
import { compactDashboardMatch } from "../../shared/dashboardCompact.js";

describe("compact dashboard match standings positions", () => {
  it("retains home and away competition positions in the compact API payload", () => {
    const compact = compactDashboardMatch({
      id: "fixture-1",
      league: "Netherlands - Eerste Divisie",
      homeTeamName: "TOP Oss",
      awayTeamName: "MVV Maastricht",
      homePos: 20,
      awayPos: 3,
    });

    expect(compact).toMatchObject({ homePos: 20, awayPos: 3 });
  });

  it("keeps missing ranks null rather than inventing positions", () => {
    const compact = compactDashboardMatch({ id: "fixture-2", homePos: null });
    expect(compact.homePos).toBeNull();
    expect(compact.awayPos).toBeNull();
  });
});
