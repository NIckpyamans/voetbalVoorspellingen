import { describe, expect, it } from "vitest";
import { adviseMarketWeight, DEFAULT_MARKET_WEIGHT } from "../../shared/ensembleWeightPolicy.js";
import { assessModelHealth } from "../../shared/modelHealth.js";
import {
  REMOTE_STORE_KEYS,
  buildStoreManifest,
  parseStoreManifest,
  readRemoteMatchStore,
} from "../../shared/matchStoreRemote.js";

describe("adviseMarketWeight", () => {
  it("houdt het huidige gewicht zonder genoeg paren", () => {
    const advice = adviseMarketWeight({ modelN: 40, model: { logLoss: 1.4 }, market: { logLoss: 1.0 } });
    expect(advice.direction).toBe("hold");
    expect(advice.reason).toBe("te-weinig-paren");
    expect(advice.advised).toBe(DEFAULT_MARKET_WEIGHT);
  });

  it("verhoogt niets wanneer het model niet slechter is dan de markt", () => {
    const advice = adviseMarketWeight({ modelN: 400, model: { logLoss: 0.98 }, market: { logLoss: 1.0 } });
    expect(advice.direction).toBe("hold");
    expect(advice.reason).toBe("model-niet-slechter-dan-markt");
  });

  it("verhoogt begrensd wanneer het model aantoonbaar slechter is", () => {
    const advice = adviseMarketWeight({ modelN: 400, model: { logLoss: 1.1 }, market: { logLoss: 1.0 } });
    expect(advice.direction).toBe("up");
    expect(advice.advised).toBeCloseTo(0.24, 3);
    expect(advice.confidence).toBeGreaterThan(0.5);
  });

  it("kapt een groot advies af op de bovengrens", () => {
    const advice = adviseMarketWeight({ modelN: 400, model: { logLoss: 2 }, market: { logLoss: 1 } });
    expect(advice.advised).toBe(0.55);
  });

  it("geeft geen advies zonder geldige logloss", () => {
    const advice = adviseMarketWeight({ modelN: 400, market: { logLoss: 0 } });
    expect(advice.direction).toBe("hold");
    expect(advice.reason).toBe("geen-geldige-logloss");
  });
});

describe("assessModelHealth", () => {
  const healthy = {
    store: { matches: 100 },
    integrity: { total: 100, dropped: 0 },
    dataQuality: { withDq: 100, freshness: { fresh: 80, recent: 15, stale: 0, old: 2, unknown: 3 } },
    calibration: { n: 120, ece: 0.03 },
    marketBaseline: { probability: { modelN: 40 } },
    backtest: { verdict: "sterktemodel-beter" },
  };

  it("meldt ok wanneer alle checks binnen de grens vallen", () => {
    const health = assessModelHealth(healthy);
    expect(health.status).toBe("ok");
    expect(health.checks).toHaveLength(6);
    expect(health.summary).toEqual([]);
  });

  it("meldt degraded bij oude odds en te weinig kalibratie", () => {
    const health = assessModelHealth({
      ...healthy,
      dataQuality: { withDq: 100, freshness: { old: 60, unknown: 5 } },
      calibration: { n: 10, ece: 0.2 },
    });
    expect(health.status).toBe("degraded");
    expect(health.summary.join(" ")).toContain("odds-versheid");
    expect(health.summary.join(" ")).toContain("kalibratie");
  });

  it("meldt blocked zonder wedstrijden in de opslag", () => {
    const health = assessModelHealth({ store: { matches: 0 } });
    expect(health.status).toBe("blocked");
    expect(health.checks[0]).toMatchObject({ id: "opslag", status: "blocked" });
  });
});

describe("remote match store", () => {
  const store = {
    schema: "match-store-v2",
    src: "abc123",
    matches: { m1: { d: "2026-10-01", h: "FC Utrecht", a: "Willem II", hs: 2, as: 1 } },
  };
  const index = {
    byTeam: { "fc utrecht": ["m1"], "willem ii": ["m1"] },
    byPair: { "fc utrecht|willem ii": ["m1"] },
    byDate: { "2026-10-01": ["m1"] },
  };

  it("bouwt een manifest dat de index tegen de opslag controleert", () => {
    const manifest = buildStoreManifest({ store, index, publishedAt: "2026-10-28T00:00:00Z" });
    expect(manifest).toMatchObject({
      schema: "match-store-v2",
      matches: 1,
      teams: 2,
      pairs: 1,
      indexedSlots: 2,
      indexMatchesStore: true,
      sourceFingerprint: "abc123",
      publishedAt: "2026-10-28T00:00:00Z",
    });
    expect(manifest.keys).toEqual(REMOTE_STORE_KEYS);
  });

  it("wijst een index af die niet bij de opslag past", () => {
    const manifest = buildStoreManifest({ store, index: { byTeam: { "fc utrecht": ["m1"] } } });
    expect(manifest.indexMatchesStore).toBe(false);
    expect(parseStoreManifest(manifest)).toBeNull();
  });

  it("leest de objecten uit R2 en weigert een afwijkend manifest", async () => {
    const objects = {
      [REMOTE_STORE_KEYS.store]: store,
      [REMOTE_STORE_KEYS.index]: index,
      [REMOTE_STORE_KEYS.manifest]: buildStoreManifest({ store, index }),
    };
    const get = async ({ key }) => ({ ok: true, body: Buffer.from(JSON.stringify(objects[key])) });
    const result = await readRemoteMatchStore({ get });
    expect(result.ok).toBe(true);
    expect(result.manifest.matches).toBe(1);
    expect(Object.keys(result.store.matches)).toEqual(["m1"]);

    const mismatch = {
      ...objects,
      [REMOTE_STORE_KEYS.manifest]: { ...objects[REMOTE_STORE_KEYS.manifest], matches: 99 },
    };
    const badReader = async ({ key }) => ({ ok: true, body: Buffer.from(JSON.stringify(mismatch[key])) });
    const bad = await readRemoteMatchStore({ get: badReader });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("manifest-wijkt-af");
  });

  it("meldt een ontbrekend manifest als reden", async () => {
    const result = await readRemoteMatchStore({ get: async () => ({ ok: false, reason: "not_found" }) });
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
  });
});
