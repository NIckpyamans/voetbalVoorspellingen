import { describe, expect, it } from "vitest";
import handler, { compactSnapshot, selectBoundedSnapshots } from "../../api/prediction-snapshots";

function snapshot(index, matchId = `match-${index}`) {
  return {
    predictionId: `prediction-${index}`,
    matchId,
    generatedAt: new Date(Date.UTC(2026, 7, 1, 12, index)).toISOString(),
    inputSnapshot: { large: "x".repeat(10_000), lineupStatus: "projected" },
    calibration: { method: "test" },
    explanation: { text: "large detail" },
    features: { ppg_diff: index },
  };
}

describe("prediction snapshot API bounds", () => {
  it("caps unfiltered requests and returns newest records first", () => {
    const snapshots = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => {
        const value = snapshot(index);
        return [value.predictionId, value];
      }),
    );

    const selected = selectBoundedSnapshots(snapshots, { limit: 500 });

    expect(selected).toHaveLength(50);
    expect(selected[0].predictionId).toBe("prediction-79");
  });

  it("applies match and cursor filters before pagination", () => {
    const snapshots = Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => {
        const value = snapshot(index, "same-match");
        return [value.predictionId, value];
      }),
    );

    const selected = selectBoundedSnapshots(snapshots, {
      matchId: "same-match",
      before: snapshots["prediction-4"].generatedAt,
      limit: 2,
    });

    expect(selected.map((item) => item.predictionId)).toEqual(["prediction-3", "prediction-2"]);
  });

  it("omits large detail fields unless explicitly requested", () => {
    const value = snapshot(1);

    expect(compactSnapshot(value)).not.toHaveProperty("inputSnapshot");
    expect(compactSnapshot(value)).not.toHaveProperty("calibration");
    expect(compactSnapshot(value, true)).toHaveProperty("inputSnapshot.large");
    expect(compactSnapshot(value, true)).toHaveProperty("calibration.method", "test");
  });

  it("serves the durable fallback through a bounded response", async () => {
    const req = { method: "GET", query: {}, headers: {} };
    let statusCode = 200;
    let body;
    const res = {
      setHeader() {},
      status(code) {
        statusCode = code;
        return this;
      },
      json(value) {
        body = value;
        return value;
      },
    };

    await handler(req, res);

    expect(statusCode).toBe(200);
    expect(body.items.length).toBeLessThanOrEqual(25);
    expect(body.limit).toBe(25);
    expect(body.memoryMb.rss).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(body), "utf8")).toBeLessThan(2 * 1024 * 1024);
    expect(body.items[0]).not.toHaveProperty("inputSnapshot");
  });
});
