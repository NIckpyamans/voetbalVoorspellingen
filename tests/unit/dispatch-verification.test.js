import { describe, expect, it } from "vitest";
import { evaluateDispatchedRun, parseWorkflowList } from "../../scripts/verify-dispatched-workflows.js";

const dispatchedAt = "2026-10-30T07:29:00Z";
const createdAt = (offsetSeconds) => new Date(Date.parse(dispatchedAt) + offsetSeconds * 1000).toISOString();

describe("orchestrator dispatch verification", () => {
  it("leest de workflowlijst uit GitHub-output", () => {
    expect(parseWorkflowList("h2h-enrichment.yml  worker.yml\nh2h-enrichment.yml")).toEqual([
      "h2h-enrichment.yml",
      "worker.yml",
    ]);
  });

  it("accepteert een run die na de dispatch is gestart", () => {
    const result = evaluateDispatchedRun({
      workflow: "h2h-enrichment.yml",
      run: { databaseId: 1, status: "queued", conclusion: null, createdAt: createdAt(3) },
      dispatchedAt,
    });
    expect(result.ok).toBe(true);
  });

  it("faalt wanneer de child-run direct wordt geannuleerd voordat een job start", () => {
    const result = evaluateDispatchedRun({
      workflow: "h2h-enrichment.yml",
      run: { databaseId: 2, status: "completed", conclusion: "cancelled", createdAt: createdAt(4) },
      jobCount: 0,
      dispatchedAt,
      now: Date.parse(dispatchedAt) + 30000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/job startte/);
  });

  it("faalt wanneer de nieuwste run ouder is dan de dispatch", () => {
    const result = evaluateDispatchedRun({
      workflow: "worker.yml",
      run: { databaseId: 3, status: "completed", conclusion: "success", createdAt: createdAt(-600) },
      dispatchedAt,
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe("missing");
  });

  it("accepteert een afgeronde run met succes", () => {
    const result = evaluateDispatchedRun({
      workflow: "worker.yml",
      run: { databaseId: 4, status: "completed", conclusion: "success", createdAt: createdAt(5) },
      dispatchedAt,
    });
    expect(result.ok).toBe(true);
  });

  it("faalt op een echte mislukking met jobs", () => {
    const result = evaluateDispatchedRun({
      workflow: "worker.yml",
      run: { databaseId: 5, status: "completed", conclusion: "failure", createdAt: createdAt(5) },
      jobCount: 1,
      dispatchedAt,
      now: Date.parse(dispatchedAt) + 600000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/failure/);
  });
});
