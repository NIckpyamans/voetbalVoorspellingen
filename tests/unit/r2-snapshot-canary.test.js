import { describe, expect, it } from "vitest";
import { buildSnapshotCanary, runSnapshotCanary, verifySnapshotCanary } from "../../scripts/worker/r2-snapshot-canary.js";

describe("R2 snapshot evaluation canary", () => {
  it("evaluates the immutable synthetic snapshot", () => {
    const payload = buildSnapshotCanary(new Date("2026-07-23T10:00:00.000Z"));
    const result = verifySnapshotCanary(payload);
    expect(result.ok).toBe(true);
    expect(result.evaluation.exactHit).toBe(true);
    expect(result.evaluation.outcomeHit).toBe(true);
  });

  it("proves write, read and checksum through the object contract", async () => {
    let stored = null;
    const result = await runSnapshotCanary({
      config: { configured: true, prefix: "test" },
      now: new Date("2026-07-23T10:00:00.000Z"),
      putObject: async ({ body }) => {
        stored = Buffer.from(body);
        return { ok: true };
      },
      getObject: async () => ({ ok: true, body: stored }),
    });
    expect(result.ok).toBe(true);
    expect(result.stage).toBe("complete");
    expect(result.key).toBe("test/health/snapshot-evaluation-canary.json");
  });

  it("fails closed when R2 is not configured", async () => {
    await expect(runSnapshotCanary({ config: { configured: false } })).resolves.toMatchObject({
      ok: false,
      reason: "r2_not_configured",
    });
  });
});
