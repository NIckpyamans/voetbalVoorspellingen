import { describe, expect, it } from "vitest";
import {
  aggregateOddspapiThreeWay,
  estimateOddspapiRequests,
  oddspapiQuotes,
  oddspapiThreeWay,
  oddspapiTournamentId,
} from "../../scripts/providers/oddspapi-provider.js";

function book(prices, { active = true, suspended = false } = {}) {
  const outcomes = {};
  for (const [index, outcomeId] of ["101", "102", "103"].entries()) {
    outcomes[outcomeId] = { players: { "0": { active, price: prices[index] } } };
  }
  return { bookmakerIsActive: active, suspended, markets: { "101": { outcomes } } };
}

describe("oddspapi 1X2 extraction", () => {
  it("leest markt 101 als thuis, gelijk, uit", () => {
    expect(oddspapiThreeWay(book([2.1, 3.4, 3.2]))).toEqual({ home: 2.1, draw: 3.4, away: 3.2 });
  });

  it("weigert een inactieve, opgeschorte of onvolledige bookmaker", () => {
    expect(oddspapiThreeWay(book([2.1, 3.4, 3.2], { active: false }))).toBeNull();
    expect(oddspapiThreeWay(book([2.1, 3.4, 3.2], { suspended: true }))).toBeNull();
    expect(oddspapiThreeWay({ markets: { "101": { outcomes: {} } } })).toBeNull();

    const incomplete = book([2.1, 3.4, 3.2]);
    incomplete.markets["101"].outcomes["103"].players["0"].active = false;
    expect(oddspapiQuotes({ a: book([2, 3, 3.5]), b: incomplete }).map((quote) => quote.bookmaker)).toEqual(["a"]);
  });
});

describe("oddspapi aggregation", () => {
  it("dedupliceert identieke prijstuples voordat de mediaan valt", () => {
    const quotes = [
      { bookmaker: "a", home: 2, draw: 3.2, away: 3.6 },
      { bookmaker: "b", home: 2, draw: 3.2, away: 3.6 },
      { bookmaker: "c", home: 2.1, draw: 3.1, away: 3.5 },
    ];
    expect(aggregateOddspapiThreeWay(quotes)).toMatchObject({
      bookmakers: 3,
      independentPrices: 2,
      home: 2.05,
      draw: 3.15,
      away: 3.55,
    });
    expect(aggregateOddspapiThreeWay([])).toBeNull();
  });

  it("telt de requests van een meting", () => {
    expect(estimateOddspapiRequests({ tournamentLookups: 1, bookmakers: 3, tournaments: 1 })).toMatchObject({
      oddsByTournament: 3,
      total: 4,
    });
  });

  it("vindt het toernooi-id op naam", () => {
    const tournaments = [
      { tournamentId: 131, tournamentName: "Eerste Divisie" },
      { tournamentId: 17, tournamentName: "Premier League" },
    ];
    expect(oddspapiTournamentId(tournaments, "eerste divisie")).toBe(131);
    expect(oddspapiTournamentId(tournaments, "Eredivisie")).toBeNull();
  });
});
