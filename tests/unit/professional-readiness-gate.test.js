import { describe, expect, it } from "vitest";
import { buildProfessionalReadinessGate } from "../../scripts/worker/professional-readiness-gate.js";

describe("professional readiness gate", () => {
  it("blocks missing competition ownership but keeps coverage gaps as warnings", () => {
    const blocked = buildProfessionalReadinessGate({
      activeCompetitions: ["League A"],
      catalog: { competitions: [{ league: "League A", expectedTeams: 2, teams: ["A", "B"] }] },
      agents: { agents: [] },
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.structuralBlockers[0]).toContain("competition_agent_missing");

    const watch = buildProfessionalReadinessGate({
      activeCompetitions: ["League A"],
      catalog: { competitions: [{ league: "League A", expectedTeams: 2, teams: ["A", "B"] }] },
      agents: { agents: [{ league: "League A", key: "league-a-agent" }] },
    });
    expect(watch.ok).toBe(true);
    expect(watch.status).toBe("watch");
    expect(watch.competitions[0].gaps.length).toBeGreaterThan(0);
  });
});
