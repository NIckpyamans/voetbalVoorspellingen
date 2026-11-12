import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "scripts", "server-worker.js"), "utf8");

describe("worker feature-context batching", () => {
  it("prefetcht een keer per datumvenster en houdt de enkelvoudige read als fallback", () => {
    expect(source).toContain(
      'import { readDatabaseFeatureContextBatch } from "../shared/databaseFeatureContextBatch.js";'
    );
    expect(source).toContain("const dbFeatureContextBatch = await readDatabaseFeatureContextBatch(");
    expect(source).toContain("dbFeatureContextBatch.has(matchId)");
    expect(source).toContain(": await readDatabaseFeatureContext({");
    // De prefetch staat vóór de eventloop, niet erin: anders is het geen batch.
    const prefetchAt = source.indexOf("const dbFeatureContextBatch = await readDatabaseFeatureContextBatch(");
    const loopAt = source.indexOf("for (const event of allEvents[date] || []) {");
    expect(prefetchAt).toBeGreaterThan(0);
    expect(prefetchAt).toBeLessThan(loopAt);
  });
});
