import { describe, expect, it } from "vitest";
import { assertFeaturePublication, evaluateFeaturePublication } from "../../scripts/worker/feature-publication-gate.js";

function prediction(overrides = {}) {
  return {
    featureVector: Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`f${index}`, index])),
    featureSourceMetadata: { fields: { fixture: { available: true } }, coverage: { timestampCoverage: 1 } },
    ...overrides,
  };
}

describe("feature publication gate", () => {
  it("accepts complete current worker output", () => {
    expect(evaluateFeaturePublication([prediction(), prediction()])).toMatchObject({ allowed: true, featureCoverage: 1 });
  });

  it("blocks a hidden feature regression before publication", () => {
    const rows = Array.from({ length: 10 }, (_, index) => index === 0 ? prediction() : prediction({ featureVector: null }));
    expect(() => assertFeaturePublication(rows)).toThrow(/publicatie geblokkeerd/);
  });
});
