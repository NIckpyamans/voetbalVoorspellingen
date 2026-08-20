import { describe, expect, it } from "vitest";
import {
  fetchGoalApiLineup,
  goalApiFeatureEnabled,
  normalizeGoalApiH2H,
  normalizeGoalApiLineup,
  resetGoalApiBudgetForTests,
} from "../../scripts/providers/goal-api-provider.js";

const accepted = {
  accepted: true,
  history: [{ endpointAccess: {
    lineups: { valid: true, available: true },
    h2h: { valid: true, available: true },
    statistics: { valid: true, available: true },
    odds: { valid: false, available: false },
  } }],
};

describe("GOAL API feature-gated provider", () => {
  it("never enables odds and waits for accepted endpoint evidence", () => {
    expect(goalApiFeatureEnabled("lineups", { acceptance: accepted })).toBe(true);
    expect(goalApiFeatureEnabled("odds", { acceptance: accepted })).toBe(false);
    expect(goalApiFeatureEnabled("lineups", { acceptance: { ...accepted, accepted: false } })).toBe(false);
  });

  it("normalizes confirmed lineups", () => {
    const players = Array.from({ length: 11 }, (_, index) => ({ id: index, name: `Player ${index}`, position: index ? "MF" : "GK" }));
    const lineup = normalizeGoalApiLineup({ data: { home: { starters: players }, away: { starters: players } } });
    expect(lineup).toMatchObject({ confirmed: true, source: "GOAL API confirmed lineups" });
    expect(lineup.home.keeperName).toBe("Player 0");
  });

  it("normalizes completed direct meetings", () => {
    const result = normalizeGoalApiH2H({ data: { matches: [{ id: 1, date: "2026-01-01", homeTeam: { name: "A" }, awayTeam: { name: "B" }, score: { home: 2, away: 1 } }] } });
    expect(result[0]).toMatchObject({ home: "A", away: "B", homeScore: 2, awayScore: 1 });
  });

  it("maps a fixture before requesting a lineup", async () => {
    resetGoalApiBudgetForTests();
    const players = Array.from({ length: 11 }, (_, index) => ({ name: `P${index}`, position: index ? "MF" : "GK" }));
    const fetchImpl = async (url) => String(url).includes("fixtures/date")
      ? new Response(JSON.stringify({ data: [{ id: 42, homeTeam: { id: 1, name: "Leeds" }, awayTeam: { id: 2, name: "Derby" } }], pagination: { hasMore: false } }), { status: 200 })
      : new Response(JSON.stringify({ data: { home: { starters: players }, away: { starters: players } } }), { status: 200 });
    const result = await fetchGoalApiLineup(
      { kickoff: "2026-08-22T14:00:00Z", homeTeam: "Leeds", awayTeam: "Derby" },
      { apiKey: "test", fetchImpl, acceptance: accepted }
    );
    expect(result.status).toBe("ok");
    expect(result.lineup.confirmed).toBe(true);
  });
});
