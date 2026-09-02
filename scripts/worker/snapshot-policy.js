const MINUTE = 60 * 1000;

export const SNAPSHOT_WINDOWS = Object.freeze({
  t24: { minMinutes: 18 * 60, maxMinutes: 30 * 60, priority: 1 },
  t75: { minMinutes: 61, maxMinutes: 90, priority: 2 },
  t45: { minMinutes: 31, maxMinutes: 60, priority: 3 },
  t20: { minMinutes: 5, maxMinutes: 30, priority: 4 },
});

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

export function minutesBeforeKickoff(kickoff, generatedAt) {
  const kickoffMs = timestamp(kickoff);
  const generatedMs = timestamp(generatedAt);
  if (kickoffMs == null || generatedMs == null) return null;
  return Math.floor((kickoffMs - generatedMs) / MINUTE);
}

export function classifyPredictionSnapshotWindow(kickoff, generatedAt) {
  const minutes = minutesBeforeKickoff(kickoff, generatedAt);
  if (!Number.isFinite(minutes) || minutes < 0) return "outside";
  for (const [key, window] of Object.entries(SNAPSHOT_WINDOWS)) {
    if (minutes >= window.minMinutes && minutes <= window.maxMinutes) return key;
  }
  return "outside";
}

export function snapshotTrainingEligibility(snapshot = {}) {
  const generatedAt = snapshot.generatedAt || snapshot.cutoffAt || null;
  const cutoffAt = snapshot.cutoffAt || generatedAt;
  const generatedMs = timestamp(generatedAt);
  const cutoffMs = timestamp(cutoffAt);
  const kickoffMs = timestamp(snapshot.kickoff);
  const snapshotWindow = snapshot.snapshotWindow || classifyPredictionSnapshotWindow(snapshot.kickoff, generatedAt);
  const reasons = [];
  if (!snapshot.predictionId) reasons.push("prediction_id_missing");
  if (!snapshot.matchId) reasons.push("match_id_missing");
  if (generatedMs == null || cutoffMs == null || kickoffMs == null) reasons.push("timestamp_boundary_missing");
  if (generatedMs != null && cutoffMs != null && cutoffMs < generatedMs) reasons.push("cutoff_before_generation");
  if (cutoffMs != null && kickoffMs != null && cutoffMs >= kickoffMs) reasons.push("not_strictly_pre_kickoff");
  if (!SNAPSHOT_WINDOWS[snapshotWindow]) reasons.push("outside_required_snapshot_windows");
  if (!(snapshot.featureVector || snapshot.features || snapshot.inputSnapshot?.featureVector)) reasons.push("feature_vector_missing");
  if (!(snapshot.inputSnapshotHash || snapshot.immutableHash)) reasons.push("immutable_input_hash_missing");
  return {
    eligible: reasons.length === 0,
    snapshotWindow,
    minutesBeforeKickoff: minutesBeforeKickoff(snapshot.kickoff, generatedAt),
    reasons,
  };
}

export function selectPreferredTrainingSnapshot(snapshots = []) {
  return [...snapshots]
    .map((snapshot) => ({ snapshot, eligibility: snapshotTrainingEligibility(snapshot) }))
    .filter((item) => item.eligibility.eligible)
    .sort((left, right) => {
      const priority = SNAPSHOT_WINDOWS[right.eligibility.snapshotWindow].priority - SNAPSHOT_WINDOWS[left.eligibility.snapshotWindow].priority;
      if (priority !== 0) return priority;
      return Date.parse(right.snapshot.generatedAt || right.snapshot.cutoffAt || "") - Date.parse(left.snapshot.generatedAt || left.snapshot.cutoffAt || "");
    })[0]?.snapshot || null;
}

export function snapshotWindowCoverage(snapshots = []) {
  const windows = Object.fromEntries(Object.keys(SNAPSHOT_WINDOWS).map((key) => [key, false]));
  for (const snapshot of snapshots) {
    const key = snapshot.snapshotWindow || classifyPredictionSnapshotWindow(snapshot.kickoff, snapshot.generatedAt || snapshot.cutoffAt);
    if (key in windows) windows[key] = true;
  }
  return windows;
}
