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
});
