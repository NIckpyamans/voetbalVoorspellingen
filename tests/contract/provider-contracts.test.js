import { describe, expect, it } from "vitest";
import { normalizeApiFootball, normalizeSofaScore, normalizeSportmonks } from "../../scripts/providers/lineup-normalizers.js";
import { fetchOddsAtPrediction, normalizeOddsSnapshot } from "../../scripts/odds-provider.js";

const players = Array.from({ length: 11 }, (_, index) => ({
  player: { name: `Speler ${index + 1}`, number: index + 1, pos: index === 0 ? "G" : "M" },
  substitute: false,
}));

describe("lineup provider contracts", () => {
  it("normalizes API-Football confirmed lineups", () => {
    const lineup = normalizeApiFootball({ response: [
      { formation: "4-3-3", startXI: players, substitutes: [] },
      { formation: "4-4-2", startXI: players, substitutes: [] },
    ] });
    expect(lineup?.confirmed).toBe(true);
    expect(lineup?.home?.starters).toBe(11);
  });

  it("normalizes Sportmonks and SofaScore without provider-specific leakage", () => {
    const rows = (teamId) => players.map((item) => ({ team_id: teamId, type_id: 11, player: item.player }));
    expect(normalizeSportmonks({ data: { participants: [
      { id: 1, meta: { location: "home" } }, { id: 2, meta: { location: "away" } },
    ], lineups: [...rows(1), ...rows(2)] } })?.confirmed).toBe(true);
    expect(normalizeSofaScore({ home: { players }, away: { players } })?.confirmed).toBe(true);
  });
});

describe("odds provider contract", () => {
  it("normalizes a The Odds API event and rejects post-kickoff data", () => {
    const raw = [{
      home_team: "Ajax", away_team: "PSV", commence_time: "2026-07-20T20:00:00.000Z",
      bookmakers: [{ title: "TestBook", last_update: "2026-07-20T19:00:00.000Z", markets: [{ key: "h2h", outcomes: [
        { name: "Ajax", price: 2.1 }, { name: "Draw", price: 3.4 }, { name: "PSV", price: 3.1 },
      ] }] }],
    }];
    const match = { homeTeam: "Ajax", awayTeam: "PSV", kickoff: "2026-07-20T20:00:00.000Z" };
    expect(normalizeOddsSnapshot(raw, match, { provider: "the-odds-api", generatedAt: "2026-07-20T19:05:00.000Z", cutoffAt: "2026-07-20T19:05:00.000Z" }).status).toBe("available");
    expect(normalizeOddsSnapshot({ home: 2, draw: 3, away: 4, capturedAt: "2026-07-20T20:01:00.000Z" }, match, { cutoffAt: "2026-07-20T20:02:00.000Z" }).status).toBe("rejected_after_cutoff");
  });

  it("skips inactive The Odds API sport keys before spending odds credits", async () => {
    const previous = {
      key: process.env.ODDS_API_KEY,
      template: process.env.ODDS_API_URL_TEMPLATE,
      provider: process.env.ODDS_PROVIDER_NAME,
      reserve: process.env.ODDS_API_MIN_REMAINING,
    };
    process.env.ODDS_API_KEY = "contract-inactive-sport-key";
    process.env.ODDS_PROVIDER_NAME = "the-odds-api";
    process.env.ODDS_API_URL_TEMPLATE = "https://api.the-odds-api.com/v4/sports/{sport}/odds/?apiKey={apiKey}";
    process.env.ODDS_API_MIN_REMAINING = "0";
    const requests = [];
    const fetchImpl = async (url) => {
      requests.push(String(url));
      return new Response(JSON.stringify([{ key: "soccer_epl", active: true }]), {
        status: 200,
        headers: { "content-type": "application/json", "x-requests-remaining": "20" },
      });
    };
    try {
      const result = await fetchOddsAtPrediction({
        league: "Europe - Conference League Qualification",
        homeTeam: "Ajax",
        awayTeam: "Vojvodina",
        kickoff: "2026-08-20T19:00:00.000Z",
      }, { fetchImpl, generatedAt: "2026-08-20T10:00:00.000Z", cutoffAt: "2026-08-20T10:00:00.000Z" });
      expect(result.status).toBe("unsupported_competition");
      expect(requests).toHaveLength(1);
      expect(requests[0]).toContain("/v4/sports/");
      expect(result.requestMeta.attempts.every((attempt) => attempt.status === "unsupported_sport")).toBe(true);
    } finally {
      if (previous.key === undefined) delete process.env.ODDS_API_KEY; else process.env.ODDS_API_KEY = previous.key;
      if (previous.template === undefined) delete process.env.ODDS_API_URL_TEMPLATE; else process.env.ODDS_API_URL_TEMPLATE = previous.template;
      if (previous.provider === undefined) delete process.env.ODDS_PROVIDER_NAME; else process.env.ODDS_PROVIDER_NAME = previous.provider;
      if (previous.reserve === undefined) delete process.env.ODDS_API_MIN_REMAINING; else process.env.ODDS_API_MIN_REMAINING = previous.reserve;
    }
  });
});
