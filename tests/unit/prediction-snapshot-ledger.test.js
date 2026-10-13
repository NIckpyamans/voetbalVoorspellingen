import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { compactSnapshotLedgerForApi, compactSnapshotLedgerForLocalRecovery, decodeLedgerJson, ledgerDeltaSince, partitionSnapshotLedgerByMonth, persistSnapshotLedger, readR2SnapshotLedger, readSnapshotLedgerStorageSummary, SNAPSHOT_LEDGER_MONTH_INDEX_R2_KEY, snapshotLedgerMaxJsonBytes, SnapshotLedgerTooLargeError } from "../../shared/predictionSnapshotLedger.js";

describe("local snapshot recovery projection", () => {
  it("keeps the latest immutable snapshot per match and model", () => {
    const compact = compactSnapshotLedgerForLocalRecovery({
      predictionSnapshots: {
        old: { predictionId: "old", matchId: "match", modelVersion: "v1", generatedAt: "2026-08-01T10:00:00Z" },
        latest: { predictionId: "latest", matchId: "match", modelVersion: "v1", generatedAt: "2026-08-01T11:00:00Z" },
        otherModel: { predictionId: "otherModel", matchId: "match", modelVersion: "v2", generatedAt: "2026-08-01T09:00:00Z" },
      },
      evaluations: {
        old: { predictionId: "old" },
        latest: { predictionId: "latest" },
        otherModel: { predictionId: "otherModel" },
      },
    });
    expect(Object.keys(compact.predictionSnapshots).sort()).toEqual(["latest", "otherModel"]);
    expect(Object.keys(compact.evaluations).sort()).toEqual(["latest", "otherModel"]);
    expect(compact.predictionSnapshotIndex.match.sort()).toEqual(["latest", "otherModel"]);
  });
});

describe("monthly R2 snapshot ledger", () => {
  const config = { configured: true, prefix: "test", bucket: "bucket" };

  it("partitions prediction history and keeps linked evaluations with their snapshot month", () => {
    const partitions = partitionSnapshotLedgerByMonth({
      generatedAt: "2026-10-02T12:00:00.000Z",
      predictionSnapshots: {
        august: { predictionId: "august", matchId: "match-a", generatedAt: "2026-08-31T23:59:00Z" },
        september: { predictionId: "september", matchId: "match-b", generatedAt: "2026-09-01T00:01:00Z" },
      },
      evaluations: {
        august: { predictionId: "august", evaluatedAt: "2026-09-03T10:00:00Z" },
        september: { predictionId: "september", evaluatedAt: "2026-10-01T10:00:00Z" },
      },
      postMatchReviews: {
        "match-a": { matchId: "match-a", evaluatedAt: "2026-09-03T10:00:00Z" },
      },
    });

    expect([...partitions.keys()]).toEqual(["2026-08", "2026-09"]);
    expect(Object.keys(partitions.get("2026-08").predictionSnapshots)).toEqual(["august"]);
    expect(Object.keys(partitions.get("2026-08").evaluations)).toEqual(["august"]);
    expect(Object.keys(partitions.get("2026-09").predictionSnapshots)).toEqual(["september"]);
    expect(Object.keys(partitions.get("2026-09").evaluations)).toEqual(["september"]);
  });

  it("writes content-addressed monthly objects and carries old month references forward", async () => {
    const objects = new Map();
    const getObject = async ({ key }) => objects.has(key)
      ? { ok: true, body: objects.get(key) }
      : { ok: false, reason: "not_found" };
    const putObject = async ({ key, body }) => {
      objects.set(key, Buffer.from(body));
      return { ok: true, key };
    };
    const first = await persistSnapshotLedger({
      predictionSnapshots: {
        august: { predictionId: "august", matchId: "match-a", generatedAt: "2026-08-31T23:59:00Z" },
      },
    }, { config, getObject, putObject, allowInitialize: true });
    const second = await persistSnapshotLedger({
      predictionSnapshots: {
        september: { predictionId: "september", matchId: "match-b", generatedAt: "2026-09-01T00:01:00Z" },
      },
    }, { config, getObject, putObject });
    const third = await persistSnapshotLedger({
      predictionSnapshots: {
        october: { predictionId: "october", matchId: "match-c", generatedAt: "2026-10-01T00:01:00Z" },
      },
    }, { config, getObject, putObject });
    const reloaded = await readR2SnapshotLedger({ config, getObject });

    expect(first.months).toBe(1);
    expect(second.months).toBe(2);
    expect(third.months).toBe(3);
    expect(reloaded.available).toBe(true);
    expect(Object.keys(reloaded.ledger.predictionSnapshots).sort()).toEqual(["august", "october", "september"]);
    expect(reloaded.manifest.months.map((month) => month.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(new Set(reloaded.manifest.months.map((month) => month.key)).size).toBe(3);
    expect(objects.has(`test/${SNAPSHOT_LEDGER_MONTH_INDEX_R2_KEY}`)).toBe(true);
  });

  it("migrates the active legacy ledger into monthly shards before extending it", async () => {
    const legacy = {
      generatedAt: "2026-10-02T12:00:00.000Z",
      predictionSnapshots: {
        august: { predictionId: "august", matchId: "match-a", generatedAt: "2026-08-31T23:59:00Z" },
      },
      postMatchReviews: {},
      evaluations: {},
    };
    const objects = new Map([
      [`test/prediction-snapshots/active/ledger.json.gz`, gzipSync(Buffer.from(JSON.stringify(legacy)))],
    ]);
    const getObject = async ({ key }) => objects.has(key)
      ? { ok: true, body: objects.get(key) }
      : { ok: false, reason: "not_found" };
    const putObject = async ({ key, body }) => {
      objects.set(key, Buffer.from(body));
      return { ok: true, key };
    };

    const result = await persistSnapshotLedger({
      predictionSnapshots: {
        september: { predictionId: "september", matchId: "match-b", generatedAt: "2026-09-01T00:01:00Z" },
      },
    }, { config, getObject, putObject });
    const reloaded = await readR2SnapshotLedger({ config, getObject });

    expect(result.months).toBe(2);
    expect(Object.keys(reloaded.ledger.predictionSnapshots).sort()).toEqual(["august", "september"]);
    expect(reloaded.manifest.months.map((month) => month.month)).toEqual(["2026-08", "2026-09"]);
  });

  it("refuses to overwrite a monthly object when a referenced shard is missing", async () => {
    const objects = new Map();
    const getObject = async ({ key }) => objects.has(key)
      ? { ok: true, body: objects.get(key) }
      : { ok: false, reason: "not_found" };
    const putObject = async ({ key, body }) => {
      objects.set(key, Buffer.from(body));
      return { ok: true, key };
    };
    const result = await persistSnapshotLedger({
      predictionSnapshots: {
        august: { predictionId: "august", matchId: "match-a", generatedAt: "2026-08-31T23:59:00Z" },
      },
    }, { config, getObject, putObject, allowInitialize: true });
    const referenced = result.ledger.predictionSnapshots.august;
    const manifestKey = `test/${SNAPSHOT_LEDGER_MONTH_INDEX_R2_KEY}`;
    const manifest = JSON.parse(objects.get(manifestKey).toString("utf8"));
    const shardKey = `test/${manifest.months[0].key}`;
    objects.delete(shardKey);

    await expect(persistSnapshotLedger({
      predictionSnapshots: {
        september: { predictionId: "september", matchId: "match-b", generatedAt: "2026-09-01T00:01:00Z" },
      },
    }, { config, getObject, putObject })).rejects.toThrow(/monthly R2 ledger/i);
    expect(referenced.predictionId).toBe("august");
    expect(objects.get(manifestKey)).toEqual(Buffer.from(JSON.stringify(manifest) + "\n"));
  });
});

describe("ledger size guard", () => {
  it("rejects an oversized gzip ledger while decompressing, before any JSON.parse", () => {
    const gz = gzipSync(Buffer.alloc(4 * 1024 * 1024, "a"));
    expect(() => decodeLedgerJson(gz, "test", 1024 * 1024)).toThrow(SnapshotLedgerTooLargeError);
    try {
      decodeLedgerJson(gz, "test", 1024 * 1024);
    } catch (error) {
      expect(error.code).toBe("ledger_too_large");
    }
  });

  it("rejects an oversized raw ledger by compressed size without reading it", () => {
    expect(() => decodeLedgerJson(Buffer.alloc(2048, "x"), "test", 1024)).toThrow(SnapshotLedgerTooLargeError);
  });

  it("decodes a ledger that is within the limit", () => {
    const json = JSON.stringify({ predictionSnapshots: { a: { predictionId: "a" } } });
    expect(decodeLedgerJson(gzipSync(Buffer.from(json)), "test", 1024 * 1024)).toBe(json);
    expect(decodeLedgerJson(Buffer.from(json), "test", 1024 * 1024)).toBe(json);
  });

  it("reads the limit from SNAPSHOT_LEDGER_MAX_JSON_BYTES with a safe default", () => {
    expect(snapshotLedgerMaxJsonBytes({ SNAPSHOT_LEDGER_MAX_JSON_BYTES: "2048" })).toBe(2048);
    expect(snapshotLedgerMaxJsonBytes({ SNAPSHOT_LEDGER_MAX_JSON_BYTES: "nonsense" })).toBe(96 * 1024 * 1024);
    expect(snapshotLedgerMaxJsonBytes({})).toBe(96 * 1024 * 1024);
  });
});

describe("incremental ledger persistence", () => {
  const config = { configured: true, prefix: "test", bucket: "bucket" };

  it("returns only records that are new or changed since the loaded baseline", () => {
    const baseline = { predictionSnapshots: { old: { predictionId: "old" } }, evaluations: { old: { predictionId: "old" } } };
    const oldRef = baseline.predictionSnapshots.old;
    const current = {
      predictionSnapshots: { old: oldRef, fresh: { predictionId: "fresh", matchId: "m" } },
      evaluations: { old: baseline.evaluations.old },
      postMatchReviews: { m: { matchId: "m" } },
    };
    const delta = ledgerDeltaSince(baseline, current);
    expect(Object.keys(delta.predictionSnapshots)).toEqual(["fresh"]);
    expect(Object.keys(delta.evaluations)).toEqual([]);
    expect(Object.keys(delta.postMatchReviews)).toEqual(["m"]);
  });

  it("reads only the month shards a delta touches and carries the others forward untouched", async () => {
    const objects = new Map();
    const reads = [];
    const getObject = async ({ key }) => {
      reads.push(key);
      return objects.has(key) ? { ok: true, body: objects.get(key) } : { ok: false, reason: "not_found" };
    };
    const putObject = async ({ key, body }) => {
      objects.set(key, Buffer.from(body));
      return { ok: true, key };
    };
    await persistSnapshotLedger({
      predictionSnapshots: {
        august: { predictionId: "august", matchId: "match-a", generatedAt: "2026-08-31T23:59:00Z" },
        september: { predictionId: "september", matchId: "match-b", generatedAt: "2026-09-01T00:01:00Z" },
      },
    }, { config, getObject, putObject, allowInitialize: true });

    reads.length = 0;
    const result = await persistSnapshotLedger({
      predictionSnapshots: {
        september2: { predictionId: "september2", matchId: "match-c", generatedAt: "2026-09-02T10:00:00Z" },
      },
    }, { config, getObject, putObject, touchedOnly: true });

    const augustKey = `test/prediction-snapshots/year=2026/month=08/ledger-`;
    expect(reads.some((key) => key.startsWith(augustKey))).toBe(false);
    expect(result.touchedMonths).toBe(1);

    const reloaded = await readR2SnapshotLedger({ config, getObject });
    expect(Object.keys(reloaded.ledger.predictionSnapshots).sort()).toEqual(["august", "september", "september2"]);
    expect(reloaded.manifest.months.map((month) => month.month)).toEqual(["2026-08", "2026-09"]);
  });
});

describe("ledger storage summary", () => {
  it("reports monthly growth from the manifest without loading the ledger shards", async () => {
    const manifest = { version: "v2-monthly-ledger", months: [
      { month: "2026-08", snapshots: 1200 },
      { month: "2026-09", snapshots: 5400 },
    ] };
    const requested = [];
    const getObject = async ({ key }) => {
      requested.push(key);
      return { ok: true, body: Buffer.from(JSON.stringify(manifest)) };
    };
    const summary = await readSnapshotLedgerStorageSummary({
      root: "/nonexistent-root",
      config: { configured: true, prefix: "test", bucket: "bucket" },
      getObject,
      env: { SNAPSHOT_LEDGER_MAX_JSON_BYTES: "1000" },
    });
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain(SNAPSHOT_LEDGER_MONTH_INDEX_R2_KEY);
    expect(summary.r2.months).toBe(2);
    expect(summary.r2.totalSnapshotsIndexed).toBe(6600);
    expect(summary.r2.largestMonth).toEqual({ month: "2026-09", snapshots: 5400 });
    expect(summary.limitBytes).toBe(1000);
    expect(summary.warnings).toEqual([]);
  });

  it("surfaces an unreadable manifest as a warning instead of throwing", async () => {
    const summary = await readSnapshotLedgerStorageSummary({
      root: "/nonexistent-root",
      config: { configured: true, prefix: "test", bucket: "bucket" },
      getObject: async () => ({ ok: false, reason: "timeout" }),
    });
    expect(summary.r2.error).toBe("timeout");
    expect(summary.warnings.some((warning) => warning.includes("timeout"))).toBe(true);
  });
});

describe("snapshot API projection", () => {
  it("keeps query fields and removes heavyweight training details", () => {
    const compact = compactSnapshotLedgerForApi({
      predictionSnapshots: {
        prediction: {
          predictionId: "prediction",
          matchId: "match",
          modelVersion: "v1",
          generatedAt: "2026-08-01T11:00:00Z",
          features: { ppg_diff: 0.4 },
          inputSnapshot: {
            teamIdentity: { status: "provider_ids" },
            sourceAsOf: { fixture: "2026-08-01T10:59:00Z" },
            lineupStatus: "confirmed",
            rawProviderPayload: "x".repeat(100_000),
          },
          calibration: { samples: Array(500).fill(1) },
          explanation: { text: "x".repeat(10_000) },
        },
      },
    });

    const snapshot = compact.predictionSnapshots.prediction;
    expect(snapshot.features.ppg_diff).toBe(0.4);
    expect(snapshot.lineupStatus).toBe("confirmed");
    expect(snapshot.sourceAsOf.fixture).toBe("2026-08-01T10:59:00Z");
    expect(snapshot).not.toHaveProperty("inputSnapshot");
    expect(snapshot).not.toHaveProperty("calibration");
    expect(snapshot).not.toHaveProperty("explanation");
  });
});
