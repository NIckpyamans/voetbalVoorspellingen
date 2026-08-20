const DAYS = 14;
const TARGETS = {
  domestic: 0.8,
  uefa: 0.8,
  friendly: 0.6,
};

export function normalizeGoalApiName(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(fc|afc|cf|sc|club|fk|sv|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function segmentForLeague(league) {
  if (/friendl/i.test(String(league || ""))) return "friendly";
  if (/^Europe -/i.test(String(league || ""))) return "uefa";
  return "domestic";
}

export function evaluateGoalApiAcceptance(history, checkedAt = new Date().toISOString()) {
  const validRuns = (history || []).filter((run) => run.providerReachable && run.checked > 0);
  const first = validRuns[0]?.checkedAt;
  const elapsedDays = first ? Math.floor((Date.parse(checkedAt) - Date.parse(first)) / 86400000) + 1 : 0;
  const aggregate = {};
  for (const segment of Object.keys(TARGETS)) {
    const checked = validRuns.reduce((sum, run) => sum + Number(run.segments?.[segment]?.checked || 0), 0);
    const mapped = validRuns.reduce((sum, run) => sum + Number(run.segments?.[segment]?.mapped || 0), 0);
    aggregate[segment] = { checked, mapped, coverage: checked ? Number((mapped / checked).toFixed(3)) : 0, target: TARGETS[segment] };
  }
  const enoughTime = elapsedDays >= DAYS;
  const enoughEvidence = Object.values(aggregate).every((item) => item.checked >= 5);
  const targetsMet = Object.values(aggregate).every((item) => item.coverage >= item.target);
  return { accepted: enoughTime && enoughEvidence && targetsMet, enoughTime, enoughEvidence, targetsMet, elapsedDays, requiredDays: DAYS, aggregate };
}

export const goalApiAcceptanceTargets = Object.freeze({ ...TARGETS });
