import { describe, expect, it } from "vitest";
import { buildRoiClvGate } from "../../scripts/worker/roi-clv-gate.js";

describe("professional ROI and CLV gate", () => {
  it("blocks publication when unique timestamped pairs are missing", () => {
    expect(buildRoiClvGate({
      safe_prematch_matches: 120,
      roi_evaluation_matches: 120,
      closing_pair_matches: 8,
      clv_evaluation_matches: 8,
    }, 100)).toMatchObject({
      roi_ready: true,
      clv_ready: false,
      analysis_status: "waiting_for_unique_timestamped_pairs",
      clv_gate_reasons: ["insufficient_timestamped_closing_pairs", "insufficient_unique_clv_evaluations"],
    });
  });

  it("only releases both metrics after the unique-match threshold", () => {
    expect(buildRoiClvGate({
      safe_prematch_matches: 100,
      roi_evaluation_matches: 100,
      closing_pair_matches: 100,
      clv_evaluation_matches: 100,
    }, 100)).toMatchObject({ roi_ready: true, clv_ready: true, analysis_status: "ready" });
  });
});
