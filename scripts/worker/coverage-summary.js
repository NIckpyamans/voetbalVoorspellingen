export function summarizeLeagueCoverage(rows, options = {}) {
  const success = options.success || ((row) => Boolean(row?.confirmed || row?.status === "captured"));
  const partial = options.partial || (() => false);
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const league = String(row?.league || "unknown").trim() || "unknown";
    const group = groups.get(league) || { league, checked: 0, covered: 0, partial: 0, missing: 0 };
    group.checked += 1;
    if (success(row)) group.covered += 1;
    else if (partial(row)) group.partial += 1;
    else group.missing += 1;
    groups.set(league, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      coverage: group.checked ? Number((group.covered / group.checked).toFixed(3)) : 0,
    }))
    .sort((left, right) => left.coverage - right.coverage || right.checked - left.checked || left.league.localeCompare(right.league));
}
