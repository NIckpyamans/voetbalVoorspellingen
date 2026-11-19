import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  isProviderCircuitOpen,
  loadProviderCircuits,
  saveProviderCircuits,
  shouldTripProviderCircuit,
  tripProviderCircuit,
} from "../../scripts/worker/provider-circuits.js";

const NOW = Date.parse("2026-11-19T10:00:00.000Z");

describe("providercircuits", () => {
  it("opent een circuit voor auth-/planfouten en sluit het na de TTL", () => {
    const circuits = tripProviderCircuit({}, "api-football", {
      reason: "provider_account_or_plan_blocked",
      category: "auth_or_plan",
      error: "Free plans do not have access to this date",
      now: NOW,
    });
    expect(isProviderCircuitOpen(circuits, "api-football", NOW + 1000)).toBe(true);
    expect(isProviderCircuitOpen(circuits, "api-football", NOW + 25 * 3600000)).toBe(false);
    expect(circuits["api-football"].tripCount).toBe(1);
    expect(circuits["api-football"].error).toContain("Free plans");
  });

  it("tript alleen op account-/planblokkades", () => {
    expect(shouldTripProviderCircuit("auth_or_plan")).toBe(true);
    expect(shouldTripProviderCircuit("quota_or_rate_limit")).toBe(false);
    expect(shouldTripProviderCircuit(undefined)).toBe(false);
  });

  it("leest een ontbrekend circuitbestand als leeg", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "provider-circuits-"));
    expect(loadProviderCircuits(root)).toEqual({});
  });

  it("bewaart en herlaadt het circuit", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "provider-circuits-"));
    const circuits = tripProviderCircuit({}, "api-football", { category: "auth_or_plan", now: NOW });
    saveProviderCircuits(root, circuits, { generatedAt: "2026-11-19T10:00:00.000Z" });
    const reloaded = loadProviderCircuits(root);
    expect(reloaded["api-football"].category).toBe("auth_or_plan");
    expect(isProviderCircuitOpen(reloaded, "api-football", NOW + 1000)).toBe(true);
  });
});
