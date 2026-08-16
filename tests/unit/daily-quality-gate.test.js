import { describe, expect, it } from "vitest";
import { evaluateDailyQuality } from "../../scripts/worker/daily-quality-gate.js";

describe("daily quality gate", () => {
  it("blocks duplicate fixtures and finals without scores", () => {
    const match = { _dateKey: "2026-08-15", homeTeamName: "Ajax", awayTeamName: "Twente", status: "FT" };
    const report = evaluateDailyQuality({ matches: [match, { ...match, id: "duplicate" }], now: "2026-08-16T06:00:00Z" });
    expect(report.ok).toBe(false);
    expect(report.totals).toMatchObject({ duplicateFixtures: 1, incompleteFinals: 2 });
  });

  it("keeps external provider age and training growth as warnings", () => {
    const report = evaluateDailyQuality({
      matches: [{ _dateKey: "2026-08-17", homeTeamName: "Ajax", awayTeamName: "Twente", status: "NS" }],
      training: { rows: [] },
      now: "2026-08-16T06:00:00Z",
    });
    expect(report.ok).toBe(true);
    expect(report.status).toBe("watch");
    expect(report.warnings).toContain("provider_health_stale");
  });
});
