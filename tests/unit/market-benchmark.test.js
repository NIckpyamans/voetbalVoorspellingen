import { describe, expect, it } from "vitest";
import {
  benchmarkModelVsMarket,
  brier3,
  devigMultiplicative,
  devigPower,
  devigShin,
  devigThreeWay,
  impliedProbabilities,
  logLoss3,
  rps3,
} from "../../shared/marketBenchmark.js";
import {
  classifyOddsAge,
  compactOddsFreshness,
  oddsAgeHours,
  oddsFreshnessGate,
  oddsWeightMultiplier,
} from "../../shared/oddsFreshness.js";

describe("de-vig", () => {
  it("proportioneel normaliseert de som naar 1", () => {
    const probabilities = devigMultiplicative([0.5, 0.3, 0.3]);
    expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
    expect(probabilities[0]).toBeCloseTo(0.4545, 3);
  });

  it("power en shin tellen op tot 1 en houden de rangorde van de odds", () => {
    const implied = [1 / 1.5, 1 / 4.5, 1 / 6];
    for (const probabilities of [devigPower(implied), devigShin(implied)]) {
      expect(probabilities).not.toBeNull();
      expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
      expect(probabilities[0]).toBeGreaterThan(probabilities[1]);
      expect(probabilities[1]).toBeGreaterThan(probabilities[2]);
    }
    // Power haalt de marge vooral bij de outsiders weg: de favoriet gaat dus
    // zwaarder wegen dan bij de proportionele methode.
    expect(devigPower(implied)[0]).toBeGreaterThan(devigMultiplicative(implied)[0]);
  });

  it("geeft null bij onbruikbare odds", () => {
    expect(impliedProbabilities([1, 0, 0])).toBeNull();
    expect(impliedProbabilities([2, 3])).toBeNull();
    expect(devigThreeWay([0, 0, 0])).toBeNull();
  });

  it("devigThreeWay levert drie afgeronde kansen", () => {
    const probabilities = devigThreeWay([2, 4, 4], "power");
    expect(probabilities).toHaveLength(3);
    expect(probabilities.every((value) => value > 0 && value < 1)).toBe(true);
    expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 1);
  });
});

describe("kansniveau-scores", () => {
  it("een perfecte voorspelling scoort nul op RPS en Brier", () => {
    expect(rps3([1, 0, 0], "H")).toBe(0);
    expect(rps3([0, 1, 0], "D")).toBe(0);
    expect(rps3([0, 0, 1], "A")).toBe(0);
    expect(brier3([1, 0, 0], "H")).toBe(0);
  });

  it("RPS straft een fout verder in de ordening zwaarder", () => {
    const dichtbij = rps3([0.2, 0.6, 0.2], "H");
    const veraf = rps3([0.2, 0.2, 0.6], "H");
    expect(veraf).toBeGreaterThan(dichtbij);
  });

  it("logloss volgt de kans op de werkelijk opgetreden uitkomst", () => {
    expect(logLoss3([0.8, 0.15, 0.05], "H")).toBeCloseTo(-Math.log(0.8), 6);
    expect(logLoss3([0.8, 0.15, 0.05], "X")).toBeNull();
  });
});

describe("benchmarkModelVsMarket", () => {
  const rows = [
    { lg: "L", mp: [0.5, 0.3, 0.2], y: "H", ll: 0.6, bs: 0.4 },
    { lg: "L", mp: [0.2, 0.3, 0.5], y: "A", ll: 0.7, bs: 0.5 },
    { lg: "L", mp: [0.4, 0.3, 0.3], y: "D", ll: 1.2, bs: 0.9 },
    // Wel marktkansen, geen modelmaten: telt mee voor de markt, niet voor het model.
    { lg: "M", mp: [0.6, 0.2, 0.2], y: "H" },
    // Zonder uitkomst of met onvolledige kansen: telt nergens in mee.
    { lg: "L", mp: [0.5, 0.3, 0.2] },
    { lg: "L", mp: [0.5, 0.3], y: "H" },
  ];

  it("telt alleen volledige paren en rapporteert model en markt apart", () => {
    const report = benchmarkModelVsMarket(rows, { minLeagueSample: 2 });
    expect(report.n).toBe(4);
    expect(report.modelN).toBe(3);
    expect(report.market.logLoss).toBeGreaterThan(0);
    expect(report.market.rps).toBeGreaterThan(0);
    expect(report.delta.logLoss).not.toBeNull();
    expect(["model-beter-dan-markt", "markt-beter-dan-model"]).toContain(report.veredict);
  });

  it("filtert competities onder de minimumsteekproef", () => {
    const report = benchmarkModelVsMarket(rows, { minLeagueSample: 2 });
    expect(report.leagues.map((entry) => entry.league)).toEqual(["L"]);
    expect(report.leagues[0].n).toBe(3);
  });

  it("geeft een leeg maar geldig rapport zonder bruikbare rijen", () => {
    const report = benchmarkModelVsMarket([], {});
    expect(report.n).toBe(0);
    expect(report.market.logLoss).toBeNull();
    expect(report.veredict).toBe("onvoldoende-gekoppelde-records");
  });
});

describe("odds-versheid", () => {
  it("rekent de leeftijd in uren voor aftrap", () => {
    expect(oddsAgeHours("2026-10-02T09:00:00Z", "2026-10-02T18:00:00Z")).toBe(9);
    // Odds van na de aftrap zijn lek en leveren geen leeftijd op.
    expect(oddsAgeHours("2026-10-02T19:00:00Z", "2026-10-02T18:00:00Z")).toBeNull();
    expect(oddsAgeHours(null, "2026-10-02T18:00:00Z")).toBeNull();
  });

  it("verdeelt leeftijden in uitlegbare klassen", () => {
    expect(classifyOddsAge(5)).toBe("fresh");
    expect(classifyOddsAge(9)).toBe("recent");
    expect(classifyOddsAge(48)).toBe("stale");
    expect(classifyOddsAge(200)).toBe("old");
    expect(classifyOddsAge(null)).toBe("unknown");
  });

  it("geeft verse odds meer gewicht dan oude", () => {
    expect(oddsWeightMultiplier(5)).toBe(1);
    expect(oddsWeightMultiplier(9)).toBeLessThan(1);
    expect(oddsWeightMultiplier(200)).toBeLessThan(oddsWeightMultiplier(48));
  });

  it("keurt odds ouder dan 72 uur af als marktsignaal", () => {
    const oud = oddsFreshnessGate(200);
    expect(oud.usable).toBe(false);
    expect(oud.reason).toContain("72 uur");
    expect(oddsFreshnessGate(9).usable).toBe(true);
  });

  it("levert een compacte vorm voor de wedstrijdopslag", () => {
    expect(compactOddsFreshness("2026-10-02T09:00:00Z", "2026-10-02T18:00:00Z")).toEqual({ h: 9, f: "recent" });
    expect(compactOddsFreshness(null, "2026-10-02T18:00:00Z")).toBeNull();
  });
});
