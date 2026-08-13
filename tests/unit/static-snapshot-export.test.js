import { describe, expect, it } from "vitest";
import { selectStaticSnapshotIds } from "../../scripts/worker/archive.js";

describe("static day snapshot export", () => {
  it("keeps the earliest and latest immutable snapshot for Git while R2 retains the full ledger", () => {
    const snapshots = {
      first: { generatedAt: "2026-08-13T08:00:00Z" },
      middle: { generatedAt: "2026-08-13T12:00:00Z" },
      latest: { generatedAt: "2026-08-13T18:00:00Z" },
    };
    expect(selectStaticSnapshotIds(["middle", "latest", "first"], snapshots, 2)).toEqual(["first", "latest"]);
  });
});
