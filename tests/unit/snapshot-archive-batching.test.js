import { describe, expect, it } from "vitest";
import {
  DEFAULT_SNAPSHOT_ARCHIVE_BATCH,
  MAX_SNAPSHOT_ARCHIVE_BATCH,
  buildSnapshotArchivePayload,
  emptySnapshotArchiveCursor,
  nextSnapshotArchiveCursor,
  resolveSnapshotArchiveBatchSize,
} from "../../shared/snapshotArchive.js";

describe("snapshot archive pagination", () => {
  it("begrenst de batchgrootte zodat één Neon-respons klein blijft", () => {
    expect(resolveSnapshotArchiveBatchSize(undefined)).toBe(DEFAULT_SNAPSHOT_ARCHIVE_BATCH);
    expect(resolveSnapshotArchiveBatchSize("250")).toBe(250);
    expect(resolveSnapshotArchiveBatchSize("999999")).toBe(MAX_SNAPSHOT_ARCHIVE_BATCH);
    expect(resolveSnapshotArchiveBatchSize("0")).toBe(DEFAULT_SNAPSHOT_ARCHIVE_BATCH);
    expect(resolveSnapshotArchiveBatchSize("abc")).toBe(DEFAULT_SNAPSHOT_ARCHIVE_BATCH);
  });

  it("start met een cursor onder alle snapshots", () => {
    expect(emptySnapshotArchiveCursor().generatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("gebruikt de laatste rij als keyset-cursor", () => {
    const rows = [
      { prediction_id: "p1", generated_at: new Date("2026-09-01T10:00:00Z") },
      { prediction_id: "p2", generated_at: new Date("2026-09-02T10:00:00Z") },
    ];
    expect(nextSnapshotArchiveCursor(rows)).toEqual({
      generatedAt: "2026-09-02T10:00:00.000Z",
      predictionId: "p2",
    });
    expect(nextSnapshotArchiveCursor([])).toBeNull();
  });

  it("bouwt per batch een compleet archiefobject", () => {
    const payload = buildSnapshotArchivePayload([
      {
        prediction_id: "p1",
        match_id: "m1",
        generated_at: "2026-09-01T10:00:00Z",
        prediction_payload: { topExactScorePick: false },
        features: { x: 1 },
      },
    ], { generatedAt: "2026-10-30T00:00:00.000Z", batch: 2, keepPerMatch: 2, recentDaysProtected: 3 });
    expect(payload.recordCount).toBe(1);
    expect(payload.batch).toBe(2);
    expect(payload.records[0]).toMatchObject({ predictionId: "p1", matchId: "m1", features: { x: 1 } });
  });
});
