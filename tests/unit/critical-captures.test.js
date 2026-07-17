import { describe, expect, it } from "vitest";
import {
  classifyLineupCaptureWindow,
  classifyOddsCaptureRole,
  mergeLineupCaptureLedger,
  mergeOddsCaptureLedger,
  selectConfirmedLineupCapture,
  selectOddsCapture,
} from "../../scripts/worker/critical-captures.js";

describe("critical capture windows", () => {
  it.each([[75, "t75"], [45, "t45"], [20, "t20"], [120, "outside"]])(
    "classifies lineup T-%s as %s",
    (minutes, expected) => expect(classifyLineupCaptureWindow(minutes)).toBe(expected)
  );

  it.each([[1440, "opening"], [120, "prematch"], [20, "closing"], [-1, "invalid"]])(
    "classifies odds at %s minutes as %s",
    (minutes, expected) => expect(classifyOddsCaptureRole(minutes)).toBe(expected)
  );
});

describe("immutable lineup ledger", () => {
  const match = { match_id: "m1", kickoff_at: "2026-07-20T20:00:00.000Z" };
  const confirmed = { confirmed: true, home: { starters: 11 }, away: { starters: 11 } };

  it("preserves the first confirmed timestamp while retaining later captures", () => {
    const first = mergeLineupCaptureLedger(null, { match, provider: "provider-a", lineup: confirmed, capturedAt: "2026-07-20T18:45:00.000Z" });
    const second = mergeLineupCaptureLedger(first, { match, provider: "provider-b", lineup: confirmed, capturedAt: "2026-07-20T19:40:00.000Z" });
    expect(second.firstConfirmedAt).toBe("2026-07-20T18:45:00.000Z");
    expect(second.attempts).toHaveLength(2);
    expect(selectConfirmedLineupCapture(second, match.kickoff_at)?.provider).toBe("provider-b");
  });
});

describe("immutable odds ledger", () => {
  const match = { matchId: "m1", kickoff: "2026-07-20T20:00:00.000Z" };
  const odds = { provider: "test", bookmaker: "book", market: "1X2", home: 2, draw: 3.2, away: 3.8 };

  it("keeps distinct opening, prematch and closing captures", () => {
    let ledger = mergeOddsCaptureLedger(null, match, odds, "2026-07-19T20:00:00.000Z");
    ledger = mergeOddsCaptureLedger(ledger, match, { ...odds, home: 1.9 }, "2026-07-20T18:00:00.000Z");
    ledger = mergeOddsCaptureLedger(ledger, match, { ...odds, home: 1.8 }, "2026-07-20T19:40:00.000Z");
    expect(ledger.opening?.roleAtCapture).toBe("opening");
    expect(ledger.prematch?.roleAtCapture).toBe("prematch");
    expect(ledger.closing?.roleAtCapture).toBe("closing");
    const selected = selectOddsCapture(ledger, match.kickoff);
    expect(selected?.oddsAtPrediction?.home).toBe(1.9);
    expect(selected?.oddsAtPrediction?.closingHome).toBe(1.8);
  });

  it("rejects malformed and post-kickoff timestamps", () => {
    let ledger = mergeOddsCaptureLedger(null, match, odds, "not-a-date");
    ledger = mergeOddsCaptureLedger(ledger, match, odds, "2026-07-20T20:01:00.000Z");
    expect(ledger.snapshots).toHaveLength(0);
    expect(selectOddsCapture({ prematch: { ...odds, capturedAt: "not-a-date" } }, match.kickoff)).toBeNull();
  });
});
