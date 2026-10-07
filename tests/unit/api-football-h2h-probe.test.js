import { describe, expect, it, vi } from "vitest";
import { collectApiFootballH2HProbePairs } from "../../scripts/probe-api-football-h2h.js";
import { probeApiFootballH2HPairs } from "../../scripts/providers/api-football-h2h-probe.js";

function match(id, league, homeTeamName, awayTeamName, kickoff, h2h = { played: 0 }) {
  return { id, league, homeTeamName, awayTeamName, kickoff, h2h };
}

describe("API-Football H2H read-only probe", () => {
  it("selects capped, uncovered eligible domestic candidates by league", () => {
    const now = Date.parse("2026-10-01T00:00:00Z");
    const days = {
      "2026-10-02.json": { matches: [
        match("1", "Netherlands - Eredivisie", "Ajax", "PSV", "2026-10-02T18:00:00Z"),
        match("2", "Netherlands - Eredivisie", "Feyenoord", "Twente", "2026-10-02T20:00:00Z"),
        match("3", "Europe - Champions League", "Ajax", "PSV", "2026-10-02T19:00:00Z"),
      ] },
      "2026-10-03.json": { matches: [
        match("4", "Germany - Bundesliga", "Bayern", "Dortmund", "2026-10-03T17:00:00Z", { played: 2 }),
        match("5", "France - Ligue 1", "PSG", "Lyon", "2026-10-03T19:00:00Z"),
      ] },
    };
    const fsImpl = { existsSync: () => true, readdirSync: () => Object.keys(days), readFileSync: (file) => JSON.stringify(days[file.split(/[\\/]/).at(-1)]) };
    const pairs = collectApiFootballH2HProbePairs("root", { daysAhead: 21, maxPairs: 9, now, fsImpl, getProviderIds: () => ({}) });
    expect(pairs).toHaveLength(3);
    expect(pairs.map((pair) => pair.league)).toEqual(["Netherlands - Eredivisie", "France - Ligue 1", "Netherlands - Eredivisie"]);
  });

  it("caps pairs and requests and only returns verified completed pre-kickoff H2H rows", async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes("/teams?")) {
        const name = new URL(url).searchParams.get("search");
        const id = name === "Ajax" ? 1 : 2;
        return new Response(JSON.stringify({ response: [{ team: { id, name, country: "Netherlands" } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ response: [
        { fixture: { id: 1, date: "2025-01-01T10:00:00Z", status: { short: "FT" } }, teams: { home: { id: 1, name: "Ajax" }, away: { id: 2, name: "PSV" } }, goals: { home: 2, away: 1 } },
        { fixture: { id: 2, date: "2027-01-01T10:00:00Z", status: { short: "FT" } }, teams: { home: { id: 1, name: "Ajax" }, away: { id: 2, name: "PSV" } }, goals: { home: 3, away: 1 } },
        { fixture: { id: 3, date: "2024-01-01T10:00:00Z", status: { short: "NS" } }, teams: { home: { id: 1, name: "Ajax" }, away: { id: 2, name: "PSV" } }, goals: { home: 1, away: 0 } },
      ] }), { status: 200 });
    });
    const result = await probeApiFootballH2HPairs([
      { matchId: "1", league: "Netherlands - Eredivisie", homeTeam: "Ajax", awayTeam: "PSV", kickoff: "2026-10-02T18:00:00Z" },
      { matchId: "2", league: "Netherlands - Eredivisie", homeTeam: "Ajax", awayTeam: "PSV", kickoff: "2026-10-02T18:00:00Z" },
    ], { apiKey: "test", maxPairs: 50, maxRequests: 99, fetchImpl });
    expect(result.pairLimit).toBe(5);
    expect(result.requestLimit).toBe(15);
    expect(result.requests).toBe(4);
    expect(result.results[0]).toMatchObject({ status: "history_found", historyCount: 1 });
    expect(result.results[0].history[0]).toMatchObject({ fixtureId: "1", homeGoals: 2, awayGoals: 1 });
    expect(result.results[0].history).toHaveLength(1);
  });

  it("does not choose an ambiguous fuzzy team result and returns candidates for manual mapping", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ response: [
      { team: { id: 10, name: "FC Example", country: "England" } },
      { team: { id: 11, name: "Example United", country: "England" } },
    ] }), { status: 200 }));
    const result = await probeApiFootballH2HPairs([
      { league: "England - Premier League", homeTeam: "Example", awayTeam: "Other" },
    ], { apiKey: "test", maxRequests: 2, fetchImpl });
    expect(result.results[0].status).toContain("mapping_missing");
    expect(result.mappingFailures[0].candidatesForManualReview).toHaveLength(2);
    expect(result.requests).toBe(2);
  });

  it("stops immediately when the provider reports exhausted quota", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ errors: { requests: "daily quota exhausted" }, response: [] }), {
      status: 429,
      headers: { "x-ratelimit-requests-remaining": "0" },
    }));
    const result = await probeApiFootballH2HPairs([
      { league: "England - Premier League", homeTeam: "Arsenal", awayTeam: "Chelsea" },
      { league: "France - Ligue 1", homeTeam: "PSG", awayTeam: "Lyon" },
    ], { apiKey: "test", maxPairs: 2, maxRequests: 6, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.results.map((row) => row.status)).toEqual(["provider_quota_exhausted", "provider_quota_exhausted"]);
  });

  it("uses configured team ids without spending search requests", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ response: [] }), { status: 200 }));
    const result = await probeApiFootballH2HPairs([
      { league: "England - Premier League", homeTeam: "Arsenal", awayTeam: "Chelsea", homeTeamId: "42", awayTeamId: "49" },
    ], { apiKey: "test", fetchImpl });
    expect(result.requests).toBe(1);
    expect(fetchImpl.mock.calls[0][0].toString()).toContain("h2h=42-49");
  });
});
