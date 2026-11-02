import { describe, expect, it } from "vitest";
import { inferOddsApiSportKeys, normalizeOddsSnapshot } from "../../scripts/odds-provider.js";

describe("odds api sport key mapping", () => {
  it("maps 2. Bundesliga to Bundesliga 2 instead of Bundesliga 1", () => {
    expect(inferOddsApiSportKeys({ league: "Germany - 2. Bundesliga" })[0]).toBe("soccer_germany_bundesliga2");
  });

  it("maps plain Bundesliga to Bundesliga 1", () => {
    expect(inferOddsApiSportKeys({ league: "Germany - Bundesliga" })[0]).toBe("soccer_germany_bundesliga");
  });

  it("maps Ligue 2 to Ligue 2 instead of falling back to soccer_epl", () => {
    expect(inferOddsApiSportKeys({ league: "France - Ligue 2" })[0]).toBe("soccer_france_ligue_two");
  });

  it("maps Belgian Pro League to its own key instead of falling back to soccer_epl", () => {
    expect(inferOddsApiSportKeys({ league: "Belgium - Pro League" })[0]).toBe("soccer_belgium_first_div");
  });

  it("maps La Liga 2 to Segunda Division instead of La Liga 1", () => {
    expect(inferOddsApiSportKeys({ league: "Spain - La Liga 2" })[0]).toBe("soccer_spain_segunda_division");
    expect(inferOddsApiSportKeys({ league: "Spain - La Liga" })[0]).toBe("soccer_spain_la_liga");
  });

  it("does not fall back to soccer_epl for an unknown competition", () => {
    expect(inferOddsApiSportKeys({ league: "Portugal - Unknown Cup" })).not.toContain("soccer_epl");
  });

  it("ignores odds events from another competition with the same team names", () => {
    const now = Date.now();
    const kickoff = new Date(now + 3600_000).toISOString();
    const cutoffAt = new Date(now).toISOString();
    const bookmaker = (price) => ({
      key: "b",
      title: "B",
      last_update: new Date(now - 60_000).toISOString(),
      markets: [{ key: "h2h", outcomes: [{ name: "Alpha", price }, { name: "Draw", price: 3.4 }, { name: "Beta", price: 2.2 }] }],
    });
    const payload = [
      { sport_key: "soccer_epl", home_team: "Alpha", away_team: "Beta", commence_time: kickoff, bookmakers: [bookmaker(9)] },
      { sport_key: "soccer_spain_segunda_division", home_team: "Alpha", away_team: "Beta", commence_time: kickoff, bookmakers: [bookmaker(1.8)] },
    ];
    const match = { homeTeam: "Alpha", awayTeam: "Beta", kickoff };
    const result = normalizeOddsSnapshot(payload, match, { cutoffAt, sportKey: "soccer_spain_segunda_division" });
    expect(result.oddsAtPrediction.home).toBe(1.8);
  });

  it("keeps Ligue 1 and other existing mappings intact", () => {
    expect(inferOddsApiSportKeys({ league: "France - Ligue 1" })[0]).toBe("soccer_france_ligue_one");
    expect(inferOddsApiSportKeys({ league: "England - Premier League" })[0]).toBe("soccer_epl");
    expect(inferOddsApiSportKeys({ league: "England - Championship" })[0]).toBe("soccer_efl_champ");
    expect(inferOddsApiSportKeys({ league: "Netherlands - Eredivisie" })[0]).toBe("soccer_netherlands_eredivisie");
    expect(inferOddsApiSportKeys({ league: "Europe - Champions League" })[0]).toBe("soccer_uefa_champs_league");
  });
});
