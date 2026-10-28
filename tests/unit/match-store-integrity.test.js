import { describe, expect, it } from "vitest";
import { buildMatchIndex, buildPredictionContext } from "../../shared/matchStore.js";
import { sanitizeMatchStore } from "../../shared/matchStoreIntegrity.js";

const store = {
  schema: "match-store-v2",
  src: "fingerprint",
  matches: {
    ok: {
      d: "2026-10-01",
      lg: "Netherlands - Eredivisie",
      h: "FC Utrecht",
      a: "Willem II",
      hs: 2,
      as: 1,
      po: "H",
      ao: "H",
      hit: true,
    },
    negatief: { d: "2026-10-02", h: "Ajax", a: "PSV", hs: -1, as: 0 },
    datum: { d: "2026-13-45", h: "Ajax", a: "PSV", hs: 1, as: 0 },
    zelfde: { d: "2026-10-03", h: "Ajax", a: "Ajax", hs: 1, as: 0 },
    geenteam: { d: "2026-10-04", h: "", a: "PSV", hs: 1, as: 0 },
    fouteUitslag: {
      d: "2026-10-05",
      h: "Feyenoord",
      a: "Twente",
      hs: 1,
      as: 1,
      po: "H",
      ao: "H",
      y: "A",
      hit: true,
    },
    geenRecord: null,
  },
};

describe("sanitizeMatchStore", () => {
  it("verwijdert onmogelijke records en houdt de rest intact", () => {
    const { store: clean, report } = sanitizeMatchStore(store);
    expect(Object.keys(clean.matches).sort()).toEqual(["fouteUitslag", "ok"]);
    // De metadata van de opslag blijft staan; alleen de records worden gezuiverd.
    expect(clean.schema).toBe("match-store-v2");
    expect(clean.src).toBe("fingerprint");
    expect(report.total).toBe(7);
    expect(report.kept).toBe(2);
    expect(report.dropped).toBe(5);
    expect(report.reasons["ongeldige-score"]).toBe(1);
    expect(report.reasons["ongeldige-datum"]).toBe(1);
    expect(report.reasons["zelfde-team"]).toBe(1);
    expect(report.reasons["team-ontbreekt"]).toBe(1);
    expect(report.reasons["geen-record"]).toBe(1);
  });

  it("leidt de uitkomst uit de doelpunten af en herrekent de beoordeling", () => {
    const { store: clean, report } = sanitizeMatchStore(store);
    const record = clean.matches.fouteUitslag;
    expect(record.ao).toBe("D");
    expect(record.y).toBe("D");
    // po was H en de werkelijke uitkomst is nu D: de oude hit klopte niet meer.
    expect(record.hit).toBe(false);
    expect(report.correctedOutcome).toBe(2);
  });

  it("bouwt de index en de voorspelcontext op alleen geldige records", () => {
    const { store: clean } = sanitizeMatchStore(store);
    const index = buildMatchIndex(clean);
    const context = buildPredictionContext(clean, index, "FC Utrecht", "Willem II", {
      before: "2026-10-10",
    });
    expect(context.home.recent).toHaveLength(1);
    expect(context.home.restDays).toBe(9);
    expect(context.headToHead.played).toBe(1);
  });

  it("laat een lege of ontbrekende opslag niet stuklopen", () => {
    const leeg = sanitizeMatchStore({});
    expect(leeg.report.total).toBe(0);
    expect(leeg.store.matches).toEqual({});
    const zonderRecords = sanitizeMatchStore({ schema: "match-store-v2" });
    expect(zonderRecords.store.matches).toEqual({});
  });
});
