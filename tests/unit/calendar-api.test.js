import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/Matches.ts";
import { addDaysToDateKey } from "../../shared/date.js";

vi.mock("../../api/_dataSource.js", () => ({
  fetchDayData: vi.fn(async (date) => ({
    data: {
      matches: date === "2026-10-03" ? [{
        id: "fixture-rank-goal",
        date,
        kickoff: `${date}T15:00:00.000Z`,
        status: "LIVE",
        league: "Netherlands - Eerste Divisie",
        homeTeamId: "home",
        awayTeamId: "away",
        homeTeamName: "TOP Oss",
        awayTeamName: "MVV Maastricht",
        homeLogo: "",
        awayLogo: "",
        homePos: 20,
        awayPos: 3,
        goalMinuteEvents: [{ id: "33-home", minute: "33", side: "home", teamName: "TOP Oss", playerName: "Scorer", kind: "goal" }],
      }] : [],
      reviews: {},
    },
    branch: "fixture-test",
  })),
  fetchMetaData: vi.fn(async () => ({ data: {} })),
  fetchRepoJson: vi.fn(async () => ({ data: {} })),
  fetchServerStore: vi.fn(async () => ({ store: { matches: {} }, branch: "fixture-test" })),
}));

vi.mock("../../shared/database.js", () => ({
  buildMatchSourceCoverage: vi.fn(() => ({})),
  databaseConfigured: vi.fn(() => false),
  readDatabaseCounts: vi.fn(async () => null),
  readDatabaseDay: vi.fn(async () => null),
}));

vi.mock("../../shared/dashboardR2Cache.js", () => ({ readDashboardDayCache: vi.fn(async () => null) }));

afterEach(() => vi.clearAllMocks());

function responseStub() {
  const result = { headers: {}, statusCode: 200, body: null };
  return {
    result,
    setHeader(name, value) { result.headers[name] = value; return this; },
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; },
  };
}

describe("matches calendar range API", () => {
  it("serves 21 forward days with compact ranks and goal-minute events", async () => {
    const req = { query: { date: "2026-10-01", days: "21", range: "calendar" }, method: "GET", headers: {} };
    const res = responseStub();
    await handler(req, res);

    expect(res.result.statusCode).toBe(200);
    expect(res.result.body.dateRange).toBe("2026-10-01 t/m 2026-10-21");
    expect(res.result.body.matches).toHaveLength(1);
    expect(res.result.body.matches[0]).toMatchObject({
      homePos: 20,
      awayPos: 3,
      goalMinuteEvents: [{ minute: "33", side: "home", kind: "goal" }],
    });
    expect(res.result.headers["Cache-Control"]).toContain("s-maxage=60");
  });

  it("keeps normal multi-day calls centered and capped at seven days", async () => {
    const req = { query: { date: "2026-10-03", days: "3" }, method: "GET", headers: {} };
    const res = responseStub();
    await handler(req, res);

    expect(res.result.statusCode).toBe(200);
    expect(res.result.body.dateRange).toBe("3 dagen");
    const { fetchDayData } = await import("../../api/_dataSource.js");
    expect(vi.mocked(fetchDayData).mock.calls.map(([date]) => date)).toEqual([
      addDaysToDateKey("2026-10-03", -1),
      "2026-10-03",
      addDaysToDateKey("2026-10-03", 1),
    ]);
  });
});
