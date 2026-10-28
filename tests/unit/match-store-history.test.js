import { describe, expect, it } from "vitest";
import {
  buildMatchStoreFormIndex,
  dayPayloadsFromMatchStore,
  loadRemoteMatchStoreIndex,
  matchStoreFormProfile,
} from "../../scripts/worker/match-store-history.js";
import { buildStoreManifest, REMOTE_STORE_KEYS } from "../../shared/matchStoreRemote.js";

const NOW = Date.parse("2026-04-12T12:00:00.000Z");

const sampleStore = {
  schema: "match-store-v2",
  src: "abc123",
  matches: {
    m1: { d: "2026-04-11", lg: "Netherlands - Eredivisie", h: "Sparta Rotterdam", a: "FC Dordrecht", hs: 2, as: 0, po: "H", ao: "H", hit: true },
    m2: { d: "2026-04-11", lg: "Netherlands - Eredivisie", h: "MVV Maastricht", a: "Helmond Sport", hs: 0, as: 0 },
  },
};

const sampleIndex = {
  byTeam: {
    "sparta rotterdam": ["m1"],
    "fc dordrecht": ["m1"],
    "mvv maastricht": ["m2"],
    "helmond sport": ["m2"],
  },
  byPair: { "sparta rotterdam|fc dordrecht": ["m1"], "mvv maastricht|helmond sport": ["m2"] },
  byDate: { "2026-04-11": ["m1", "m2"] },
};

function stubReader(objects, counter = { calls: 0 }) {
  const get = async ({ key }) => {
    counter.calls += 1;
    const value = objects[key];
    if (value === undefined) return { ok: false, reason: "not_found" };
    return { ok: true, body: Buffer.from(JSON.stringify(value)) };
  };
  return { get, counter };
}

describe("match-store historiebron voor de worker", () => {
  it("zet compacte records om in afgeronde dagpayloads", () => {
    const days = dayPayloadsFromMatchStore(sampleStore);
    expect(days).toHaveLength(1);
    const match = days[0].matches[0];
    expect(match).toMatchObject({
      id: "m1",
      date: "2026-04-11",
      kickoff: "2026-04-11T00:00:00.000Z",
      homeTeamName: "Sparta Rotterdam",
      awayTeamName: "FC Dordrecht",
      score: "2-0",
      status: "FT",
      dataSource: "match-store-r2",
    });
  });

  it("laat onmogelijke records buiten de historie", () => {
    const days = dayPayloadsFromMatchStore({
      matches: {
        badDate: { d: "11-04-2026", h: "A", a: "B", hs: 1, as: 0 },
        noScore: { d: "2026-04-11", h: "A", a: "B", hs: null, as: null },
        negative: { d: "2026-04-11", h: "A", a: "B", hs: -1, as: 0 },
        noTeams: { d: "2026-04-11", h: " ", a: "B", hs: 1, as: 0 },
        good: { d: "2026-04-11", h: "A", a: "B", hs: 1, as: 0 },
      },
    });
    const ids = days.flatMap((day) => day.matches.map((match) => match.id));
    expect(ids).toEqual(["good"]);
  });

  it("vindt een clubvormprofiel via de canonical sleutel", () => {
    const index = buildMatchStoreFormIndex(sampleStore, { now: NOW });
    const profile = matchStoreFormProfile(index, "Sparta Rotterdam", { now: NOW });
    expect(profile).not.toBeNull();
    expect(profile.recentMatches).toHaveLength(1);
    expect(profile.recentMatches[0]).toMatchObject({ venue: "H", opponent: "FC Dordrecht", score: "2-0", result: "W" });
    expect(profile.source).toContain("local-finished-results");
    expect(profile.pointsPerGame).toBe(3);
    // onbekende club: geen profiel, geen merge
    expect(matchStoreFormProfile(index, "FC Volendam", { now: NOW })).toBeNull();
    // index is een Map; een ongevulde loader (null) geeft ook geen profiel
    expect(matchStoreFormProfile(null, "Sparta Rotterdam", { now: NOW })).toBeNull();
  });

  it("laadt de gepubliceerde opslag en indexeert alle clubs", async () => {
    const { get, counter } = stubReader({
      [REMOTE_STORE_KEYS.store]: sampleStore,
      [REMOTE_STORE_KEYS.index]: sampleIndex,
      [REMOTE_STORE_KEYS.manifest]: buildStoreManifest({ store: sampleStore, index: sampleIndex }),
    });
    const result = await loadRemoteMatchStoreIndex({ config: { configured: true }, get, now: NOW });
    expect(result.loaded).toBe(true);
    expect(result.matches).toBe(2);
    expect(result.teams).toBe(4);
    expect(result.publishedAt).toBeTruthy();
    expect(result.sourceFingerprint).toBe("abc123");
    expect(counter.calls).toBe(3);
    expect(matchStoreFormProfile(result.index, "MVV Maastricht", { now: NOW })).toMatchObject({ pointsPerGame: 1 });
  });

  it("weigert objecten die niet bij het manifest passen", async () => {
    const { get } = stubReader({
      [REMOTE_STORE_KEYS.store]: sampleStore,
      [REMOTE_STORE_KEYS.index]: sampleIndex,
      [REMOTE_STORE_KEYS.manifest]: { ...buildStoreManifest({ store: sampleStore, index: sampleIndex }), matches: 99 },
    });
    const result = await loadRemoteMatchStoreIndex({ config: { configured: true }, get, now: NOW });
    expect(result).toMatchObject({ loaded: false, reason: "manifest-wijkt-af", index: null });
  });

  it("rapporteert een ontbrekend manifest en een ongeconfigureerde R2", async () => {
    const missing = await loadRemoteMatchStoreIndex({ config: { configured: true }, get: async () => ({ ok: false, reason: "not_found" }) });
    expect(missing).toMatchObject({ loaded: false, reason: "not_found", index: null });

    const unconfigured = await loadRemoteMatchStoreIndex({ config: { configured: false } });
    expect(unconfigured).toMatchObject({ loaded: false, reason: "r2_not_configured", index: null });
  });

  it("valt terug op een gerapporteerde reden wanneer de reader faalt", async () => {
    const result = await loadRemoteMatchStoreIndex({
      config: { configured: true },
      get: async () => { throw new Error("R2 download failed 500"); },
    });
    expect(result).toMatchObject({ loaded: false, index: null });
    expect(result.reason).toContain("R2 download failed 500");
  });
});
