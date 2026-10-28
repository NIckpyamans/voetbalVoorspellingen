import { describe, expect, it } from "vitest";
import { buildSplitMeta } from "../../scripts/worker/archive.js";

describe("split data metadata", () => {
  it("publishes the feature gate result for health monitoring", () => {
    const featurePublicationGate = {
      allowed: true,
      featureCoverage: 1,
      metadataCoverage: 1,
      predictions: 12,
    };
    expect(buildSplitMeta({ matches: {}, featurePublicationGate })).toMatchObject({ featurePublicationGate });
  });

  it("publishes the match-store read summary so prediction and analysis prove the same history", () => {
    const matchStoreRemote = {
      hydratedAt: "2026-10-28T11:00:00.000Z",
      loaded: true,
      matches: 1184,
      teams: 613,
      publishedAt: "2026-10-28T11:00:30.250Z",
      sourceFingerprint: "990ee5d822169f13",
      reason: null,
    };
    expect(buildSplitMeta({ matches: {}, matchStoreRemote })).toMatchObject({ matchStoreRemote });
  });

  it("never carries the club index into meta.json", () => {
    const index = new Map([["ajax", [{ date: "2026-01-01" }]]]);
    const meta = buildSplitMeta({ matches: {}, matchStoreRemote: { loaded: true, index } });
    // De index is een Map: die zou als lege object door meta.json lekken en
    // de lectuur onleesbaar maken.
    expect(JSON.stringify(meta)).not.toContain("ajax");
    expect(meta.matchStoreRemote.loaded).toBe(true);
  });
});
