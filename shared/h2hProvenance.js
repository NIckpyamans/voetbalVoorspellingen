export const H2H_PROVENANCE_FIELDS = [
  "h2hStatus",
  "h2hSource",
  "h2hAsOf",
  "h2hAvailability",
  "h2hPlayed",
  "h2hCompetitionPlayed",
];

const H2H_AVAILABILITY_STATUSES = new Set([
  "available",
  "provider_unreachable",
  "provider_acceptance_blocked",
  "team_mapping_missing",
  "no_direct_history",
  "not_checked",
]);

function flatAvailabilityToStatus(value) {
  const availability = String(value || "").trim().toLowerCase();
  if (availability === "beschikbaar") return "available";
  if (availability === "nog niet gecontroleerd") return "not_checked";
  return availability || undefined;
}

export function h2hProvenanceRank(profile) {
  if (!profile || typeof profile !== "object") return -Infinity;
  const played = Number(profile.played || profile.results?.length || 0);
  const explicitAvailability = H2H_AVAILABILITY_STATUSES.has(String(profile.availabilityStatus || ""));
  const status = String(profile.status || "");
  const legacyStub = !status || /^(h2h-agent-empty|contract-fallback|empty|none|no-data)$/i.test(status);
  const asOfMs = Date.parse(profile.asOf || profile.sourceTimestamp || "") || 0;
  const recency = asOfMs > 0 ? asOfMs / 86_400_000 : 0;
  return played * 1e12 + Number(explicitAvailability) * 1e9 - Number(legacyStub) * 1e8 + recency;
}

function deriveH2HProvenanceFields(profile) {
  const played = Number(profile?.played || profile?.results?.length || 0);
  return {
    h2hStatus: profile?.status || null,
    h2hSource: profile?.source || profile?.provider || null,
    h2hAsOf: profile?.asOf || profile?.sourceTimestamp || null,
    h2hPlayed: played,
    h2hCompetitionPlayed: Number(profile?.sameCompetitionPlayed || 0),
    h2hAvailability: played > 0 ? "beschikbaar" : profile?.availabilityStatus || "nog niet gecontroleerd",
  };
}

function hasH2HProvenance(match) {
  return Boolean(match?.h2h && typeof match.h2h === "object") ||
    H2H_PROVENANCE_FIELDS.some((field) => match?.[field] !== undefined && match?.[field] !== null && match?.[field] !== "");
}

function flatH2HProfile(match) {
  return {
    status: match?.h2hStatus || undefined,
    source: match?.h2hSource || undefined,
    asOf: match?.h2hAsOf || undefined,
    ...(match?.h2hPlayed != null ? { played: Number(match.h2hPlayed), results: [] } : {}),
    ...(match?.h2hCompetitionPlayed != null ? { sameCompetitionPlayed: Number(match.h2hCompetitionPlayed) } : {}),
    ...(flatAvailabilityToStatus(match?.h2hAvailability)
      ? { availabilityStatus: flatAvailabilityToStatus(match.h2hAvailability) }
      : {}),
  };
}

export function normalizeMatchH2H(match) {
  if (!hasH2HProvenance(match)) return match;

  const nested = match?.h2h && typeof match.h2h === "object" ? match.h2h : null;
  const flat = flatH2HProfile(match);
  let profile = nested ? { ...nested } : { ...flat };

  // Static/DB records may pair a stale nested stub with a newer flat verdict.
  // Compare provenance, but never discard the nested historical result rows.
  if (nested && h2hProvenanceRank(flat) > h2hProvenanceRank(nested)) {
    const nestedPlayed = Number(nested.played || nested.results?.length || 0);
    const flatPlayed = Number(flat.played || flat.results?.length || 0);
    const flatAvailabilityWins = H2H_AVAILABILITY_STATUSES.has(String(flat.availabilityStatus || ""));
    const nestedIsLegacyStub = !nested.status || /^(h2h-agent-empty|contract-fallback|empty|none|no-data)$/i.test(String(nested.status));
    profile = {
      ...nested,
      status: flat.status || (nestedIsLegacyStub && flatAvailabilityWins ? flat.availabilityStatus : nested.status),
      source: flat.source || nested.source,
      asOf: flat.asOf || nested.asOf,
      sourceTimestamp: flat.asOf || nested.sourceTimestamp,
      availabilityStatus: flat.availabilityStatus || nested.availabilityStatus,
      played: Math.max(nestedPlayed, flatPlayed),
      sameCompetitionPlayed: Math.max(Number(nested.sameCompetitionPlayed || 0), Number(flat.sameCompetitionPlayed || 0)),
      results: Array.isArray(nested.results) ? nested.results : [],
    };
  }

  const profilePlayed = Number(profile?.played || profile?.results?.length || 0);
  const normalizedAvailability = profilePlayed > 0
    ? "available"
    : profile?.availabilityStatus || flat.availabilityStatus || (profile?.status ? flatAvailabilityToStatus(profile.status) : undefined);
  if (normalizedAvailability && profile.availabilityStatus !== normalizedAvailability) {
    profile = { ...profile, availabilityStatus: normalizedAvailability };
  }

  const fields = deriveH2HProvenanceFields(profile);
  const normalized = { ...match, h2h: profile };
  for (const field of H2H_PROVENANCE_FIELDS) {
    const value = fields[field] ?? match?.[field];
    if (value !== undefined && value !== null && value !== "") normalized[field] = value;
    else delete normalized[field];
  }
  return normalized;
}

export function mergeMatchH2HProvenance(preferredMatch, fallbackMatch) {
  const preferred = normalizeMatchH2H(preferredMatch);
  const fallback = normalizeMatchH2H(fallbackMatch);
  const preferredProfile = preferred?.h2h;
  const fallbackProfile = fallback?.h2h;
  const winner = h2hProvenanceRank(fallbackProfile) > h2hProvenanceRank(preferredProfile) ? fallback : preferred;
  const loser = winner === preferred ? fallback : preferred;
  const winnerProfile = winner?.h2h;
  if (!winnerProfile && !hasH2HProvenance(winner)) return { ...fallback, ...preferred };

  const merged = normalizeMatchH2H({
    ...fallback,
    ...preferred,
    h2h: winnerProfile || preferredProfile || fallbackProfile,
    ...Object.fromEntries(H2H_PROVENANCE_FIELDS.map((field) => [field, winner?.[field] ?? loser?.[field]])),
  });
  return merged;
}

export function synchronizeMatchPredictionH2H(match, prediction) {
  if (!prediction) return prediction;
  const canonicalMatch = normalizeMatchH2H(match);
  if (!hasH2HProvenance(canonicalMatch)) return prediction;

  const synchronized = { ...prediction, h2h: canonicalMatch.h2h };
  for (const field of H2H_PROVENANCE_FIELDS) {
    const value = canonicalMatch[field];
    if (value !== undefined && value !== null && value !== "") synchronized[field] = value;
    else delete synchronized[field];
  }
  return synchronized;
}

export function findH2HProvenanceMismatches(match, prediction) {
  const canonicalMatch = normalizeMatchH2H(match);
  if (!hasH2HProvenance(canonicalMatch) || !prediction) return [];

  const normalizedPrediction = normalizeMatchH2H(prediction);
  const flatMismatches = H2H_PROVENANCE_FIELDS.filter((field) => {
    const matchValue = canonicalMatch[field] ?? null;
    const predictionValue = normalizedPrediction?.[field] ?? null;
    if (field === "h2hPlayed" || field === "h2hCompetitionPlayed") {
      return Number(matchValue || 0) !== Number(predictionValue || 0);
    }
    return matchValue !== predictionValue;
  });
  const profileFields = ["status", "source", "asOf", "availabilityStatus", "played", "sameCompetitionPlayed"];
  const profileMismatches = profileFields
    .filter((field) => {
      const matchValue = canonicalMatch.h2h?.[field] ?? null;
      const predictionValue = normalizedPrediction?.h2h?.[field] ?? null;
      if (field === "played" || field === "sameCompetitionPlayed") {
        return Number(matchValue || 0) !== Number(predictionValue || 0);
      }
      return matchValue !== predictionValue;
    })
    .map((field) => `h2h.${field}`);
  return [...flatMismatches, ...profileMismatches];
}

export function h2hHasProvenance(match) {
  return hasH2HProvenance(match);
}

