import { describe, expect, it } from "vitest";
import { buildReferenceManifest } from "../../scripts/archive-wk2026-orakel-data.js";

describe("WK 2026 reference archive", () => {
  it("marks external prediction data as reference-only", () => {
    const manifest = buildReferenceManifest({
      capturedAt: "2026-07-20T10:00:00.000Z",
      datasets: [{ path: "data/predictions/wk26-current.json", bytes: 42, sha256: "abc" }],
    });
    expect(manifest.source.usage).toBe("reference_only");
    expect(manifest.source.policy).toMatch(/must not consume/i);
    expect(manifest.datasets).toHaveLength(1);
  });
});
