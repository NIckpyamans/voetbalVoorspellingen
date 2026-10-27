import { describe, expect, it } from "vitest";
import {
  buildMarketOddsEntries,
  favoriteFromOdds,
  footballDataSeason,
  marketOddsKey,
  parseFootballDataCsv,
} from "../../shared/marketOdds.js";
import { buildMatchStore } from "../../shared/matchStore.js";

const CSV = [
  "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,AvgH,AvgD,AvgA,AvgCH,AvgCD,AvgCA",
  "E0,05/04/2026,Man City,Arsenal,1,2,2.10,3.40,3.50,2.05,3.50,3.60",
  'E0,12/04/2026,"Nott\'m Forest",Liverpool,0,0,5.50,3.90,1.65,,,,',
  "E0,12/04/2026,Leeds,Sunderland,0,0,3.10,3.20,2.40,,,,",
  "E0,19/04/2026,Brentford,Chelsea,1,1,,,,,,",
].join("\n");

describe("parseFootballDataCsv", () => {
  it("parset datums, uitslagen en verkiest de closing-marktconsensus", () => {
    const rows = parseFootballDataCsv(CSV, "E0");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      date: "2026-04-05",
      home: "Man City",
      away: "Arsenal",
      homeGoals: 1,
      awayGoals: 2,
      leagueCode: "E0",
    });
    // AvgCH/CD/CA (closing) wint van de niet-closing Average-kolom.
    expect(rows[0].odds).toMatchObject({ bookmaker: "AvgClosing", home: 2.05, draw: 3.5, away: 3.6 });
    // Zonder closing-kolommen valt terug op de marktgemiddelden.
    expect(rows[1].odds).toMatchObject({ bookmaker: "MarketAvg", home: 5.5, draw: 3.9, away: 1.65 });
    // Rij zonder odds blijft wel meedoen aan de ambiguïteitscontrole.
    expect(rows[3].odds).toBeNull();
  });
});

describe("footballDataSeason", () => {
  it("mapt data op het juiste seizoen (competities starten in juli)", () => {
    expect(footballDataSeason("2026-04-05")).toBe("2526");
    expect(footballDataSeason("2026-06-30")).toBe("2526");
    expect(footballDataSeason("2026-07-20")).toBe("2627");
    expect(footballDataSeason("2026-10-12")).toBe("2627");
    expect(footballDataSeason("")).toBeNull();
  });
});

describe("favoriteFromOdds", () => {
  it("kiest de laagste odd en verwerpt ongeldige triples", () => {
    expect(favoriteFromOdds(2.05, 3.5, 3.6)).toBe("H");
    expect(favoriteFromOdds(5.5, 3.9, 1.65)).toBe("A");
    expect(favoriteFromOdds(3.1, 3.1, 2.4)).toBe("A");
    expect(favoriteFromOdds(0, 0, 0)).toBeNull();
    expect(favoriteFromOdds(2.1, Number.NaN, 3)).toBeNull();
  });
});

describe("buildMarketOddsEntries", () => {
  const record = (overrides) => ({
    lg: "England - Premier League",
    d: "2026-04-05",
    h: "Manchester City",
    a: "Arsenal",
    hs: 1,
    as: 2,
    hit: false,
    ao: "A",
    ...overrides,
  });

  it("koppelt op datum + competitie + uitslag met naam als tiebreak", () => {
    const { entries, stats } = buildMarketOddsEntries([record({})], parseFootballDataCsv(CSV, "E0"));
    expect(entries[marketOddsKey("2026-04-05", "Manchester City", "Arsenal")]).toEqual([2.05, 3.5, 3.6]);
    expect(stats.joined).toBe(1);
    expect(stats.existingPreMatch).toBe(0);
  });

  it("laat records met al een pre-match mk ongemoeid", () => {
    const { entries, stats } = buildMarketOddsEntries(
      [record({ mk: "H" })],
      parseFootballDataCsv(CSV, "E0"),
    );
    expect(Object.keys(entries)).toHaveLength(0);
    expect(stats.existingPreMatch).toBe(1);
  });

  it("markeert competities buiten de dekking en dubieuze koppelingen", () => {
    const rows = parseFootballDataCsv(CSV, "E0");
    const uncovered = buildMarketOddsEntries(
      [record({ lg: "World - Club Friendlies" })],
      rows,
    );
    expect(uncovered.stats.uncoveredLeague).toBe(1);

    // Twee 0-0-rijen op 12/04 waarvan geen enkele naam matcht -> ambigu.
    const ambiguous = buildMarketOddsEntries(
      [record({ d: "2026-04-12", h: "Wolves", a: "Everton", hs: 0, as: 0 })],
      rows,
    );
    expect(ambiguous.stats.ambiguous).toBe(1);
    expect(Object.keys(ambiguous.entries)).toHaveLength(0);

    // "Nott'm Forest" tegenover "Nottingham Forest": weinig namen matchen wel
    // uniek binnen de datum/competitie/uitslag-slot, dus wél koppelen.
    const fuzzy = buildMarketOddsEntries(
      [record({ d: "2026-04-12", h: "Nottingham Forest", a: "Liverpool", hs: 0, as: 0 })],
      rows,
    );
    expect(fuzzy.stats.joined).toBe(1);
    expect(fuzzy.entries[marketOddsKey("2026-04-12", "Nottingham Forest", "Liverpool")]).toEqual([
      5.5, 3.9, 1.65,
    ]);
  });
});

describe("buildMatchStore marktbaseline-fallback", () => {
  const review = (overrides) => ({
    date: "2026-04-05",
    league: "England - Premier League",
    homeTeamName: "Manchester City",
    awayTeamName: "Arsenal",
    homeScore: 1,
    awayScore: 2,
    predictedOutcome: "H",
    actualOutcome: "A",
    confidence: 0.5,
    outcomeHit: false,
    exactHit: false,
    totalGoalError: 1,
    ...overrides,
  });

  it("vult mk/mh vanuit het marktbestand als oddsAtPrediction ontbreekt", () => {
    const store = buildMatchStore({
      reviews: { r1: review({}) },
      marketOdds: {
        entries: {
          [marketOddsKey("2026-04-05", "Manchester City", "Arsenal")]: [2.05, 3.5, 3.6],
        },
      },
    });
    const record = Object.values(store.matches)[0];
    expect(record.mk).toBe("H");
    expect(record.mh).toBe(false);
    expect(record.mks).toBe("fdc");
  });

  it("geeft pre-match oddsAtPrediction altijd voorrang en houdt die ongemarkeerd", () => {
    const store = buildMatchStore({
      reviews: {
        r1: review({
          date: "2026-04-12",
          oddsAtPrediction: { home: 3.4, draw: 3.3, away: 2.2 },
          actualOutcome: "A",
          outcomeHit: true,
        }),
      },
      marketOdds: {
        entries: {
          [marketOddsKey("2026-04-12", "Manchester City", "Arsenal")]: [2.05, 3.5, 3.6],
        },
      },
    });
    const record = Object.values(store.matches)[0];
    expect(record.mk).toBe("A");
    expect(record.mh).toBe(true);
    expect(record.mks).toBeUndefined();
  });

  it("laat records ongemoeid wanneer het marktbestand niets heeft", () => {
    const store = buildMatchStore({
      reviews: { r1: review({}) },
      marketOdds: { entries: {} },
    });
    const record = Object.values(store.matches)[0];
    expect(record.mk).toBeUndefined();
    expect(record.mh).toBeUndefined();
  });
});
