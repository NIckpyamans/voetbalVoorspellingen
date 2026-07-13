function defaultNormalizeTeam(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function selectUniqueTeamTopPicks(candidates, options = {}) {
  const limit = Math.max(1, Number(options.limit || 5));
  const normalizeTeam = options.normalizeTeam || defaultNormalizeTeam;
  const selected = [];
  const usedTeams = new Set();

  for (const candidate of candidates || []) {
    const homeKey = normalizeTeam(candidate?.homeTeam);
    const awayKey = normalizeTeam(candidate?.awayTeam);
    const overlaps = [homeKey, awayKey].filter(Boolean).some((key) => usedTeams.has(key));
    if (overlaps) continue;

    selected.push(candidate);
    if (homeKey) usedTeams.add(homeKey);
    if (awayKey) usedTeams.add(awayKey);
    if (selected.length >= limit) break;
  }

  return selected;
}
