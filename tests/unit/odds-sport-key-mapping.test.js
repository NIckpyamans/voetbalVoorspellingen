import { describe, expect, it } from "vitest";
import { inferOddsApiSportKeys } from "../../scripts/odds-provider.js";

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

  it("keeps Ligue 1 and other existing mappings intact", () => {
    expect(inferOddsApiSportKeys({ league: "France - Ligue 1" })[0]).toBe("soccer_france_ligue_one");
    expect(inferOddsApiSportKeys({ league: "England - Premier League" })[0]).toBe("soccer_epl");
    expect(inferOddsApiSportKeys({ league: "England - Championship" })[0]).toBe("soccer_efl_champ");
    expect(inferOddsApiSportKeys({ league: "Netherlands - Eredivisie" })[0]).toBe("soccer_netherlands_eredivisie");
    expect(inferOddsApiSportKeys({ league: "Europe - Champions League" })[0]).toBe("soccer_uefa_champs_league");
  });
});
