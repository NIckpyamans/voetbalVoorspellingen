import { describe, expect, it } from "vitest";
import { classifyNeonError, buildNeonHealthState } from "../../scripts/worker/neon-health.js";

describe("neon health watchdog", () => {
  it("classificeert quota-, tijdelijke en verbindingsfouten", () => {
    expect(classifyNeonError(new Error("Server error (HTTP status 402): exceeded the quota"))).toBe("quota_exceeded");
    expect(classifyNeonError(new Error("Your account or project has exceeded the quota. Upgrade your plan"))).toBe("quota_exceeded");
    expect(classifyNeonError(new Error("fetch failed"))).toBe("temporarily_unavailable");
    expect(classifyNeonError(new Error("something else"))).toBe("connection_failed");
  });

  it("signaleert herstel na quota-overschrijding zodat onderhoud kan hervatten", () => {
    const previous = buildNeonHealthState(null, { available: false, reason: "quota_exceeded" });
    expect(previous.state).toBe("quota_exceeded");
    expect(previous.consecutiveFailures).toBe(1);

    const next = buildNeonHealthState(previous, { available: true, databaseWritable: true, reason: "available" });
    expect(next.recovered).toBe(true);
    expect(next.quotaRecovered).toBe(true);
    expect(next.consecutiveFailures).toBe(0);
    expect(next.previousState).toBe("quota_exceeded");
    expect(next.lastAvailableAt).toBeTruthy();
  });

  it("telt opeenvolgende storingen en reset ze bij herstel", () => {
    let state = buildNeonHealthState(null, { available: false, reason: "temporarily_unavailable" });
    state = buildNeonHealthState(state, { available: false, reason: "temporarily_unavailable" });
    expect(state.consecutiveFailures).toBe(2);
    state = buildNeonHealthState(state, { available: true, reason: "available" });
    expect(state.consecutiveFailures).toBe(0);
    expect(state.recovered).toBe(true);
    expect(state.quotaRecovered).toBe(false);
  });

  it("houdt een overgangsgeschiedenis bij", () => {
    const first = buildNeonHealthState(null, { available: true, reason: "available" });
    const second = buildNeonHealthState(first, { available: false, reason: "quota_exceeded" });
    expect(second.history.length).toBe(1);
    expect(second.history[0]).toMatchObject({ from: "available", to: "quota_exceeded" });
    expect(second.lastQuotaExceededAt).toBeTruthy();
  });
});
