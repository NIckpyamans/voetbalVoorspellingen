import { describe, expect, it } from "vitest";
import {
  apiFootballComSupportsLeague,
  apiFootballComRequest,
  fetchApiFootballComH2HProfile,
  fetchApiFootballComOdds,
  normalizeApiFootballComLineup,
  normalizeApiFootballComOdds,
  resetApiFootballComBudgetForTests,
} from "../../scripts/providers/apifootball-com-provider.js";

describe("APIfootball.com free competition policy", () => {
  it("allows only the two leagues in the perpetual free plan", () => {
    expect(apiFootballComSupportsLeague("England - Championship")).toBe(true);
    expect(apiFootballComSupportsLeague("France - Ligue 2")).toBe(true);
    expect(apiFootballComSupportsLeague("Europe - Champions League")).toBe(false);
  });

  it("normalizes confirmed lineup payloads", () => {
    const starters = Array.from({ length: 11 }, (_, index) => ({ lineup_player: `Player ${index}`, lineup_position: String(index + 1) }));
    const lineup = normalizeApiFootballComLineup({ 42: { lineup: { home: { starting_lineups: starters }, away: { starting_lineups: starters } } } }, "42");
    expect(lineup.confirmed).toBe(true);
    expect(lineup.home.starters).toBe(11);
  });

  it("builds H2H only inside supported leagues", async () => {
    resetApiFootballComBudgetForTests();
    const fetchImpl = async () => new Response(JSON.stringify([{ firstTeam_VS_secondTeam: [{ match_id: "1", match_date: "2026-01-01", match_hometeam_name: "A", match_awayteam_name: "B", match_hometeam_score: "2", match_awayteam_score: "1" }] }]), { status: 200 });
    const profile = await fetchApiFootballComH2HProfile({ homeName: "A", awayName: "B", leagueLabel: "England - Championship" }, { apiKey: "test", fetchImpl });
    expect(profile.results[0]).toMatchObject({ homeScore: 2, awayScore: 1, source: "APIfootball.com" });
  });

  it("never exposes the API key in report URLs", async () => {
    resetApiFootballComBudgetForTests();
    const result = await apiFootballComRequest("get_leagues", {}, {
      apiKey: "sensitive-key",
      fetchImpl: async () => new Response("[]", { status: 200 }),
    });
    expect(result.url).not.toContain("sensitive-key");
    expect(result.url).toContain("%5Bredacted%5D");
  });

  it("creates robust 1X2 consensus odds", () => {
    const odds = normalizeApiFootballComOdds([
      { match_id: "42", odd_bookmakers: "A", odd_1: "2.0", odd_x: "3.1", odd_2: "4.0", odd_date: "2026-08-20 10:00:00" },
      { match_id: "42", odd_bookmakers: "B", odd_1: "2.2", odd_x: "3.3", odd_2: "3.8", odd_date: "2026-08-20 11:00:00" },
    ], "42", "2026-08-20T11:05:00.000Z");
    expect(odds).toMatchObject({ home: 2.1, draw: 3.2, away: 3.9, provider: "apifootball-com" });
  });

  it("resolves a supported fixture before requesting its odds", async () => {
    resetApiFootballComBudgetForTests();
    const fetchImpl = async (url) => {
      const action = new URL(url).searchParams.get("action");
      if (action === "get_events") return new Response(JSON.stringify([{ match_id: "42", match_hometeam_name: "Leeds", match_awayteam_name: "Derby" }]), { status: 200 });
      return new Response(JSON.stringify([{ match_id: "42", odd_bookmakers: "A", odd_1: "2", odd_x: "3", odd_2: "4" }]), { status: 200 });
    };
    const result = await fetchApiFootballComOdds({ league: "England - Championship", homeTeam: "Leeds", awayTeam: "Derby", kickoff: "2026-08-22T14:00:00.000Z" }, { apiKey: "test", fetchImpl, generatedAt: "2026-08-20T12:00:00.000Z" });
    expect(result.status).toBe("available");
    expect(result.oddsAtPrediction).toMatchObject({ home: 2, draw: 3, away: 4 });
  });
});
