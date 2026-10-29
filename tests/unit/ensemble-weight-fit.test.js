import { describe, expect, it } from "vitest";
import {
  fitMarketWeightBlend,
  fitMarketWeightByCompetition,
  weightFitRows,
} from "../../shared/ensembleWeightFit.js";
import { adviseMarketWeight } from "../../shared/ensembleWeightPolicy.js";

// Bouwt records waarin de markt consequent beter is dan het model: de markt
// geeft de juiste uitkomst 0,70 en het model 0,45.
function buildRecords(count) {
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const day = String(1 + (index % 28)).padStart(2, "0");
    const month = String(1 + Math.floor(index / 28)).padStart(2, "0");
    const homeWins = index % 2 === 0;
    const outcome = homeWins ? "H" : "A";
    records.push({
      d: `2026-${month}-${day}`,
      y: outcome,
      po: outcome,
      hit: true,
      cf: 0.45,
      mp: homeWins ? [0.7, 0.15, 0.15] : [0.15, 0.15, 0.7],
    });
  }
  return records;
}

// Dekking voor de geronde output van de fitter.
function withLeague(records, league) {
  return records.map((record) => ({ ...record, lg: league }));
}

describe("weightFitRows", () => {
  it("houdt alleen records over met een marktkans en modelzekerheid", () => {
    const rows = weightFitRows([
      { d: "2026-01-01", po: "H", cf: 0.5, mp: [0.4, 0.3, 0.3] },
      { d: "2026-01-02", po: "H", cf: 0.5 },
      { d: "2026-01-03", po: "H", mp: [0.4, 0.3, 0.3] },
      { d: "2026-01-04", po: "X", cf: 0.5, mp: [0.4, 0.3, 0.3] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ modelProbability: 0.5, marketProbability: 0.4 });
  });

  it("sorteert chronologisch, zodat de holdout echt later is", () => {
    const rows = weightFitRows([
      { d: "2026-03-01", po: "H", cf: 0.5, mp: [0.4, 0.3, 0.3] },
      { d: "2026-01-01", po: "H", cf: 0.5, mp: [0.4, 0.3, 0.3] },
    ]);
    expect(rows.map((row) => row.date)).toEqual(["2026-01-01", "2026-03-01"]);
  });
});

describe("fitMarketWeightBlend", () => {
  it("geeft geen meting onder de minimumsteekproef", () => {
    const fit = fitMarketWeightBlend(buildRecords(20), { minSample: 150 });
    expect(fit.available).toBe(false);
    expect(fit.reason).toBe("te-weinig-paren");
  });

  it("vindt een hoger marktgewicht wanneer de markt beter is", () => {
    const fit = fitMarketWeightBlend(buildRecords(400), { minSample: 150 });
    expect(fit.available).toBe(true);
    expect(fit.holdoutSample).toBeGreaterThan(0);
    expect(fit.bestWeight).toBeGreaterThan(0.2);
    expect(fit.holdoutImproves).toBe(true);
    expect(fit.improvement).toBeGreaterThan(0);
  });

  it("verlaagt het gewicht wanneer de markt slechter is dan het model", () => {
    // De markt geeft de juiste uitkomst maar 0,10 waar het model 0,45 zegt:
    // meer marktgewicht maakt de voorspelling aantoonbaar slechter.
    const records = buildRecords(400).map((record) => ({
      ...record,
      mp: record.po === "H" ? [0.1, 0.45, 0.45] : [0.45, 0.45, 0.1],
    }));
    const fit = fitMarketWeightBlend(records, { minSample: 150, current: 0.16 });
    expect(fit.available).toBe(true);
    expect(fit.holdoutImproves).toBe(true);
    expect(fit.bestWeight).toBeLessThan(0.1);
    expect(fit.recommendedWeight).toBeLessThan(0.16);
  });

  it("blijft binnen het toegestane gewicht", () => {
    const fit = fitMarketWeightBlend(buildRecords(400), { minSample: 150, current: 0.16 });
    for (const point of fit.curve) {
      expect(point.weight).toBeGreaterThanOrEqual(0);
      expect(point.weight).toBeLessThanOrEqual(0.6);
    }
  });
});

describe("fitMarketWeightByCompetition", () => {
  it("geeft per competitie een meting en laat te klein geworden competities terugvallen op de prior", () => {
    const records = [
      ...withLeague(buildRecords(160), "England - Premier League"),
      ...withLeague(buildRecords(30), "Portugal - Liga Portugal"),
    ];
    const fit = fitMarketWeightByCompetition(records, { current: 0.16 });
    expect(fit.competitions).toHaveLength(2);
    const england = fit.competitions.find((entry) => entry.league === "England - Premier League");
    const portugal = fit.competitions.find((entry) => entry.league === "Portugal - Liga Portugal");
    expect(england.available).toBe(true);
    expect(england.trainSample + england.holdoutSample).toBe(160);
    expect(portugal).toMatchObject({ available: false, reason: "te-weinig-paren", weight: 0.16 });
  });

  it("splitst chronologisch: training eerst, holdout daarna", () => {
    // Later de datums sorteert: training eerst, holdout daarna.
    const records = withLeague(buildRecords(100).map((record) => (record.d === "2026-01-01" ? { ...record, mp: [0.9, 0.05, 0.05] } : record)), "Test - League");
    const fit = fitMarketWeightByCompetition(records, { current: 0.16, minSamplePerCompetition: 100 });
    const entry = fit.competitions.find((item) => item.league === "Test - League");
    expect(entry.trainSample).toBe(70);
    expect(entry.holdoutSample).toBe(30);
  });

  it("begrenst het advies met shrinkage naar de prior en een raster tot 0,35", () => {
    const fit = fitMarketWeightByCompetition(withLeague(buildRecords(300), "Test - League"), { current: 0.16, minSamplePerCompetition: 100 });
    for (const entry of fit.competitions) {
      if (!entry.available) continue;
      expect(Number(entry.shrunkWeight)).toBeLessThanOrEqual(0.35);
      // Shrinkage pullt het advies halfweg richting de prior van de globale fit.
      expect(Number(entry.shrunkWeight)).toBeLessThanOrEqual(Math.max(0.16, entry.rawBestWeight));
      expect(Number(entry.recommendedWeight)).toBeLessThanOrEqual(0.35);
    }
  });

  it("draait het advies terug naar de prior wanneer de holdout niets bevestigt", () => {
    // Wanneer de poort niet gehaald wordt, is het advies precies de prior:
    // geen gemeten voordeel betekent geen gemeten advies.
    // Trainingsfase zegt: markt beter (model 0,45 tegen markt 0,70); de
    // holdout zegt het omgekeerde (markt 0,10). De gefitte richting gilt in
    // de holdout aantoonbaar slechter, dus de poort deseint en de prior
    // blijft staan.
    const records = [];
    for (let index = 0; index < 300; index += 1) {
      const day = String(1 + (index % 28)).padStart(2, "0");
      const month = String(1 + Math.floor(index / 28)).padStart(2, "0");
      const homeWins = index % 2 === 0;
      const outcome = homeWins ? "H" : "A";
      const marketBetter = index < 210;
      records.push({
        d: `2026-${month}-${day}`,
        y: outcome,
        po: outcome,
        hit: true,
        cf: 0.45,
        lg: "Test - League",
        mp: marketBetter
          ? (homeWins ? [0.7, 0.15, 0.15] : [0.15, 0.15, 0.7])
          : (homeWins ? [0.1, 0.45, 0.45] : [0.45, 0.45, 0.1]),
      });
    }
    const fit = fitMarketWeightByCompetition(records, { current: 0.16, minSamplePerCompetition: 100 });
    const entry = fit.competitions.find((item) => item.league === "Test - League");
    expect(entry.available).toBe(true);
    expect(entry.holdoutImproves).toBe(false);
    expect(Number(entry.recommendedWeight)).toBe(0.16);
  });
});

describe("adviseMarketWeight met een holdout-fit", () => {
  const fit = {
    available: true,
    sample: 400,
    holdoutSample: 120,
    recommendedWeight: 0.32,
    holdoutImproves: true,
    holdoutLogLoss: 0.95,
    currentHoldoutLogLoss: 1.02,
  };

  it("volgt de gemeten fit in plaats van de benchmark", () => {
    const advice = adviseMarketWeight(
      { modelN: 200, model: { logLoss: 1.0 }, market: { logLoss: 1.0 } },
      { fit },
    );
    expect(advice.source).toBe("holdout-fit");
    expect(advice.advised).toBe(0.32);
    expect(advice.reason).toBe("gemeten-op-eigen-historie");
    expect(advice.direction).toBe("up");
  });

  it("houdt het huidige gewicht wanneer de holdout niets bevestigt", () => {
    const advice = adviseMarketWeight(
      { modelN: 200, model: { logLoss: 1.0 }, market: { logLoss: 1.0 } },
      { fit: { ...fit, recommendedWeight: 0.16, holdoutImproves: false } },
    );
    expect(advice.advised).toBe(0.16);
    expect(advice.direction).toBe("hold");
    expect(advice.reason).toBe("holdout-bevestigt-geen-verbetering");
  });

  it("valt terug op de benchmark zonder fit", () => {
    const advice = adviseMarketWeight({ modelN: 400, model: { logLoss: 1.1 }, market: { logLoss: 1.0 } });
    expect(advice.source).toBe("benchmark");
    expect(advice.advised).toBeCloseTo(0.24, 3);
  });
});
