export function cacheTimestampMs(entry) {
  const value = entry?.providerCheckedAt || entry?.updatedAt;
  const timestamp = typeof value === "number" ? value : Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function shouldRefreshTeamFormCache({
  entry,
  now,
  targetMatches,
  successTtlMs,
  partialTtlMs,
  unavailableTtlMs,
  hasFotmobTarget = false,
}) {
  const recentCount = Number(entry?.data?.recentMatches?.length || 0);
  const source = String(entry?.data?.source || "");
  if (hasFotmobTarget && recentCount < targetMatches && !source.includes("fotmob-team-fixtures")) return true;
  const ttl = entry?.data
    ? recentCount >= targetMatches ? successTtlMs : partialTtlMs
    : unavailableTtlMs;
  const checkedAtMs = cacheTimestampMs(entry);
  return checkedAtMs === null || now - checkedAtMs >= ttl;
}
