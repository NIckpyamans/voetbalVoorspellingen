export function materializeSnapshotBackedReviews(day, ledgerReviews) {
  const next = { ...(day || {}), reviews: { ...(day?.reviews || {}) } };
  const matchIds = new Set((day?.matches || []).map((match) => String(match?.id || "")).filter(Boolean));
  let linked = 0;
  let unchanged = 0;
  for (const matchId of matchIds) {
    const candidate = ledgerReviews?.[matchId];
    if (candidate?.evaluationSource !== "prediction_snapshot" || !candidate?.predictionId) continue;
    const current = next.reviews[matchId];
    if (
      current?.evaluationSource === "prediction_snapshot" &&
      current?.predictionId === candidate.predictionId &&
      current?.evaluatedAt === candidate.evaluatedAt
    ) {
      unchanged += 1;
      continue;
    }
    next.reviews[matchId] = candidate;
    linked += 1;
  }
  return { day: next, linked, unchanged };
}
