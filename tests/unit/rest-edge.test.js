import { describe, expect, it } from "vitest";
import { buildRestEdge } from "../../scripts/worker/prediction.js";

describe("rest edge", () => {
  it("telt rustverschillen kleiner dan twee dagen niet mee als meetruis", () => {
    expect(buildRestEdge(4, 3)).toBe(0);
    expect(buildRestEdge(3, 4)).toBe(0);
    expect(buildRestEdge(4, 4)).toBe(0);
  });

  it("loopt op, is symmetrisch en topt af", () => {
    expect(buildRestEdge(6, 4)).toBe(1);
    expect(buildRestEdge(4, 6)).toBe(-1);
    expect(buildRestEdge(8, 4)).toBe(3);
  });

  it("dempt de edge bij congestie en bij een uitzonderlijk lange aanlopen", () => {
    // Congestie: het minst uitgeruste team speelde drie dagen eerder.
    expect(buildRestEdge(7, 3)).toBe(1.5);
    expect(buildRestEdge(7, 3)).toBeLessThan(buildRestEdge(7, 4));
    // Langer dan tien dagen zonder duel is ritmeverlies, geen fitheidsvoordeel.
    expect(buildRestEdge(12, 4)).toBe(1);
  });

  it("geeft geen edge zonder betrouwbare rustdata aan beide kanten", () => {
    expect(buildRestEdge(0, 5)).toBe(0);
    expect(buildRestEdge(null, 3)).toBe(0);
  });
});
