import { describe, expect, it } from "vitest";
import { oddspapiAllowance, oddspapiMonthId } from "../../scripts/worker/oddspapi-budget.js";
import { matchOddspapiFixture, normalizeOddspapiTeam, oddspapiOddsByMatch, oddspapiTeamKey } from "../../scripts/worker/oddspapi-fixture-map.js";

describe("oddspapi maandbudget", () => {
  it("houdt de reserve vrij en begrenst het aantal requests per run", () => {
    const env = { ODDSPAPI_MONTHLY_LIMIT: "250", ODDSPAPI_MONTHLY_RESERVE: "25", ODDSPAPI_MAX_REQUESTS_PER_RUN: "2" };
    const allowance = oddspapiAllowance({ month: "2026-11", requests: 0 }, env);
    expect(allowance).toMatchObject({ limit: 250, reserve: 25, used: 0, remaining: 225, perRunCap: 2 });

    const almostFull = oddspapiAllowance({ month: "2026-11", requests: 224 }, env);
    expect(almostFull.perRunCap).toBe(1);

    const exhausted = oddspapiAllowance({ month: "2026-11", requests: 225 }, env);
    expect(exhausted.perRunCap).toBe(0);
    expect(exhausted.remaining).toBe(0);
  });

  it("valt terug op de gratis limiet als de omgeving niets zet", () => {
    expect(oddspapiAllowance({ month: "2026-11", requests: 0 }, {}).limit).toBe(250);
    expect(oddspapiMonthId("2026-11-02T10:00:00Z")).toBe("2026-11");
    expect(oddspapiMonthId("nonsense")).toBe(new Date().toISOString().slice(0, 7));
  });
});

describe("oddspapi fixture-koppeling", () => {
  const fixtures = [
    {
      fixtureId: "id1000013172044614",
      home: "VVV-Venlo",
      away: "Helmond Sport",
      quotes: [
        { bookmaker: "bet99", home: 2.4, draw: 3.5, away: 2.8 },
        { bookmaker: "bpremium", home: 2.5, draw: 3.4, away: 2.7 },
      ],
    },
    { fixtureId: "id2", home: "Jong PSV", away: "FC Eindhoven", quotes: [{ bookmaker: "bet99", home: 1.9, draw: 3.6, away: 3.9 }] },
  ];

  it("normaliseert leestekens, diakritieken en clublabels", () => {
    expect(normalizeOddspapiTeam("VVV-Venlo")).toBe("vvv venlo");
    expect(normalizeOddspapiTeam("FC Eindhoven")).toBe("eindhoven");
    expect(normalizeOddspapiTeam("Jong PSV")).toBe("ii psv");
    // Woordorde mag niet uitmaken tussen bronnen.
    expect(oddspapiTeamKey("Jong Ajax")).toBe(oddspapiTeamKey("Ajax II"));
    expect(oddspapiTeamKey("VVV-Venlo")).toBe(oddspapiTeamKey("Venlo VVV"));
  });

  it("koppelt op thuis- en uitnaam en aggregeert de mediaan", () => {
    const byMatch = oddspapiOddsByMatch(fixtures, [
      { matchId: "match-1", homeTeam: "VVV Venlo", awayTeam: "Helmond Sport" },
      { matchId: "match-2", homeTeam: "PSV II", awayTeam: "Eindhoven" },
      { matchId: "match-3", homeTeam: "Cambuur", awayTeam: "Telstar" },
    ]);
    expect(byMatch.get("match-1")).toMatchObject({ fixtureId: "id1000013172044614", home: 2.45, draw: 3.45, away: 2.75, independentPrices: 2 });
    expect(byMatch.get("match-2")).toMatchObject({ fixtureId: "id2", home: 1.9 });
    expect(byMatch.has("match-3")).toBe(false);
  });

  it("weigert een fixture zonder namen", () => {
    expect(matchOddspapiFixture([{ fixtureId: "x", participant1Id: 1 }], { homeTeam: "Cambuur", awayTeam: "Telstar" })).toBeNull();
  });

  it("koppelt naamsuffixen maar niet een beloftenelftal aan het eerste elftal", () => {
    const list = [
      { fixtureId: "a", home: "Roda JC", away: "De Graafschap", quotes: [] },
      { fixtureId: "b", home: "Ajax", away: "FC Utrecht", quotes: [] },
    ];
    expect(matchOddspapiFixture(list, { homeTeam: "Roda JC Kerkrade", awayTeam: "Graafschap" })?.fixtureId).toBe("a");
    expect(matchOddspapiFixture(list, { homeTeam: "Jong Ajax", awayTeam: "Jong FC Utrecht" })).toBeNull();
  });
});