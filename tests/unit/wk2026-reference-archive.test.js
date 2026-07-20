import { describe, expect, it } from "vitest";
import { buildWk2026ReferenceManifest } from "../../shared/wk2026-reference-archive.js";

describe("WK 2026 reference archive", () => {
  it("marks external prediction data as reference-only", () => {
    const manifest = buildWk2026ReferenceManifest({
      sourceUrl: "https://wk-2026-orakel.vercel.app",
      capturedAt: "2026-07-20T10:00:00.000Z",
      datasets: [{ path: "data/predictions/wk26-current.json", bytes: 42, sha256: "abc" }],
    });
    expect(manifest.source.usage).toBe("reference_only");
    expect(manifest.source.policy).toMatch(/must not consume/i);
    expect(manifest.datasets).toHaveLength(1);
  });
});
