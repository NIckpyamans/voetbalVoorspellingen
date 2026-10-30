import { describe, expect, it } from "vitest";
import { analysePredictionMisses, annotateProposalsWithWeightGate } from "../../shared/missAnalysis.js";

function record(overrides = {}) {
  return {
    d: "2026-10-01",
    lg: "Test - Markt",
    h: "A",
    a: "B",
    hs: 0,
    as: 1,
    po: "H",
    ao: "A",
    hit: false,
    cf: 0.55,
    mk: "A",
    mh: true,
    dq: { cs: 0.95, mi: 0, sf: "voldoende" },
    ...overrides,
  };
}

function repeat(count, overrides = {}) {
  return Array.from({ length: count }, () => record(overrides));
}

describe("analysePredictionMisses", () => {
  it("stelt marktgewicht voor wanneer de markt vaker gelijk had dan het model", () => {
    const analysis = analysePredictionMisses(repeat(30), { minSample: 20 });
    const competition = analysis.competitions.find((entry) => entry.league === "Test - Markt");
    expect(competition.decided).toBe(30);
    expect(competition.misses).toBe(30);
    expect(competition.market.disagreeButRight).toBe(30);
    expect(competition.market.disagreeButRightShare).toBe(1);
    expect(competition.proposal.code).toBe("marktgewicht-omhoog");
    expect(analysis.proposals).toHaveLength(1);
    // Een voorstel is geen ingreep.
    expect(analysis.applied).toBe(false);
    expect(analysis.proposals[0].applied).toBe(false);
  });

  it("zet databronnen voor op gewichten wanneer de misses geen volledige invoer hadden", () => {
    const records = repeat(30, { dq: { cs: 0.4, mi: 5 }, mk: "H", mh: false });
    const analysis = analysePredictionMisses(records, { minSample: 20 });
    const competition = analysis.competitions[0];
    expect(competition.data.missSufficiency.onvoldoende).toBe(30);
    expect(competition.data.insufficientMissShare).toBe(1);
    expect(competition.proposal.code).toBe("data-eerst");
    expect(competition.proposal.evidence.insufficientMisses).toBe(30);
  });

  it("tempert de zekerheid wanneer het model bij een miss even stellig is", () => {
    const records = [
      ...repeat(15, { ao: "H", hit: true, po: "H", mk: "H", mh: true, cf: 0.5 }),
      ...repeat(15, { ao: "A", hit: false, po: "H", mk: "H", mh: false, cf: 0.9 }),
    ];
    const analysis = analysePredictionMisses(records, { minSample: 20 });
    const competition = analysis.competitions[0];
    expect(competition.confidence.avgOnMiss).toBeGreaterThan(competition.confidence.avgOnHit);
    expect(competition.confidence.gapVsHitRate).toBeGreaterThan(0.15);
    expect(competition.proposal.code).toBe("zekerheid-temper");
  });

  it("wijst een component aan die op de misses de juiste kant had", () => {
    const cp = [["elo", 1, 0.2, 0.2, 0.6]];
    const records = [
      ...repeat(15, { ao: "H", hit: true, po: "H", mk: "H", mh: true, cf: 0.5, cp }),
      ...repeat(15, { ao: "A", hit: false, po: "H", mk: "H", mh: false, cf: 0.5, cp }),
    ];
    const analysis = analysePredictionMisses(records, { minSample: 20 });
    const competition = analysis.competitions[0];
    expect(competition.components[0]).toMatchObject({ key: "elo", rightOnMiss: 15 });
    expect(competition.components[0].rightOnMissShare).toBe(1);
    expect(competition.proposal.code).toBe("component-herwegen");
    expect(competition.proposal.evidence.component).toBe("elo");
  });

  it("doet geen voorstel onder de minimumsteekproef", () => {
    const analysis = analysePredictionMisses(repeat(5), { minSample: 20 });
    expect(analysis.competitions[0].proposal.code).toBe("te-weinig-data");
    expect(analysis.proposals).toEqual([]);
  });

  it("meldt wanneer de datakwaliteit nog nergens is vastgelegd", () => {
    const records = Array.from({ length: 25 }, () => {
      const base = record();
      delete base.dq;
      return base;
    });
    const analysis = analysePredictionMisses(records, { minSample: 20 });
    expect(analysis.overall.data.sufficiency.onbekend).toBe(25);
    expect(analysis.notes.map((note) => note.code)).toContain("sufficiency-onbekend");
  });

  it("koppelt de holdout-poort aan een marktgewicht-advies", () => {
    const records = repeat(30, { lg: "Test - LaLiga" });
    const analysis = analysePredictionMisses(records, { minSample: 20 });
    expect(analysis.proposals[0].code).toBe("marktgewicht-omhoog");
    // Te weinig paren voor de poort: het advies mag niet als ingreep gelden.
    annotateProposalsWithWeightGate(analysis, {
      minSample: 100,
      competitionsAgreed: 0,
      competitionsTotal: 1,
      competitions: [{ league: "Test - LaLiga", sample: 44, minSample: 100, available: false }],
    });
    expect(analysis.proposals[0].gate).toMatchObject({ status: "te-weinig-paren", applies: false });
    expect(analysis.proposals[0].applied).toBe(false);
  });

  it("laat de poort een advies bevestigen wanneer de holdout die competitie doorlaat", () => {
    const records = repeat(30, { lg: "Test - LaLiga" });
    const analysis = analysePredictionMisses(records, { minSample: 20 });
    annotateProposalsWithWeightGate(analysis, {
      minSample: 100,
      competitionsAgreed: 1,
      competitionsTotal: 1,
      competitions: [{ league: "Test - LaLiga", sample: 140, holdoutImproves: true, recommendedWeight: 0.28 }],
    });
    expect(analysis.competitions[0].proposal.gate).toMatchObject({ status: "poort-gehaald", applies: true, weight: 0.28 });
  });

  it("telt per competitie apart, zodat bijsturing per competitie kan verschillen", () => {
    const records = [
      ...repeat(30, { lg: "Test - Markt" }),
      ...repeat(30, { lg: "Test - Data", dq: { cs: 0.3, mi: 6 } }),
    ];
    const analysis = analysePredictionMisses(records, { minSample: 20 });
    expect(analysis.competitions).toHaveLength(2);
    const codes = Object.fromEntries(analysis.competitions.map((entry) => [entry.league, entry.proposal.code]));
    expect(codes["Test - Markt"]).toBe("marktgewicht-omhoog");
    expect(codes["Test - Data"]).toBe("data-eerst");
  });
});
