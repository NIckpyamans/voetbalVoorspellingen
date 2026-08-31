import { describe, expect, it } from "vitest";
import { classifyProviderResult, PROVIDER_RESULT } from "../../scripts/worker/provider-observability.js";

describe("provider result taxonomy", () => {
  it.each([
    [{ status: "ok", records: 1 }, PROVIDER_RESULT.FOUND],
    [{ status: "local_quota_guard" }, PROVIDER_RESULT.QUOTA],
    [{ status: "fixture_id_missing" }, PROVIDER_RESULT.MAPPING_FAILED],
    [{ status: "http_403" }, PROVIDER_RESULT.HTTP_ERROR],
    [{ status: "acceptance_gate_closed" }, PROVIDER_RESULT.ACCEPTANCE_BLOCKED],
    [{ status: "not_published_yet" }, PROVIDER_RESULT.NOT_PUBLISHED],
  ])("classifies %o", (input, expected) => expect(classifyProviderResult(input)).toBe(expected));
});
