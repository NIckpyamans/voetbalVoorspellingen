import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../services/matchService", () => ({ fetchMatchesAndPredictions: fetchMock }));

import { VelocityEngine } from "../../services/velocityEngine";

describe("VelocityEngine polling", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("does not publish a stale response or schedule a timer after the selected date changes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const pending = new Map();
    fetchMock.mockImplementation((date) => new Promise((resolve) => pending.set(date, resolve)));
    const engine = new VelocityEngine();
    const received = [];
    engine.subscribe((payload) => received.push(payload));

    const olderPulse = engine.startPulse("2000-01-01");
    const currentPulse = engine.startPulse("2000-01-02");
    pending.get("2000-01-02")({ matches: [{ id: "new" }], predictions: {}, lastRun: null });
    await currentPulse;
    pending.get("2000-01-01")({ matches: [{ id: "old" }], predictions: {}, lastRun: null });
    await olderPulse;

    expect(received).toHaveLength(1);
    expect(received[0].matches[0].id).toBe("new");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    engine.stopPulse();
  });

  it("keeps the live polling interval instead of resetting it on every quick check", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    fetchMock.mockResolvedValue({
      matches: [{ status: "LIVE", minuteValue: 20 }],
      predictions: {},
      lastRun: null,
    });
    const engine = new VelocityEngine();

    await engine.startPulse("2000-01-01");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    engine.stopPulse();
  });
});
