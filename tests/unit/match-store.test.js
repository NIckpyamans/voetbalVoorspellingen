import { describe, expect, it } from "vitest";
import {
  aggregateClubPerformance,
  buildMatchIndex,
  buildMatchStore,
  queryPairMatches,
  queryTeamMatches,
  recordFromReview,
} from "../../shared/matchStore.js";

const dayMatches = [
  {
    id: "m1",
    date: "2026-10-01",
    league: "Netherlands - Eredivisie",
    homeTeamName: "FC Utrecht",
    awayTeamName: "Willem II",
    homeScore: 3,
    awayScore: 1,
  },
  {
    id: "m2",
    date: "2026-10-08",
    league: "Netherlands - Eredivisie",
    homeTeamName: "Willem II",
    awayTeamName: "FC Utrecht",
    score: "0-2",
  },
  {
    id: "m3",
    date: "2026-09-20",
    league: "Netherlands - Eredivisie",
    homeTeamName: "FC Utrecht",
    awayTeamName: "Ajax",
    score: "1-1",
  },
  {
    id: "m4",
    date: "2026-09-27",
    league: "Netherlands - Eredivisie",
    homeTeamName: "PSV",
    awayTeamName: "Ajax",
    score: "2-0",
  },
  {
    id: "m5",
    date: "2026-10-15",
    league: "Netherlands - Eredivisie",
    homeTeamName: "Ajax",
    awayTeamName: "FC Utrecht",
    score: "1-3",
  },
  {
    id: "m6",
    date: "2026-10-15",
    league: "Netherlands - Eredivisie",
    homeTeamName: "Feyenoord",
    awayTeamName: "AZ",
    score: "1-0",
  },
];

const reviews = {
  m1: {
    matchId: "m1",
    date: "2026-10-01",
    league: "Netherlands - Eredivisie",
    homeTeamName: "FC Utrecht",
    awayTeamName: "Willem II",
    actualScore: "3-1",
    predictedOutcome: "H",
    actualOutcome: "H",
    confidence: 0.5091,
    outcomeHit: true,
    exactHit: true,
    totalGoalError: 0,
    featureImportance: [{ key: "data_completeness", score: 8.9 }],
    featureSourceMetadata: { veld: "groot" },
  },
  m2: {
    matchId: "m2",
    date: "2026-10-08",
    league: "Netherlands - Eredivisie",
    homeTeamName: "Willem II",
    awayTeamName: "FC Utrecht",
    actualScore: "0-2",
    predictedOutcome: "A",
    actualOutcome: "A",
    confidence: 0.4,
    outcomeHit: true,
    exactHit: false,
    totalGoalError: 2,
  },
  "ander-id-zelfde-wedstrijd": {
    matchId: "m2-dup",
    date: "2026-10-08",
    league: "Netherlands - Eredivisie",
    homeTeamName: "Willem II",
    awayTeamName: "FC Utrecht",
    actualScore: "0-2",
    predictedOutcome: "H",
    outcomeHit: false,
    exactHit: false,
    totalGoalError: 2,
  },
};

describe("matchStore", () => {
  it("bouwt compacte records en gooit zware reviewvelden weg", () => {
    const store = buildMatchStore({ dayMatches, reviews });
    const record = store.matches.m1;
    expect(record).toEqual({
      d: "2026-10-01",
      lg: "Netherlands - Eredivisie",
      h: "FC Utrecht",
      a: "Willem II",
      hs: 3,
      as: 1,
      po: "H",
      ao: "H",
      cf: 0.509,
      hit: true,
      ex: true,
      ge: 0,
    });
    expect(JSON.stringify(record)).not.toContain("featureSourceMetadata");
  });

  it("voegt dubbele ids voor dezelfde wedstrijd samen", () => {
    const store = buildMatchStore({ dayMatches, reviews });
    const signatures = Object.values(store.matches).map((record) =>
      [record.d, record.h, record.a, `${record.hs}-${record.as}`].join("|")
    );
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("negeert wedstrijden zonder uitslag of datum", () => {
    const store = buildMatchStore({
      dayMatches: [
        { id: "x1", date: "2026-10-01", homeTeamName: "A", awayTeamName: "B" },
        { id: "x2", homeTeamName: "A", awayTeamName: "B", score: "1-0" },
      ],
      reviews: {},
    });
    expect(Object.keys(store.matches)).toHaveLength(0);
  });

  it("indexeert per club op datum en per duel in beide richtingen", () => {
    const store = buildMatchStore({ dayMatches, reviews });
    const index = buildMatchIndex(store);
    expect(index.byTeam["fc utrecht"]).toEqual(["m3", "m1", "m2", "m5"]);
    expect(index.byPair["fc utrecht|ajax"]).toEqual(["m3"]);
    expect(index.byPair["ajax|fc utrecht"]).toEqual(["m5"]);
    expect(index.byDate["2026-10-15"].sort()).toEqual(["m5", "m6"]);
  });

  it("queryTeamMatches geeft nieuwste eerst, respecteert before en venue", () => {
    const store = buildMatchStore({ dayMatches, reviews });
    const index = buildMatchIndex(store);
    const recent = queryTeamMatches(store, index, "FC Utrecht", { limit: 2 });
    expect(recent.map((record) => record.d)).toEqual(["2026-10-15", "2026-10-08"]);

    const before = queryTeamMatches(store, index, "FC Utrecht", { before: "2026-10-08" });
    expect(before.map((record) => record.d)).toEqual(["2026-10-01", "2026-09-20"]);

    const thuis = queryTeamMatches(store, index, "FC Utrecht", { venue: "home" });
    expect(thuis.map((record) => record.d)).toEqual(["2026-10-01", "2026-09-20"]);
  });

  it("queryPairMatches vindt onderlinge duels in beide richtingen en vóór een datum", () => {
    const store = buildMatchStore({ dayMatches, reviews });
    const index = buildMatchIndex(store);
    const duels = queryPairMatches(store, index, "Ajax", "FC Utrecht");
    expect(duels.map((record) => record.d)).toEqual(["2026-10-15", "2026-09-20"]);

    const eerdere = queryPairMatches(store, index, "FC Utrecht", "Willem II", { before: "2026-10-08" });
    expect(eerdere.map((record) => record.d)).toEqual(["2026-10-01"]);
  });

  it("aggregateClubPerformance telt treffers per club en filtert kleine steekproeven", () => {
    const store = buildMatchStore({ dayMatches, reviews });
    const index = buildMatchIndex(store);
    const rows = aggregateClubPerformance(store, index, { minMatches: 2 });
    const utrecht = rows.find((row) => row.name === "FC Utrecht");
    expect(utrecht.n).toBe(4);
    expect(utrecht.home).toBe(2);
    expect(utrecht.away).toBe(2);
    expect(utrecht.league).toBe("Netherlands - Eredivisie");
    expect(utrecht.decided).toBe(2);
    expect(utrecht.hitPct).toBe(100);
    expect(utrecht.exactPct).toBe(50);
    expect(utrecht.goalErr).toBe(1);

    const az = rows.find((row) => row.name === "AZ");
    expect(az).toBeUndefined();
  });

  it("blijft identiek na serialiseren en herlezen", () => {
    const store = buildMatchStore({ dayMatches, reviews });
    const index = buildMatchIndex(store);
    const roundTrip = JSON.parse(JSON.stringify({ store, index }));
    expect(roundTrip.store).toEqual(store);
    expect(roundTrip.index).toEqual(index);
    expect(recordFromReview(reviews.m1).cf).toBe(0.509);
  });
});
