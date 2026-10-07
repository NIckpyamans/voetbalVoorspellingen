import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/Matches.ts";
import { addDaysToDateKey } from "../../shared/date.js";

const { fetchDayDataMock, fetchServerStoreMock } = vi.hoisted(() => ({
  fetchDayDataMock: vi.fn(),
  fetchServerStoreMock: vi.fn(),
}));

vi.mock("../../api/_dataSource.js", () => ({
  fetchDayData: fetchDayDataMock,
  fetchMetaData: vi.fn(async () => ({ data: {} })),
  fetchRepoJson: vi.fn(async () => ({ data: {} })),
  fetchServerStore: fetchServerStoreMock,
}));

vi.mock("../../shared/database.js", () => ({
  buildMatchSourceCoverage: vi.fn(() => ({})),
  databaseConfigured: vi.fn(() => false),
  readDatabaseCounts: vi.fn(async () => null),
  readDatabaseDay: vi.fn(async () => null),
}));

vi.mock("../../shared/dashboardR2Cache.js", () => ({ readDashboardDayCache: vi.fn(async () => null) }));

afterEach(() => vi.clearAllMocks());
beforeEach(() => {
  fetchDayDataMock.mockImplementation(async (date) => ({
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
  }));
  fetchServerStoreMock.mockResolvedValue({ store: { matches: {} }, branch: "fixture-test" });
});

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

  it("keeps successful split days and labels dates still unavailable after fallback", async () => {
    const healthyDate = "2026-10-03";
    fetchDayDataMock.mockImplementation(async (date) => {
      if (date === "2026-10-04") throw new Error("missing split day");
      return {
        data: { matches: [{
          id: `fresh-${date}`,
          date,
          kickoff: `${date}T15:00:00.000Z`,
          league: "Netherlands - Eredivisie",
          homeTeamName: "Ajax",
          awayTeamName: "PSV Eindhoven",
        }] },
        branch: "codex/step3b-layout",
      };
    });
    fetchServerStoreMock.mockResolvedValue({
      store: { matches: {
        [healthyDate]: [{ id: "stale-duplicate", date: healthyDate, league: "Netherlands - Eredivisie", homeTeamName: "Feyenoord", awayTeamName: "Ajax" }],
        "2026-10-04": [{ id: "fallback-fixture", date: "2026-10-04", league: "Netherlands - Eredivisie", homeTeamName: "FC Utrecht", awayTeamName: "FC Twente" }],
        "2026-10-01": [{ id: "stale-outside-range", date: "2026-10-01", league: "Netherlands - Eredivisie", homeTeamName: "AZ", awayTeamName: "PSV" }],
      } },
      branch: "main",
    });

    const req = { query: { date: healthyDate, days: "3", range: "calendar" }, method: "GET", headers: {} };
    const res = responseStub();
    await handler(req, res);

    expect(res.result.statusCode).toBe(200);
    expect(res.result.body.matches.map((match) => match.id)).toEqual(["fresh-2026-10-03", "fallback-fixture", "fresh-2026-10-05"]);
    expect(res.result.body.sourceBranch).toBe("mixed:codex/step3b-layout,main");
    expect(res.result.body.unavailableDates).toBeUndefined();
    expect(res.result.body.matches.map((match) => match.id)).not.toContain("stale-duplicate");
    expect(res.result.body.matches.map((match) => match.id)).not.toContain("stale-outside-range");
  });

  it("reports missing dates instead of replacing a partial calendar with stale whole-store data", async () => {
    const healthyDate = "2026-10-03";
    fetchDayDataMock.mockImplementation(async (date) => {
      if (date === "2026-10-04") throw new Error("missing split day");
      return { data: { matches: [{
        id: `fresh-${date}`,
        date,
        kickoff: `${date}T15:00:00.000Z`,
        league: "Netherlands - Eredivisie",
        homeTeamName: "Ajax",
        awayTeamName: "PSV Eindhoven",
      }] }, branch: "codex/step3b-layout" };
    });
    fetchServerStoreMock.mockResolvedValue({ store: { matches: { [healthyDate]: [{ id: "stale-duplicate" }] } }, branch: "main" });

    const req = { query: { date: healthyDate, days: "3", range: "calendar" }, method: "GET", headers: {} };
    const res = responseStub();
    await handler(req, res);

    expect(res.result.statusCode).toBe(200);
    expect(res.result.body.matches.map((match) => match.id)).toEqual(["fresh-2026-10-03", "fresh-2026-10-05"]);
    expect(res.result.body.sourceBranch).toBe("codex/step3b-layout");
    expect(res.result.body.unavailableDates).toEqual(["2026-10-04"]);
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
