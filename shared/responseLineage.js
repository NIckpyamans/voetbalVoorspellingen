/** @param {string | null | undefined} sourceBranch @param {number} matchCount */
export function inferResponseSource(sourceBranch, matchCount = 0) {
  if (!matchCount) return "no-matches-yet";
  if (sourceBranch === "postgres") return "postgres-database";
  if (String(sourceBranch || "").startsWith("r2-dashboard-cache")) return "cloudflare-r2-dashboard-cache";
  return "github-worker-v4-split";
}

/**
 * @param {{sourceBranch?: string | null, matchCount?: number, meta?: any, source?: string | null}} options
 */
export function buildResponseLineage({ sourceBranch, matchCount, meta = {}, source } = {}) {
  const sourceOfTruth = source || inferResponseSource(sourceBranch, matchCount);
  return {
    sourceOfTruth,
    sourceBranch: sourceBranch || "unresolved",
    matchCount: Number(matchCount || 0),
    workerVersion: meta?.workerVersion || "unknown",
    workerLastRun: meta?.lastRun || null,
    fixtureSources: meta?.sourceCoverage?.sourceBreakdown || {},
    fallbackActive: sourceBranch !== "postgres",
  };
}
