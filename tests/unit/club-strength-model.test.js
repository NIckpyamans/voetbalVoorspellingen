import { describe, expect, it } from "vitest";
import { canonicalDedupeTeam } from "../../shared/matchNormalization.js";
import {
  buildStrengthModel,
  dixonColesTau,
  expectedGoals,
  poissonPmf,
  predictFromStrength,
  scoreMatrix,
  strengthRows,
} from "../../shared/clubStrength.js";

function key(value) {
  return canonicalDedupeTeam(value) || String(value || "").trim().toLowerCase();
}

describe("poisson-motor", () => {
  it("volgt de Poisson-verdeling", () => {
    expect(poissonPmf(0, 1.4)).toBeCloseTo(Math.exp(-1.4), 10);
    expect(poissonPmf(2, 1.4)).toBeCloseTo(Math.exp(-1.4) * (1.4 ** 2) / 2, 10);
    expect(poissonPmf(0, 0)).toBe(0);
  });

  it("geeft een kansverdeling die tot 1 optelt", () => {
    const matrix = scoreMatrix(1.6, 1.1);
    const { homeProb, drawProb, awayProb } = matrix.probabilities;
    expect(homeProb + drawProb + awayProb).toBeCloseTo(1, 3);
    expect(homeProb).toBeGreaterThan(awayProb);
    expect(matrix.btts).toBeGreaterThan(0);
    expect(matrix.btts).toBeLessThan(1);
    expect(matrix.over25).toBeGreaterThan(0);
    expect(matrix.mostLikelyScore).toMatch(/^\d+-\d+$/);
  });

  it("corrigeert de lage uitslagen met de Dixon-Coles-factor", () => {
    expect(dixonColesTau(1, 1, 1.5, 1.2, -0.06)).toBeGreaterThan(1);
    expect(dixonColesTau(2, 2, 1.5, 1.2, -0.06)).toBe(1);
  });
});

describe("buildStrengthModel", () => {
  // Kleine competitie met een ondubbelzinnige rangorde. Bewust geen perfecte
  // scheiding (elke club speelt tegen elke club), anders zijn aanval en
  // verdediging niet van elkaar te onderscheiden.
  const fixtures = [
    ["Sterk", "Midden", 3, 0],
    ["Sterk", "Zwak", 4, 0],
    ["Sterk", "Zwakker", 5, 0],
    ["Midden", "Sterk", 0, 2],
    ["Midden", "Zwak", 2, 0],
    ["Midden", "Zwakker", 3, 0],
    ["Zwak", "Sterk", 0, 2],
    ["Zwak", "Midden", 0, 1],
    ["Zwak", "Zwakker", 1, 0],
    ["Zwakker", "Sterk", 0, 4],
    ["Zwakker", "Midden", 0, 2],
    ["Zwakker", "Zwak", 0, 1],
  ];

  function leagueHistory(rounds = 4) {
    const records = [];
    for (let round = 0; round < rounds; round += 1) {
      const month = String(round + 1).padStart(2, "0");
      fixtures.forEach(([home, away, hs, as], index) => {
        const day = String(1 + (index % 27)).padStart(2, "0");
        records.push({ d: `2026-${month}-${day}`, h: home, a: away, hs, as, lg: "L" });
      });
    }
    return records;
  }

  it("rangschikt aanval en verdediging volgens de uitslagen", () => {
    const model = buildStrengthModel(leagueHistory());
    const attackOf = (name) => model.teams[key(name)].attack;
    const defenceOf = (name) => model.teams[key(name)].defence;
    expect(attackOf("Sterk")).toBeGreaterThan(attackOf("Midden"));
    expect(attackOf("Midden")).toBeGreaterThan(attackOf("Zwak"));
    expect(attackOf("Zwak")).toBeGreaterThan(attackOf("Zwakker"));
    // Hogere factor = meet tegengoals dan verwacht, dus slechtere verdediging.
    expect(defenceOf("Sterk")).toBeLessThan(defenceOf("Midden"));
    expect(defenceOf("Midden")).toBeLessThan(defenceOf("Zwakker"));
  });

  it("negeert wedstrijden vanaf de asOf-datum", () => {
    const model = buildStrengthModel(
      [
        { d: "2026-01-01", h: "A", a: "B", hs: 2, as: 1 },
        { d: "2026-02-01", h: "A", a: "B", hs: 9, as: 0 },
      ],
      { asOf: "2026-02-01" },
    );
    expect(model.matches).toBe(1);
    expect(model.asOf).toBe("2026-02-01");
  });

  it("geeft een leeg model terug zonder wedstrijden", () => {
    const model = buildStrengthModel([]);
    expect(model.matches).toBe(0);
    expect(model.teams).toEqual({});
  });

  it("rapporteert alleen clubs met genoeg duels in strengthRows", () => {
    const rows = strengthRows(buildStrengthModel(leagueHistory()), { minMatches: 5 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.matches >= 5)).toBe(true);
    expect(rows[0].attack).toBeGreaterThanOrEqual(rows[rows.length - 1].attack);
  });
});

describe("expectedGoals en predictFromStrength", () => {
  const model = {
    baseGoals: 1.4,
    homeAdvantage: 1.2,
    teams: {
      [key("Alpha")]: { attack: 1.5, defence: 1 },
      [key("Beta")]: { attack: 1, defence: 1.2 },
    },
  };

  it("past thuisvoordeel en de sterktes toe", () => {
    const goals = expectedGoals(model, "Alpha", "Beta");
    expect(goals.homeXG).toBeCloseTo(1.4 * 1.5 * 1.2 * 1.2, 2);
    expect(goals.awayXG).toBeCloseTo(1.4 * 1 * 1, 2);
    expect(goals.known).toEqual({ home: true, away: true });
  });

  it("zet onbekende clubs op het competitiegemiddelde", () => {
    const goals = expectedGoals(model, "Alpha", "Onbekend");
    expect(goals.known).toEqual({ home: true, away: false });
    expect(goals.awayXG).toBeCloseTo(1.4, 2);
  });

  it("levert kansen, xG en dekking voor een duel", () => {
    const prediction = predictFromStrength(model, "Alpha", "Beta");
    const { homeProb, drawProb, awayProb } = prediction.probabilities;
    expect(homeProb + drawProb + awayProb).toBeCloseTo(1, 3);
    expect(prediction.homeXG).toBeGreaterThan(0);
    expect(prediction.coverage).toEqual({ home: true, away: true });
  });
});
