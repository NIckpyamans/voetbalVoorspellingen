import { describe, expect, it } from "vitest";
import {
  applyIsotonic,
  applyPlatt,
  applyTemperature,
  fitIsotonic,
  fitPlatt,
  logit,
  selectCalibration,
} from "../../shared/calibrationFit.js";

describe("kalibratiemethoden", () => {
  it("platt met a=1 en b=0 en temperatuur 1 laten de kans staan", () => {
    expect(applyPlatt(0.42, { a: 1, b: 0 })).toBeCloseTo(0.42, 6);
    expect(applyTemperature(0.42, { temperature: 1 })).toBeCloseTo(0.42, 6);
  });

  it("temperatuur boven 1 trekt de kans naar het midden", () => {
    expect(applyTemperature(0.9, { temperature: 3 })).toBeLessThan(0.9);
    expect(applyTemperature(0.1, { temperature: 3 })).toBeGreaterThan(0.1);
  });

  it("logit en sigmoid heffen elkaar op via applyPlatt", () => {
    expect(applyPlatt(0.75, { a: 1, b: 0 })).toBeCloseTo(0.75, 6);
    expect(logit(0.5)).toBeCloseTo(0, 10);
  });

  it("isotonic is monotoon niet-dalend", () => {
    const model = fitIsotonic([
      { p: 0.9, y: 0 },
      { p: 0.8, y: 0 },
      { p: 0.7, y: 1 },
      { p: 0.6, y: 1 },
    ]);
    const values = model.bins.map((bin) => bin.y);
    expect(values.length).toBeGreaterThan(0);
    for (let position = 1; position < values.length; position += 1) {
      expect(values[position]).toBeGreaterThanOrEqual(values[position - 1]);
    }
  });

  it("isotonic interpoleert lineair tussen blokken", () => {
    expect(applyIsotonic(0.75, { bins: [{ p: 0.5, y: 0.2 }, { p: 1, y: 0.8 }] })).toBeCloseTo(0.5, 6);
    expect(applyIsotonic(0.1, { bins: [{ p: 0.5, y: 0.2 }, { p: 1, y: 0.8 }] })).toBeCloseTo(0.2, 6);
  });

  it("isotonic zonder minimum laat kleine blokken staan", () => {
    const model = fitIsotonic([
      { p: 0.1, y: 0 },
      { p: 0.2, y: 1 },
      { p: 0.3, y: 1 },
      { p: 0.4, y: 0 },
      { p: 0.5, y: 1 },
    ]);
    // Zonder drempel: klassieke PAV. De violatie op p=0,4 poolt de middelste
    // blokken; de randblokken (n=1) blijven als losse blokken staan.
    // (Of gelijkwaardige gemiddeldes samen worden gepoolt laat de klassieke
    // definitie vrij, daarom toetsen we het structurele resultaat.)
    expect(model.bins).toHaveLength(3);
    expect(model.bins[0].n).toBe(1);
    expect(model.bins[model.bins.length - 1].n).toBe(1);
    for (let position = 1; position < model.bins.length; position += 1) {
      expect(model.bins[position].y).toBeGreaterThanOrEqual(model.bins[position - 1].y);
    }
  });

  it("isotonic poolt blokken onder de minimum steekproef en blijft monotoon", () => {
    const pairs = [
      { p: 0.1, y: 0 },
      { p: 0.2, y: 1 },
      { p: 0.3, y: 1 },
      { p: 0.4, y: 0 },
      { p: 0.5, y: 1 },
    ];
    const pooled = fitIsotonic(pairs, { minBinSample: 3 });
    expect(pooled.minBinSample).toBe(3);
    expect(pooled.bins.length).toBeGreaterThan(0);
    for (const bin of pooled.bins) {
      expect(bin.n).toBeGreaterThanOrEqual(3);
    }
    for (let position = 1; position < pooled.bins.length; position += 1) {
      expect(pooled.bins[position].y).toBeGreaterThanOrEqual(pooled.bins[position - 1].y);
    }
    // Geen blok onder de drempel betekent hier: alles samengevoegd tot n=5.
    expect(pooled.bins.reduce((total, bin) => total + bin.n, 0)).toBe(5);
  });

  it("isotonic met steekproef drempel interpoleert nog steeds tussen de gepoolde blokken", () => {
    const pairs = [
      { p: 0.1, y: 0 }, { p: 0.15, y: 0 }, { p: 0.2, y: 0 },
      { p: 0.6, y: 1 }, { p: 0.65, y: 1 },
      { p: 0.7, y: 0 }, { p: 0.75, y: 0 },
      { p: 0.9, y: 1 },
    ];
    const model = fitIsotonic(pairs, { minBinSample: 3 });
    for (const bin of model.bins) expect(bin.n).toBeGreaterThanOrEqual(3);
    // 0,35 ligt tussen de eerste twee gepoolde bins: de waarde moet de
    // lineaire interpolatie tussen die bins volgen, niet uitkomen op een
    // van de randwaarden.
    const share = (0.35 - model.bins[0].p) / (model.bins[1].p - model.bins[0].p);
    const expected = model.bins[0].y + share * (model.bins[1].y - model.bins[0].y);
    expect(applyIsotonic(0.35, model)).toBeCloseTo(expected, 6);
  });

  it("platt blijft binnen de ingestelde grenzen", () => {
    const params = fitPlatt([
      { p: 0.9, y: 1 },
      { p: 0.85, y: 0 },
      { p: 0.7, y: 1 },
    ]);
    expect(params.a).toBeGreaterThanOrEqual(0.2);
    expect(params.a).toBeLessThanOrEqual(5);
    expect(params.b).toBeGreaterThanOrEqual(-5);
    expect(params.b).toBeLessThanOrEqual(5);
  });
});

describe("selectCalibration", () => {
  it("valt terug op identity bij een te kleine steekproef", () => {
    const report = selectCalibration([{ d: "2026-09-01", cf: 0.6, hit: true }], { minSample: 150 });
    expect(report.method).toBe("identity");
    expect(report.reason).toBe("te-weinig-beoordeelde-voorspellingen");
    expect(report.candidates).toBeNull();
  });

  it("meet alle kandidaten op een chronologische holdout", () => {
    const rows = [];
    for (let index = 0; index < 200; index += 1) {
      const month = String(1 + Math.floor(index / 30)).padStart(2, "0");
      const day = String(1 + (index % 28)).padStart(2, "0");
      // Systematisch overmoedig: confidence 0,9 maar de helft komt uit.
      rows.push({ d: `2026-${month}-${day}`, cf: 0.9, hit: index % 2 === 0 });
    }
    const report = selectCalibration(rows);
    expect(report.candidates).toHaveLength(4);
    expect(report.fitSample + report.holdoutSample).toBe(200);
    expect(["identity", "platt", "temperature", "isotonic"]).toContain(report.method);
    expect(report.baselineLogLoss).not.toBeNull();
    // Bucket-pooling: de isotonic-kandidaat heeft geen losse n=1-blokjes meer.
    const minimum = Math.max(5, Math.ceil(report.fitSample / 60));
    expect(report.isotonicMinBinSample).toBe(minimum);
    const isotonic = report.candidates.find((candidate) => candidate.method === "isotonic");
    expect(isotonic.params.minBinSample).toBe(minimum);
    for (const bin of isotonic.params.bins) {
      expect(bin.n).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("negeert records zonder bruikbare confidence of beoordeling", () => {
    const rows = [
      { d: "2026-01-01", cf: 0.5 },
      { d: "2026-01-02", hit: true },
      { d: "2026-01-03", cf: 0, hit: true },
      { d: "2026-01-04", cf: 1, hit: false },
    ];
    const report = selectCalibration(rows, { minSample: 10 });
    expect(report.sample).toBe(0);
    expect(report.method).toBe("identity");
  });
});
