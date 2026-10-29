import { describe, expect, it } from "vitest";
import {
  classifyLineupCaptureWindow,
  classifyOddsCaptureRole,
  mergeLineupCaptureLedger,
  mergeOddsCaptureLedger,
  selectConfirmedLineupCapture,
  selectOddsCapture,
  summarizeOddsCapture,
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
    expect(second.revisionCount).toBe(1);
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

describe("capture coverage survives a second run (regression)", () => {
  // Reproduceert de controle van 8 oktober: 21 wedstrijden, waarvan er 4 al
  // opgeslagen odds hadden. Een eerste run toont die als "captured" (19%), een
  // tweede run markeert ze "already_captured" en mag de dekking niet laten zakken.
  const missing = Array.from({ length: 17 }, (_, index) => ({
    matchId: `missing-${index}`,
    league: "Netherlands - Eerste Divisie",
    home: `Home ${index}`,
    away: `Away ${index}`,
    status: "not_found",
    reason: "provider_not_found",
  }));
  const covered = Array.from({ length: 4 }, (_, index) => ({
    matchId: `covered-${index}`,
    league: "England - Championship",
    home: `Home ${index}`,
    away: `Away ${index}`,
    status: "captured",
  }));

  it("keeps the same coverage when covered matches are reported as already_captured", () => {
    const firstRun = summarizeOddsCapture([...covered, ...missing]);
    const secondRun = summarizeOddsCapture([
      ...covered.map((row) => ({ ...row, status: "already_captured" })),
      ...missing,
    ]);
    expect(firstRun.coverage).toBe(0.19);
    expect(secondRun.coverage).toBe(firstRun.coverage);
    expect(secondRun.covered).toBe(4);
    expect(secondRun.alreadyCaptured).toBe(4);
    expect(secondRun.captured).toBe(0);
  });

  it("reports the truly missing matches separately", () => {
    const summary = summarizeOddsCapture([
      ...covered.map((row) => ({ ...row, status: "already_captured" })),
      ...missing,
    ]);
    expect(summary.missing).toBe(17);
    expect(summary.missingMatches).toHaveLength(17);
    expect(summary.missingMatches.every((row) => row.status === "not_found")).toBe(true);
    expect(summary.missingMatches[0]).toMatchObject({ matchId: "missing-0", league: "Netherlands - Eerste Divisie" });
  });

  it("reports zero coverage only when nothing is covered at all", () => {
    const summary = summarizeOddsCapture(missing);
    expect(summary.coverage).toBe(0);
    expect(summary.covered).toBe(0);
    expect(summary.missing).toBe(17);
    expect(summarizeOddsCapture([])).toMatchObject({ checked: 0, coverage: 0, missing: 0 });
  });
});
