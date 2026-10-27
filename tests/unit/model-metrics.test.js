import { describe, expect, it } from "vitest";
import {
  calibrationReport,
  dataQualityReport,
  marketBaselineReport,
  sourceHealthReport,
  temporalReport,
} from "../../shared/modelMetrics.js";

describe("calibrationReport", () => {
  it("vergelijkt confidence met werkelijke hitrate per bucket en berekent ECE", () => {
    const report = calibrationReport([
      { lg: "Eredivisie", cf: 0.8, hit: true },
      { lg: "Eredivisie", cf: 0.8, hit: true },
      { lg: "Eredivisie", cf: 0.3, hit: false },
    ]);
    expect(report.n).toBe(3);
    expect(report.hitPct).toBeCloseTo(66.7, 1);
    expect(report.avgConfidence).toBeCloseTo(0.633, 3);
    expect(report.buckets).toHaveLength(5);
    expect(report.buckets[4].n).toBe(2);
    expect(report.buckets[4].hitPct).toBe(100);
    expect(report.buckets[1].n).toBe(1);
    expect(report.buckets[1].hitPct).toBe(0);
    // ECE = 2/3 * |0.8 - 1.0| + 1/3 * |0.3 - 0.0|
    expect(report.ece).toBeCloseTo(0.233, 2);
  });

  it("laat records zonder confidence of beoordeling weg en filtert kleine steekproeven", () => {
    const report = calibrationReport(
      [
        { lg: "Eredivisie", cf: 0.6, hit: true },
        { lg: "Eredivisie", cf: 0.6, hit: true },
        { lg: "Jupiler League", cf: 0.9, hit: true },
        { lg: "Eredivisie" },
        { lg: "Eredivisie", cf: 0.5 },
      ],
      { minLeagueSample: 2 },
    );
    expect(report.n).toBe(3);
    expect(report.leagues).toHaveLength(1);
    expect(report.leagues[0]).toMatchObject({ league: "Eredivisie", n: 2, hitPct: 100 });
  });
});

describe("temporalReport", () => {
  it("groepeert per maand en rapporteert drift tussen eerste en laatste venster", () => {
    const report = temporalReport([
      { d: "2026-08-05", hit: true, ex: true, ge: 0 },
      { d: "2026-08-12", hit: false, ex: false, ge: 2 },
      { d: "2026-09-03", hit: true, ex: false, ge: 1 },
    ]);
    expect(report.periods.map((entry) => entry.period)).toEqual(["2026-08", "2026-09"]);
    expect(report.periods[0]).toMatchObject({ n: 2, decided: 2, hitPct: 50, exactPct: 50 });
    expect(report.periods[1]).toMatchObject({ n: 1, decided: 1, hitPct: 100 });
    expect(report.drift).toMatchObject({ from: "2026-08", to: "2026-09", hitPctDelta: 50 });
    expect(report.periods[0].avgGoalError).toBe(1);
  });

  it("groepeert bij weekvensters op de maandag van die week", () => {
    // 2026-10-08 is een donderdag; het weekvenster begint op maandag 2026-10-05.
    const report = temporalReport([{ d: "2026-10-08", hit: true }], { window: "week" });
    expect(report.window).toBe("week");
    expect(report.periods[0].period).toBe("2026-10-05");
    expect(report.drift).toBeNull();
  });
});

describe("marketBaselineReport", () => {
  it("vergelijkt modelhit met marktfavoriet-hit per competitie", () => {
    const report = marketBaselineReport(
      [
        { lg: "Eredivisie", hit: true, mk: "H", mh: false },
        { lg: "Eredivisie", hit: true, mk: "A", mh: false },
        { lg: "Eredivisie", hit: false, mk: "A", mh: true },
        { lg: "Bundesliga", hit: true, mk: "H", mh: true },
        { lg: "Eredivisie", hit: true },
      ],
      { minLeagueSample: 2 },
    );
    // Het record zonder marktgegevens telt niet mee.
    expect(report.n).toBe(4);
    expect(report.modelHitPct).toBe(75);
    expect(report.marketHitPct).toBe(50);
    expect(report.edgePct).toBeCloseTo(25, 1);
    expect(report.leagues).toHaveLength(1);
    expect(report.leagues[0]).toMatchObject({
      league: "Eredivisie",
      n: 3,
      modelHitPct: 66.7,
      marketHitPct: 33.3,
    });
    expect(report.leagues[0].edgePct).toBeCloseTo(33.3, 1);
  });
});

describe("dataQualityReport", () => {
  it("vat odds-status en timestamp-dekking per competitie samen", () => {
    const report = dataQualityReport([
      { lg: "Eredivisie", dq: { ts: 0.8, od: "available" } },
      { lg: "Eredivisie", dq: { ts: 0.6, od: "missing" } },
      { lg: "Jupiler League" },
    ]);
    expect(report.withDq).toBe(2);
    expect(report.avgTimestampCoverage).toBeCloseTo(0.7, 3);
    expect(report.oddsAvailablePct).toBe(50);
    // Het record zonder dq telt nergens in mee.
    expect(report.leagues).toHaveLength(1);
    expect(report.leagues[0].league).toBe("Eredivisie");
  });
});

describe("sourceHealthReport", () => {
  it("markeert lege en dunne bronnen en houdt de acties uit het plan vast", () => {
    const report = sourceHealthReport({
      sourceCoverage: { lineups: 0, oddsHalf: 0.1, matchStates: 1 },
      coverageImprovementPlan: [
        { source: "lineups", action: "Vul REEP_TEAM_MAP aan" },
      ],
    });
    expect(report.empty).toEqual(["lineups"]);
    expect(report.thin).toEqual(["oddsHalf"]);
    const lineups = report.sources.find((row) => row.source === "lineups");
    expect(lineups).toMatchObject({ status: "empty", action: "Vul REEP_TEAM_MAP aan" });
    const matchStates = report.sources.find((row) => row.source === "matchStates");
    expect(matchStates.status).toBe("ok");
  });
});
