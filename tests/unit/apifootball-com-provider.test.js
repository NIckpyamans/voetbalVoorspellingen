import { describe, expect, it } from "vitest";
import {
  apiFootballComSupportsLeague,
  apiFootballComRequest,
  fetchApiFootballComH2HProfile,
  normalizeApiFootballComLineup,
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
});
