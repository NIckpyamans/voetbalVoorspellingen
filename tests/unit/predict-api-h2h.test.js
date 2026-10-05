import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/predict.ts";

vi.mock("../../api/_dataSource.js", () => ({
  fetchDayData: vi.fn(async () => ({
    data: {
      matches: [{
        id: "fixture-h2h-api",
        date: "2026-10-03",
        league: "Netherlands - Eredivisie",
        homeTeamName: "Almere City",
        awayTeamName: "FC Volendam",
        h2h: {
          played: 3,
          results: [{ score: "1-0" }, { score: "0-0" }, { score: "2-1" }],
          sameCompetitionPlayed: 2,
          status: "historical-competition",
          availabilityStatus: "available",
          source: "football-data.co.uk historical results",
          asOf: "2026-10-02T11:41:17.596Z",
        },
        h2hStatus: "historical-competition",
        h2hAvailability: "beschikbaar",
        h2hSource: "football-data.co.uk historical results",
        h2hAsOf: "2026-10-02T11:41:17.596Z",
        h2hPlayed: 3,
        h2hCompetitionPlayed: 2,
      }],
      predictions: [{
        matchId: "fixture-h2h-api",
        h2h: { played: 0, results: [], status: "provider_acceptance_blocked", availabilityStatus: "provider_acceptance_blocked" },
        h2hStatus: "provider_acceptance_blocked",
        h2hAvailability: "provider_acceptance_blocked",
        h2hSource: "api-football",
        h2hPlayed: 0,
        h2hCompetitionPlayed: 0,
      }],
      reviews: {},
    },
    branch: "fixture-test",
  })),
  fetchMetaData: vi.fn(async () => ({ data: {} })),
  fetchServerStore: vi.fn(async () => ({ store: {}, branch: "fixture-test" })),
}));

vi.mock("../../shared/database.js", () => ({
  databaseConfigured: vi.fn(() => false),
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

describe("prediction API H2H provenance", () => {
  it.each(["compact", "full"])("serves canonical match H2H in %s view", async (view) => {
    const req = { query: { date: "2026-10-03", view }, method: "GET", headers: {} };
    const res = responseStub();
    await handler(req, res);

    expect(res.result.statusCode).toBe(200);
    expect(res.result.body.predictions).toHaveLength(1);
    expect(res.result.body.predictions[0]).toMatchObject({
      h2hStatus: "historical-competition",
      h2hSource: "football-data.co.uk historical results",
      h2hAsOf: "2026-10-02T11:41:17.596Z",
      h2hAvailability: "beschikbaar",
      h2hPlayed: 3,
      h2hCompetitionPlayed: 2,
    });
    if (view === "full") {
      expect(res.result.body.predictions[0].h2h).toMatchObject({
        played: 3,
        status: "historical-competition",
        source: "football-data.co.uk historical results",
        sameCompetitionPlayed: 2,
      });
    }
  });
});
