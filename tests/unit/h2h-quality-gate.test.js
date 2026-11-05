import { describe, expect, it } from "vitest";
import { buildH2HQualityGate } from "../../scripts/backfill-upcoming-h2h.js";

const blocked = (result, status = "http_error") => ({ provider: "api-football", result, status });
const answered = (result, status) => ({ provider: "espn", result, status });

describe("H2H-kwaliteitsgate", () => {
  it("faalt wanneer een volle batch geen enkele providerpoging deed", () => {
    const gate = buildH2HQualityGate({ candidates: 50, filled: 0, attempts: [] });
    expect(gate.applied).toBe(true);
    expect(gate.outcome).toBe("no_provider_attempts");
    expect(gate.failed).toBe(true);
  });

  it("faalt wanneer alle pogingen op quota of HTTP-fouten stukliepen", () => {
    const gate = buildH2HQualityGate({
      candidates: 50,
      filled: 0,
      attempts: [blocked("quota", "quota_exceeded"), blocked("http_error", "request_failed"), blocked("mapping_failed")],
    });
    expect(gate.outcome).toBe("provider_blocked");
    expect(gate.blockedAttempts).toBe(3);
    expect(gate.failed).toBe(true);
  });

  it("faalt niet wanneer providers netjes 'geen historie' antwoordden", () => {
    const gate = buildH2HQualityGate({
      candidates: 50,
      filled: 0,
      attempts: [answered("no_coverage", "not_found"), answered("no_coverage", "not_found")],
    });
    expect(gate.outcome).toBe("providers_reported_no_history");
    expect(gate.failed).toBe(false);
  });

  it("telt een lokale rate-limit niet als providerantwoord", () => {
    const gate = buildH2HQualityGate({
      candidates: 25,
      filled: 0,
      attempts: [answered("quota", "rate_limited_locally")],
    });
    expect(gate.attempts).toBe(0);
    expect(gate.outcome).toBe("no_provider_attempts");
    expect(gate.failed).toBe(true);
  });

  it("past de gate niet toe onder de minimumbatch en faalt nooit met resultaten", () => {
    const small = buildH2HQualityGate({ candidates: 10, filled: 0, attempts: [] });
    expect(small.applied).toBe(false);
    expect(small.failed).toBe(false);
    expect(small.outcome).toBe("not_applicable");

    const filled = buildH2HQualityGate({ candidates: 50, filled: 3, attempts: [blocked("http_error")] });
    expect(filled.outcome).toBe("filled");
    expect(filled.failed).toBe(false);
  });

  it("leest de minimumbatch uit de omgeving en valt terug op 20", () => {
    expect(buildH2HQualityGate({ minBatch: "40", candidates: 30, filled: 0 }).applied).toBe(false);
    expect(buildH2HQualityGate({ candidates: 20, filled: 0 }).minBatch).toBe(20);
  });
});
