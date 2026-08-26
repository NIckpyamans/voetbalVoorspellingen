const TRUSTED_PHASE_SOURCES = new Set([
  "cloudflare_r2",
  "database_prediction_reviews",
  "immutable_training_fallback",
  "r2_prediction_reviews",
]);

export function isValidPhaseProfile(profile) {
  return Boolean(
    profile &&
      Number.isFinite(Number(profile.matches)) &&
      Number(profile.matches) > 0 &&
      Number.isFinite(Number(profile.reliabilityScore)) &&
      Number(profile.reliabilityScore) >= 0 &&
      Number(profile.reliabilityScore) <= 1
  );
}

function isTrusted(profile) {
  return TRUSTED_PHASE_SOURCES.has(String(profile?.source || ""));
}

/**
 * Phase profiles are model inputs, not disposable live-score output. Missing
 * phases are always retained and lightweight refreshes cannot replace a
 * trusted profile with an ad-hoc review aggregation.
 */
export function mergePhaseReliability(existing, candidate, { lightweight = false } = {}) {
  const merged = {};
  const decisions = [];
  const existingProfiles = existing && typeof existing === "object" ? existing : {};
  const candidateProfiles = candidate && typeof candidate === "object" ? candidate : {};
  const phases = new Set([...Object.keys(existingProfiles), ...Object.keys(candidateProfiles)]);

  for (const phase of phases) {
    const current = existingProfiles[phase];
    const next = candidateProfiles[phase];
    if (!isValidPhaseProfile(next)) {
      if (isValidPhaseProfile(current)) merged[phase] = current;
      decisions.push({ phase, action: current ? "preserve_existing" : "skip_invalid_candidate" });
      continue;
    }
    if (!isValidPhaseProfile(current)) {
      merged[phase] = next;
      decisions.push({ phase, action: "add_candidate" });
      continue;
    }

    const protectsTrustedProfile = lightweight && isTrusted(current) && !isTrusted(next);
    const candidateHasLessEvidence = Number(next.matches) < Number(current.matches);
    if (protectsTrustedProfile || candidateHasLessEvidence) {
      merged[phase] = current;
      decisions.push({
        phase,
        action: "preserve_existing",
        reason: protectsTrustedProfile ? "lightweight_untrusted_replacement" : "candidate_has_less_evidence",
      });
    } else {
      merged[phase] = next;
      decisions.push({ phase, action: "replace_with_candidate" });
    }
  }

  return { profiles: merged, decisions };
}
