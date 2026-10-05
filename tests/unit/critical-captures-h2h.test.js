import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchR2H2HProfile } from "../../scripts/worker/critical-captures.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("R2 H2H publication pointer", () => {
  it("reads latest immutable H2H while accepting the legacy object key", async () => {
    process.env.CLOUDFLARE_R2_ACCOUNT_ID = "test-account";
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "test-key";
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "test-secret";
    process.env.CLOUDFLARE_R2_BUCKET = "test-bucket";
    const requested = [];
    globalThis.fetch = vi.fn(async (url) => {
      requested.push(String(url));
      if (String(url).includes("/m1/latest.json")) {
        return new Response(JSON.stringify({ capturedAt: "2026-10-01T00:00:00Z", h2h: { results: [{ date: "2025-01-01" }] } }), { status: 200 });
      }
      return new Response("missing", { status: 404 });
    });
    const payload = await fetchR2H2HProfile("m1", "2026-10-10T00:00:00Z");
    expect(payload?.h2h?.results).toHaveLength(1);
    expect(requested.some((url) => url.includes("/m1/latest.json"))).toBe(true);
    expect(requested.some((url) => url.includes("h2h/m1.json"))).toBe(false);
  });
});
