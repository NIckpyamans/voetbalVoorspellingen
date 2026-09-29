import { describe, expect, it } from "vitest";
import {
  COUNTABLE_ODDS_ROLES,
  isCountableOddsRow,
  isCountableOddsRole,
  deriveOddsRole,
  isClosingOnlyProxyRow,
  planOddsRoleRepair,
} from "../../scripts/worker/odds-role-integrity.js";

const KICKOFF = "2026-09-28T18:00:00.000Z";

describe("odds-rol-integriteit", () => {
  it("telt alleen opening/prematch/closing-rollen met timestamp", () => {
    expect(COUNTABLE_ODDS_ROLES).toEqual(["opening", "prematch", "closing"]);
    expect(isCountableOddsRole("closing")).toBe(true);
    expect(isCountableOddsRole("closing_proxy")).toBe(false);
    expect(isCountableOddsRow({ oddsRole: "prematch", capturedAt: "2026-09-28T12:00:00Z" })).toBe(true);
    expect(isCountableOddsRow({ odds_role: "prematch", captured_at: "2026-09-28T12:00:00Z" })).toBe(true);
    expect(isCountableOddsRow({ oddsRole: "closing_proxy", capturedAt: "2026-09-28T12:00:00Z" })).toBe(false);
    expect(isCountableOddsRow({ oddsRole: "closing", capturedAt: null })).toBe(false);
    expect(isCountableOddsRow({ oddsRole: "in_play", capturedAt: "2026-09-28T12:00:00Z" })).toBe(false);
  });

  it("leidt rollen af uit captured_at versus kickoff", () => {
    expect(deriveOddsRole("2026-09-28T12:00:00Z", KICKOFF)).toBe("prematch");
    expect(deriveOddsRole("2026-09-28T19:00:00Z", KICKOFF)).toBe("in_play");
    expect(deriveOddsRole(null, KICKOFF)).toBe("unknown");
  });

  it("herkent gedupliceerde closing-proxy-rijen", () => {
    expect(isClosingOnlyProxyRow({ home: 2.1, draw: 3.2, away: 3.4, closing_home: 2.1, closing_draw: 3.2, closing_away: 3.4 })).toBe(true);
    expect(isClosingOnlyProxyRow({ home: 2.1, draw: 3.2, away: 3.4, closing_home: 1.9, closing_draw: 3.3, closing_away: 3.8 })).toBe(false);
    expect(isClosingOnlyProxyRow({ home: null, draw: null, away: null, closing_home: 1.9, closing_draw: 3.3, closing_away: 3.8 })).toBe(false);
  });

  it("herstelt closing-rol en closing-timestamp voor football-data-imports", () => {
    const updates = planOddsRoleRepair({
      provider: "Football-Data.co.uk",
      oddsRole: "closing_proxy",
      capturedAt: "2026-09-28T17:00:00.000Z",
      closingCapturedAt: null,
      kickoffAt: KICKOFF,
      home: 2.1, draw: 3.2, away: 3.4,
      closing_home: 2.1, closing_draw: 3.2, closing_away: 3.4,
      available_before_kickoff: true,
    });
    expect(updates.odds_role).toBe("closing");
    expect(updates.closing_captured_at).toBe(KICKOFF);
    // Closing-proxy: de prematch-kant is geen eigen capture, dus geen onecht paar.
    expect(updates.available_before_kickoff).toBe(false);
  });

  it("stelt geen wijzigingen voor op gezonde rijen", () => {
    expect(planOddsRoleRepair({
      oddsRole: "prematch",
      capturedAt: "2026-09-28T12:00:00.000Z",
      closingCapturedAt: KICKOFF,
      kickoffAt: KICKOFF,
      home: 2.1, draw: 3.2, away: 3.4,
      closing_home: 1.9, closing_draw: 3.3, closing_away: 3.8,
      available_before_kickoff: true,
      minutes_before_kickoff: 360,
    })).toBeNull();
  });

  it("vult ontbrekende rollen via afleiding en herstelt minuten", () => {
    const updates = planOddsRoleRepair({
      oddsRole: null,
      capturedAt: "2026-09-28T12:00:00.000Z",
      closingCapturedAt: null,
      kickoffAt: KICKOFF,
      home: 2.1, draw: 3.2, away: 3.4,
    });
    expect(updates.odds_role).toBe("prematch");
    expect(updates.available_before_kickoff).toBe(true);
    expect(updates.minutes_before_kickoff).toBe(360);
  });
});
