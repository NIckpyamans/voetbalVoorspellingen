import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateClubPerformance,
  buildMatchIndex,
  buildMatchStore,
  buildPredictionContext,
  headToHeadSummary,
  loadMatchStore,
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
    status: "FT",
  },
  {
    id: "m2",
    date: "2026-10-08",
    league: "Netherlands - Eredivisie",
    homeTeamName: "Willem II",
    awayTeamName: "FC Utrecht",
    score: "0-2",
    status: "FT",
  },
  {
    id: "m3",
    date: "2026-09-20",
    league: "Netherlands - Eredivisie",
    homeTeamName: "FC Utrecht",
    awayTeamName: "Ajax",
    score: "1-1",
    status: "FT",
  },
  {
    id: "m4",
    date: "2026-09-27",
    league: "Netherlands - Eredivisie",
    homeTeamName: "PSV",
    awayTeamName: "Ajax",
    score: "2-0",
    status: "FT",
  },
  {
    id: "m5",
    date: "2026-10-15",
    league: "Netherlands - Eredivisie",
    homeTeamName: "Ajax",
    awayTeamName: "FC Utrecht",
    score: "1-3",
    status: "FT",
  },
  {
    id: "m6",
    date: "2026-10-15",
    league: "Netherlands - Eredivisie",
    homeTeamName: "Feyenoord",
    awayTeamName: "AZ",
    score: "1-0",
    status: "FT",
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
        { id: "x1", date: "2026-10-01", homeTeamName: "A", awayTeamName: "B", status: "FT" },
        { id: "x2", homeTeamName: "A", awayTeamName: "B", score: "1-0", status: "FT" },
      ],
      reviews: {},
    });
    expect(Object.keys(store.matches)).toHaveLength(0);
  });

  it("slaat onafgewerkte fixtures over, ook met een voorlopige stand", () => {
    const store = buildMatchStore({
      dayMatches: [
        { id: "l1", date: "2026-10-01", homeTeamName: "A", awayTeamName: "B", homeScore: 2, awayScore: 1, status: "LIVE" },
        { id: "h1", date: "2026-10-01", homeTeamName: "C", awayTeamName: "D", score: "1-0", status: "HT" },
        { id: "n1", date: "2026-10-01", homeTeamName: "E", awayTeamName: "F", score: "3-3", status: "NS" },
        { id: "r1", date: "2026-10-01", homeTeamName: "G", awayTeamName: "H", score: "1-0", status: "RESULT_PENDING" },
        { id: "f1", date: "2026-10-01", homeTeamName: "I", awayTeamName: "J", score: "1-0", status: "FT" },
        { id: "a1", date: "2026-10-01", homeTeamName: "K", awayTeamName: "L", score: "2-1", status: "AET" },
        { id: "p1", date: "2026-10-01", homeTeamName: "M", awayTeamName: "N", score: "1-1", status: "PEN" },
      ],
      reviews: {},
    });
    expect(Object.keys(store.matches).sort()).toEqual(["a1", "f1", "p1"]);
  });

  it("laat de review-uitslag een voorlopige dagstand overschrijven", () => {
    const store = buildMatchStore({
      dayMatches: [
        { id: "x1", date: "2026-10-01", league: "L", homeTeamName: "A", awayTeamName: "B", homeScore: 1, awayScore: 0, status: "FT" },
      ],
      reviews: {
        x1: {
          matchId: "x1",
          date: "2026-10-01",
          league: "L",
          homeTeamName: "A",
          awayTeamName: "B",
          actualScore: "3-0",
          predictedOutcome: "H",
          actualOutcome: "H",
          outcomeHit: true,
          exactHit: false,
          totalGoalError: 2,
        },
      },
    });
    expect(store.matches.x1.hs).toBe(3);
    expect(store.matches.x1.as).toBe(0);
    expect(store.matches.x1.ao).toBe("H");
  });

  it("legt datakwaliteit per voorspelling compact vast", () => {
    const record = recordFromReview({
      matchId: "q1",
      date: "2026-10-02",
      league: "Netherlands - Eredivisie",
      homeTeamName: "A",
      awayTeamName: "B",
      actualScore: "1-0",
      predictedOutcome: "H",
      actualOutcome: "H",
      outcomeHit: true,
      exactHit: false,
      totalGoalError: 1,
      oddsStatus: "available",
      featureSourceMetadata: { coverage: { timestampCoverage: 0.714 } },
    });
    expect(record.dq).toEqual({ ts: 0.714, od: "available" });
  });

  it("indexeert per club op datum en per duel in beide richtingen", () => {
    const store = buildMatchStore({ dayMatches, reviews });
    const index = buildMatchIndex(store);
    expect(index.byTeam["utrecht"]).toEqual(["m3", "m1", "m2", "m5"]);
    expect(index.byPair["utrecht|ajax"]).toEqual(["m3"]);
    expect(index.byPair["ajax|utrecht"]).toEqual(["m5"]);
    expect(index.byDate["2026-10-15"].sort()).toEqual(["m5", "m6"]);
  });

  it("voegt naamvarianten van dezelfde club samen via de app-brede canonicalisatie", () => {
    const store = buildMatchStore({ dayMatches, reviews });
    const index = buildMatchIndex(store);
    // "FC Utrecht" en "Utrecht" verwijzen naar dezelfde clubsleutel.
    expect(queryTeamMatches(store, index, "Utrecht").map((record) => record.d)).toEqual(
      queryTeamMatches(store, index, "FC Utrecht").map((record) => record.d),
    );
    expect(index.byTeam["utrecht"]).toHaveLength(4);
  });

  it("loadMatchStore herbouwt wanneer de brondata nieuwer is dan de store", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "match-store-"));
    try {
      fs.mkdirSync(path.join(dataDir, "days"), { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, "days", "2026-10-01.json"),
        JSON.stringify({
          matches: [
            {
              id: "t1",
              date: "2026-10-01",
              league: "L",
              homeTeamName: "A",
              awayTeamName: "B",
              score: "1-0",
              status: "FT",
            },
          ],
        }),
      );
      const staleStore = {
        schema: "match-store-v1",
        matches: {},
        marker: "from-disk",
      };
      const staleIndex = { byTeam: {}, byPair: {}, byDate: {} };
      fs.writeFileSync(path.join(dataDir, "match-store.json"), JSON.stringify(staleStore));
      fs.writeFileSync(path.join(dataDir, "match-index.json"), JSON.stringify(staleIndex));
      const past = new Date("2020-01-01T00:00:00Z");
      fs.utimesSync(path.join(dataDir, "match-store.json"), past, past);
      fs.utimesSync(path.join(dataDir, "match-index.json"), past, past);

      // Bronbestand is nieuwer: de gedateerde store wordt genegeerd en herbouwd.
      const rebuilt = loadMatchStore(dataDir);
      expect(rebuilt.store.marker).toBeUndefined();
      expect(rebuilt.store.matches.t1).toMatchObject({ d: "2026-10-01", hs: 1, as: 0 });
      expect(rebuilt.index.byTeam.a).toEqual(["t1"]);
      expect(rebuilt.index.byPair["a|b"]).toEqual(["t1"]);
      expect(rebuilt.index.byDate["2026-10-01"]).toEqual(["t1"]);

      // Wanneer de gegenereerde bestanden juist nieuwer zijn, tellen ze.
      const fresh = new Date("2100-01-01T00:00:00Z");
      fs.utimesSync(path.join(dataDir, "match-store.json"), fresh, fresh);
      fs.utimesSync(path.join(dataDir, "match-index.json"), fresh, fresh);
      const loaded = loadMatchStore(dataDir);
      expect(loaded.store.marker).toBe("from-disk");
      expect(loaded.index.byTeam).toEqual({});
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
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

  it("headToHeadSummary telt vanuit het perspectief van het opgegeven thuis-team", () => {
    const store = buildMatchStore({ dayMatches, reviews });
    const index = buildMatchIndex(store);
    const h2h = headToHeadSummary(store, index, "FC Utrecht", "Ajax");
    expect(h2h.played).toBe(2);
    expect(h2h.homeWins).toBe(1);
    expect(h2h.draws).toBe(1);
    expect(h2h.awayWins).toBe(0);
    expect(h2h.homeGoals).toBe(4);
    expect(h2h.awayGoals).toBe(2);

    const voor = headToHeadSummary(store, index, "FC Utrecht", "Ajax", { before: "2026-10-15" });
    expect(voor.played).toBe(1);
    expect(voor.draws).toBe(1);
  });

  it("buildPredictionContext levert vorm, H2H en rustdagen met before-antilek", () => {
    const store = buildMatchStore({ dayMatches, reviews });
    const index = buildMatchIndex(store);
    const context = buildPredictionContext(store, index, "FC Utrecht", "Ajax", { before: "2026-10-15" });

    expect(context.home.recent.map((record) => record.d)).toEqual(["2026-10-08", "2026-10-01", "2026-09-20"]);
    expect(context.home.lastMatchDate).toBe("2026-10-08");
    expect(context.home.restDays).toBe(7);

    expect(context.away.recent.map((record) => record.d)).toEqual(["2026-09-27", "2026-09-20"]);
    expect(context.away.restDays).toBe(18);

    expect(context.headToHead.played).toBe(1);
    expect(context.headToHead.draws).toBe(1);
  });

  it("aggregateClubPerformance telt treffers per club en filtert op beoordeelde voorspellingen", () => {
    const store = buildMatchStore({ dayMatches, reviews });
    const index = buildMatchIndex(store);
    const rows = aggregateClubPerformance(store, index, { minMatches: 2 });
    const utrecht = rows.find((row) => row.name === "FC Utrecht");
    expect(utrecht.n).toBe(2);
    expect(utrecht.matches).toBe(4);
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

  it("past de steekproefdrempel toe op beoordeelde voorspellingen, niet op gespeelde wedstrijden", () => {
    const dayMatchesMany = Array.from({ length: 8 }, (_, position) => ({
      id: `s${position}`,
      date: `2026-09-${String(position + 1).padStart(2, "0")}`,
      league: "L",
      homeTeamName: "Sample FC",
      awayTeamName: `Tegenstander ${position}`,
      score: "1-0",
      status: "FT",
    }));
    const oneReview = {
      s0: {
        matchId: "s0",
        date: "2026-09-01",
        league: "L",
        homeTeamName: "Sample FC",
        awayTeamName: "Tegenstander 0",
        actualScore: "1-0",
        predictedOutcome: "H",
        actualOutcome: "H",
        outcomeHit: true,
        exactHit: true,
        totalGoalError: 0,
      },
    };
    const store = buildMatchStore({ dayMatches: dayMatchesMany, reviews: oneReview });
    const index = buildMatchIndex(store);

    const teKlein = aggregateClubPerformance(store, index, { minMatches: 8 });
    expect(teKlein.find((row) => row.name === "Sample FC")).toBeUndefined();

    const genoeg = aggregateClubPerformance(store, index, { minMatches: 1 });
    const row = genoeg.find((item) => item.name === "Sample FC");
    expect(row.n).toBe(1);
    expect(row.matches).toBe(8);
    expect(row.hitPct).toBe(100);
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
