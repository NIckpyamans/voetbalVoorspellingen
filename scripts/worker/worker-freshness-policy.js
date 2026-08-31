function timestampMs(value) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildWorkerFreshnessState(meta, options = {}) {
  const nowMs = timestampMs(options.now ?? Date.now()) ?? Date.now();
  const dispatchAfterMinutes = Math.max(1, Number(options.dispatchAfterMinutes ?? 150));
  const lastRunMs = timestampMs(meta?.lastRun || meta?.generatedAt || meta?.updatedAt);
  const ageMinutes = lastRunMs == null ? Infinity : Math.max(0, (nowMs - lastRunMs) / 60_000);
  return {
    lastRun: lastRunMs == null ? null : new Date(lastRunMs).toISOString(),
    ageMinutes: Number.isFinite(ageMinutes) ? Number(ageMinutes.toFixed(1)) : null,
    dispatchAfterMinutes,
    refreshDue: lastRunMs == null || ageMinutes >= dispatchAfterMinutes,
    reason: lastRunMs == null
      ? "worker-last-run-unknown"
      : ageMinutes >= dispatchAfterMinutes
        ? "worker-data-nears-stale-limit"
        : "worker-data-fresh",
  };
}
