import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "../../shared/http.js";

describe("fetchWithRetry abort handling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("enforces the timeout even when the caller supplies an abort signal", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason || new Error("aborted")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchWithRetry("https://example.com", { signal: new AbortController().signal }, {
      retries: 0,
      timeoutMs: 25,
    });
    const assertion = expect(request).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(25);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("does not retry when the caller intentionally aborts", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason || new Error("aborted")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchWithRetry("https://example.com", { signal: controller.signal }, {
      retries: 2,
      baseDelayMs: 1,
      maxDelayMs: 1,
    });
    const assertion = expect(request).rejects.toThrow();
    controller.abort(new Error("cancelled by caller"));
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
