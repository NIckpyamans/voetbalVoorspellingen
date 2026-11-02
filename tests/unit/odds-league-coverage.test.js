import { describe, expect, it } from "vitest";
import { orderOddsProviderConfigs, theOddsApiCoversLeague } from "../../scripts/odds-provider.js";
import { prioritizeMappings } from "../../scripts/map-upcoming-sportmonks-fixtures.js";

describe("odds coverage per competitie", () => {
  it("weet dat The Odds API de Nederlandse Eerste Divisie niet voert", () => {
    expect(theOddsApiCoversLeague("Netherlands - Eerste Divisie")).toBe(false);
    expect(theOddsApiCoversLeague("Netherlands - Eredivisie")).toBe(true);
    expect(theOddsApiCoversLeague("Germany - 2. Bundesliga")).toBe(true);
  });

  it("zet competities zonder Odds API-sportkey vooraan in de fixturemapping", () => {
    const rows = [
      { matchId: "eredivisie-later", league: "Netherlands - Eredivisie", kickoff: "2026-11-08T19:00:00.000Z" },
      { matchId: "eredivisie-vroeg", league: "Netherlands - Eredivisie", kickoff: "2026-11-03T19:00:00.000Z" },
      { matchId: "eerste-laat", league: "Netherlands - Eerste Divisie", kickoff: "2026-11-09T19:00:00.000Z" },
      { matchId: "eerste-vroeg", league: "Netherlands - Eerste Divisie", kickoff: "2026-11-04T19:00:00.000Z" },
    ];
    expect(prioritizeMappings(rows, 4).map((row) => row.matchId)).toEqual([
      "eerste-vroeg",
      "eerste-laat",
      "eredivisie-vroeg",
      "eredivisie-later",
    ]);
    expect(prioritizeMappings(rows, 2).map((row) => row.matchId)).toEqual(["eerste-vroeg", "eerste-laat"]);
  });

  it("zet Sportmonks voorop als de competitie geen Odds API-sportkey heeft", () => {
    const configs = [
      { provider: "the-odds-api", template: "https://api.the-odds-api.com/v4/sports/{sport}/odds/?apiKey={apiKey}" },
      { provider: "sportmonks", template: "https://api.sportmonks.com/v3/football/odds/pre-match/fixtures/{sportmonksFixtureId}?api_token={apiKey}" },
    ];
    const ordered = orderOddsProviderConfigs(configs, {
      league: "Netherlands - Eerste Divisie",
      sportmonksFixtureId: "19123456",
    });
    expect(ordered.map((config) => config.provider)).toEqual(["sportmonks", "the-odds-api"]);

    const covered = orderOddsProviderConfigs(configs, {
      league: "Netherlands - Eredivisie",
      sportmonksFixtureId: "19123456",
    });
    expect(covered.map((config) => config.provider)).toEqual(["the-odds-api", "sportmonks"]);

    const withoutFixtureId = orderOddsProviderConfigs(configs, { league: "Netherlands - Eerste Divisie" });
    expect(withoutFixtureId.map((config) => config.provider)).toEqual(["the-odds-api", "sportmonks"]);
  });
});
