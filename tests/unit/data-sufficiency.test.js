import { describe, expect, it } from "vitest";
import {
  deriveDataSufficiency,
  sufficiencyFromStoreRecord,
} from "../../shared/dataSufficiency.js";

describe("deriveDataSufficiency", () => {
  it("noemt een volledige invoer voldoende", () => {
    const result = deriveDataSufficiency({
      dataCompleteness: { score: 0.95, missing: [] },
      missingData: [],
      oddsStatus: "prematch",
      freshness: { f: "recent", h: 9 },
    });
    expect(result.status).toBe("voldoende");
    expect(result.enoughInformation).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("tempert bij een hoge score maar te veel gaten", () => {
    const result = deriveDataSufficiency({
      dataCompleteness: { score: 0.9 },
      missingData: ["h2h", "lineups", "odds"],
    });
    expect(result.status).toBe("beperkt");
    expect(result.missingCount).toBe(3);
    expect(result.reasons).toContain("te-veel-ontbrekende-bronnen");
  });

  it("noemt een lage compleetheid onvoldoende en meldt ontbrekende odds", () => {
    const result = deriveDataSufficiency({
      dataCompleteness: { score: 0.45 },
      missingData: ["lineups"],
      oddsStatus: "odds_missing",
    });
    expect(result.status).toBe("onvoldoende");
    expect(result.enoughInformation).toBe(false);
    expect(result.reasons).toContain("odds-ontbreken");
  });

  it("houdt onbekend echt onbekend in plaats van voldoende", () => {
    const result = deriveDataSufficiency({});
    expect(result.status).toBe("onbekend");
    expect(result.enoughInformation).toBe(false);
    expect(result.score).toBeNull();
  });
});

describe("sufficiencyFromStoreRecord", () => {
  it("gebruikt de opgeslagen status wanneer die er is", () => {
    const info = sufficiencyFromStoreRecord({ dq: { cs: 0.5, mi: 4, sf: "beperkt" } });
    expect(info).toMatchObject({ status: "beperkt", source: "opgeslagen" });
    expect(info.enoughInformation).toBe(false);
  });

  it("leidt de status af uit de compacte opslag wanneer sf ontbreekt", () => {
    expect(sufficiencyFromStoreRecord({ dq: { cs: 0.92, mi: 1 } })).toMatchObject({
      status: "voldoende",
      source: "afgeleid",
    });
    expect(sufficiencyFromStoreRecord({ dq: { cs: 0.3, mi: 6 } }).status).toBe("onvoldoende");
  });

  it("zegt onbekend wanneer er niets over de invoer is vastgelegd", () => {
    expect(sufficiencyFromStoreRecord({}).status).toBe("onbekend");
  });
});
