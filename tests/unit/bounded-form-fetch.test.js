import { describe, expect, it } from "vitest";
import { boundedFormFetch } from "../../scripts/worker/bounded-form-fetch.js";

describe("bounded form fetching", () => {
  it("retains a partial profile and aborts a slow fallback", async () => {
    let signal;
    const result = await boundedFormFetch(async (fetchImpl, savePartial) => {
      savePartial({ recentMatches: [{ score: "1-0" }] });
      await fetchImpl("https://example.com/results");
    }, {
      timeoutMs: 20, requestTimeoutMs: 1000,
      fetchImpl: async (_url, options) => {
        signal = options.signal;
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      },
    });
    expect(signal.aborted).toBe(true);
    expect(result.timedOut).toBe(true);
    expect(result.recentMatches).toHaveLength(1);
    expect(result.requests[0].provider).toBe("example.com");
  });

  it("records HTTP errors with their provider", async () => {
    const result = await boundedFormFetch(async (fetchImpl) => {
      await fetchImpl("https://example.com/results");
      return null;
    }, { timeoutMs: 100, requestTimeoutMs: 50, fetchImpl: async () => new Response("denied", { status: 403 }) });
    expect(result.requests).toEqual([{ provider: "example.com", status: "http_403" }]);
  });
});
