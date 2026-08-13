export function buildRoiClvGate(metrics = {}, minimumSample = 100) {
  const minimum = Math.max(1, Number(minimumSample || 100));
  const prematchMatches = Math.max(0, Number(metrics.safe_prematch_matches || 0));
  const closingPairs = Math.max(0, Number(metrics.closing_pair_matches || 0));
  const roiEvaluations = Math.max(0, Number(metrics.roi_evaluation_matches || 0));
  const clvEvaluations = Math.max(0, Number(metrics.clv_evaluation_matches || 0));
  const roiReasons = [];
  const clvReasons = [];
  if (prematchMatches < minimum) roiReasons.push("insufficient_unique_prematch_matches");
  if (roiEvaluations < minimum) roiReasons.push("insufficient_unique_roi_evaluations");
  if (closingPairs < minimum) clvReasons.push("insufficient_timestamped_closing_pairs");
  if (clvEvaluations < minimum) clvReasons.push("insufficient_unique_clv_evaluations");
  return {
    minimum_sample: minimum,
    roi_ready: roiReasons.length === 0,
    clv_ready: clvReasons.length === 0,
    roi_gate_reasons: roiReasons,
    clv_gate_reasons: clvReasons,
    analysis_status: roiReasons.length === 0 && clvReasons.length === 0
      ? "ready"
      : "waiting_for_unique_timestamped_pairs",
  };
}
