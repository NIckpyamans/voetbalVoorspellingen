function positiveTimestamp(value) {
  const timestamp = Number(value || 0);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

export function selectFreshestWorkerSource({
  databaseLastRun,
  repositoryLastRun,
  repositorySource = "json-cache",
}) {
  const databaseTimestamp = positiveTimestamp(databaseLastRun);
  const repositoryTimestamp = positiveTimestamp(repositoryLastRun);
  const databaseCurrent = databaseTimestamp > 0 && databaseTimestamp >= repositoryTimestamp;

  return {
    lastRun: Math.max(databaseTimestamp, repositoryTimestamp),
    sourceOfTruth: databaseCurrent ? "neon" : repositorySource,
    databaseCurrent,
  };
}
