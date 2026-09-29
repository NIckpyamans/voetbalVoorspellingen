import { describe, expect, it } from "vitest";
import {
  captureWindowFor,
  captureWindowKey,
  prioritizeCaptureCandidates,
  summarizeCaptureWindows,
  applyCaptureBudget,
} from "../../scripts/worker/capture-window-policy.js";

const NOW = Date.parse("2026-09-28T12:00:00Z");

function match(id, minutesBeforeKickoff) {
  return { id, kickoff: new Date(NOW + minutesBeforeKickoff * 60000).toISOString() };
}

describe("capture window policy", () => {
  it("wijst vensters toe rond T-75, T-45 en T-20", () => {
    expect(captureWindowKey(20)).toBe("t20");
    expect(captureWindowKey(45)).toBe("t45");
    expect(captureWindowKey(75)).toBe("t75");
    expect(captureWindowKey(200)).toBe("prematch");
    expect(captureWindowKey(600)).toBe("opening");
    expect(captureWindowFor(0)).toBeNull();
    expect(captureWindowFor(NaN)).toBeNull();
  });

  it("sorteert op urgentie: closing-venster eerst, dan T-45, T-75 en opening", () => {
    const prioritized = prioritizeCaptureCandidates(
      [match("opening", 600), match("far", 200), match("t75", 75), match("t45", 45), match("t20", 20)],
      NOW
    );
    expect(prioritized.map((entry) => entry.id)).toEqual(["t20", "t45", "t75", "far", "opening"]);
    expect(prioritized[0]).toMatchObject({ captureWindow: "t20", minutesBeforeKickoff: 20 });
  });

  it("samenvatting per venster", () => {
    const summary = summarizeCaptureWindows([match("a", 20), match("b", 20), match("c", 45), match("d", 600)], NOW);
    expect(summary).toMatchObject({ t20: 2, t45: 1, opening: 1 });
  });

  it("houdt closing-captures altijd toe maar respecteert verder het budget", () => {
    const candidates = prioritizeCaptureCandidates(
      [match("t20", 20), match("t20b", 25), match("far", 200), match("far2", 300)],
      NOW
    );
    const { selected, skippedByBudget, spendable } = applyCaptureBudget(candidates, {
      providers: { theOddsApi: { spendable: 1, policy: "targeted_only" }, sportmonks: { spendable: 0, policy: "reserve_protected" } },
    }, NOW);
    expect(spendable).toBe(1);
    expect(selected.map((entry) => entry.id)).toEqual(["t20", "t20b", "far"]);
    expect(skippedByBudget.map((entry) => entry.id)).toEqual(["far2"]);
  });

  it("blokkeert alles behalve closing-captures bij een uitgeput budget", () => {
    const candidates = prioritizeCaptureCandidates([match("t20", 20), match("far", 200)], NOW);
    const { selected } = applyCaptureBudget(candidates, { providers: {} }, NOW);
    expect(selected.map((entry) => entry.id)).toEqual(["t20"]);
  });
});
