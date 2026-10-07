export const AUDIT_FRESHNESS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function parseAuditTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string" && /^\d{10,13}$/.test(value.trim())) {
    const numeric = Number(value);
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function assessAuditFreshness(report, { now = Date.now(), maxAgeMs = AUDIT_FRESHNESS_MAX_AGE_MS } = {}) {
  const generatedAt = parseAuditTimestamp(report?.generatedAt);
  const ageMs = Number.isFinite(generatedAt) ? Math.max(0, now - generatedAt) : null;
  return {
    generatedAt: Number.isFinite(generatedAt) ? new Date(generatedAt).toISOString() : null,
    ageMs,
    maxAgeMs,
    fresh: ageMs != null && ageMs <= maxAgeMs,
    status: ageMs == null ? "unknown" : ageMs <= maxAgeMs ? "fresh" : "stale",
  };
}

export function summarizeUniqueFixtureEvaluations(snapshots = [], evaluations = []) {
  const eligibleByFixture = new Map();
  const fixtureByPrediction = new Map();
  for (const snapshot of snapshots) {
    const predictionId = String(snapshot?.predictionId || "");
    const matchId = String(snapshot?.matchId || "");
    const fixtureId = matchId || String(snapshot?.canonicalFixtureId || snapshot?.canonical_fixture_id || "");
    if (!fixtureId || !predictionId) continue;
    if (!eligibleByFixture.has(fixtureId)) eligibleByFixture.set(fixtureId, new Set());
    eligibleByFixture.get(fixtureId).add(predictionId);
    fixtureByPrediction.set(predictionId, fixtureId);
  }
  const evaluatedPredictionIds = new Set(evaluations.map((item) => String(item?.predictionId || "")).filter(Boolean));
  const evaluatedFixtureIds = new Set([...evaluatedPredictionIds].map((predictionId) => fixtureByPrediction.get(predictionId)).filter(Boolean));
  const evaluatedFixtures = evaluatedFixtureIds.size;
  const eligibleFixtures = eligibleByFixture.size;
  const eligibleSnapshots = [...eligibleByFixture.values()].reduce((sum, ids) => sum + ids.size, 0);
  return {
    eligibleSnapshots,
    eligibleFixtures,
    evaluatedSnapshots: [...eligibleByFixture.values()].reduce((sum, ids) => sum + [...ids].filter((id) => evaluatedPredictionIds.has(id)).length, 0),
    evaluatedFixtures,
    coverage: eligibleFixtures ? Number((evaluatedFixtures / eligibleFixtures).toFixed(4)) : 0,
    repeatedSnapshotRows: Math.max(0, eligibleSnapshots - eligibleFixtures),
    evaluatedFixturesMissing: Math.max(0, eligibleFixtures - evaluatedFixtures),
  };
}
