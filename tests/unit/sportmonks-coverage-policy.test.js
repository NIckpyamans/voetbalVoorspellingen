import { describe, expect, it } from "vitest";
import {
  sportmonksEligibleFixtures,
  supportedSportmonksCountries,
} from "../../scripts/worker/sportmonks-coverage-policy.js";

const catalog = {
  domesticLeagueExamples: [
    { name: "Superliga", country: "Denmark" },
    { name: "Premiership", country: "Scotland" },
  ],
};

describe("Sportmonks coverage policy", () => {
  it("derives countries covered by the active subscription", () => {
    expect([...supportedSportmonksCountries(catalog)]).toEqual(["denmark", "scotland"]);
  });

  it("only schedules fixtures covered by the catalog", () => {
    const fixtures = [
      { league: "Denmark - Superliga", homeTeam: "A", awayTeam: "B" },
      { league: "Scotland - Premiership", homeTeam: "C", awayTeam: "D" },
      { league: "Europe - Conference League", homeTeam: "E", awayTeam: "F" },
      { league: "Netherlands - Eredivisie", homeTeam: "G", awayTeam: "H" },
    ];
    expect(sportmonksEligibleFixtures(fixtures, catalog)).toEqual(fixtures.slice(0, 2));
  });
});
