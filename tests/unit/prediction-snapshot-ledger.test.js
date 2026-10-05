import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { compactSnapshotLedgerForApi, compactSnapshotLedgerForLocalRecovery, partitionSnapshotLedgerByMonth, persistSnapshotLedger, readR2SnapshotLedger, SNAPSHOT_LEDGER_MONTH_INDEX_R2_KEY } from "../../shared/predictionSnapshotLedger.js";

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
