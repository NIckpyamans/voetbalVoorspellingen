import { describe, expect, it } from "vitest";
import { buildBackfillRecommendation } from "../../scripts/backfill-upcoming-h2h.js";

describe("H2H backfill report recommendation", () => {
  it("reports remaining fixtures without reading a report being constructed", () => {
    expect(buildBackfillRecommendation({
      remaining: 12,
      providerConfigured: true,
      apiFootballEnabled: true,
      filled: [],
      databaseWritable: true,
    })).toContain("12 fixtures");
  });

  it("explains when no configured provider can fill history", () => {
    expect(buildBackfillRecommendation({
      remaining: 0,
      providerConfigured: false,
      apiFootballEnabled: false,
      filled: [],
      databaseWritable: false,
    })).toContain("niet geconfigureerd");
  });
});
