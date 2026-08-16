import { describe, expect, it } from "vitest";
import { buildResponseLineage, inferResponseSource } from "../../shared/responseLineage.js";

describe("matches response lineage", () => {
  it("identifies every supported serving layer", () => {
    expect(inferResponseSource("postgres", 2)).toBe("postgres-database");
    expect(inferResponseSource("r2-dashboard-cache", 2)).toBe("cloudflare-r2-dashboard-cache");
    expect(inferResponseSource("codex/step3b-layout", 2)).toBe("github-worker-v4-split");
    expect(inferResponseSource("codex/step3b-layout", 0)).toBe("no-matches-yet");
  });

  it("exposes fixture lineage without requiring a Neon query", () => {
    const lineage = buildResponseLineage({
      sourceBranch: "codex/step3b-layout",
      matchCount: 3,
      meta: { workerVersion: "v23", lastRun: 123, sourceCoverage: { sourceBreakdown: { espn: 2, bbc: 1 } } },
    });
    expect(lineage).toMatchObject({
      sourceOfTruth: "github-worker-v4-split",
      sourceBranch: "codex/step3b-layout",
      matchCount: 3,
      fixtureSources: { espn: 2, bbc: 1 },
      fallbackActive: true,
    });
  });

  it("does not mark multiday Postgres responses as fallback", () => {
    expect(buildResponseLineage({
      sourceBranch: "postgres",
      matchCount: 2,
      source: "postgres-database-multiday",
    }).fallbackActive).toBe(false);
  });
});
