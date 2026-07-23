function countFailures(values = {}) {
  return Object.entries(values).reduce((sum, [key, value]) => {
    return /quota|rate_limit|http_403|http_429/i.test(key) ? sum + Math.max(0, Number(value) || 0) : sum;
  }, 0);
}

export function buildProviderCooldown(report, options = {}) {
  const cooldownHours = Math.max(1, Number(options.cooldownHours) || 12);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const provider = report?.apiFootball || report?.provider || {};
  const checkedAt = Date.parse(provider.lastCheckedAt || report?.generatedAt || "");
  const ageHours = Number.isFinite(checkedAt) ? Math.max(0, (now.getTime() - checkedAt) / 3600000) : Infinity;
  const blockedRequests = countFailures(provider.errorCategories) + countFailures(provider.statusCounts);
  const lastStatusCode = Number(provider.lastStatusCode || 0);
  const blocked = blockedRequests > 0 || [403, 429].includes(lastStatusCode);
  const active = blocked && ageHours < cooldownHours;

  return {
    active,
    blocked,
    blockedRequests,
    lastStatusCode: lastStatusCode || null,
    ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
    cooldownHours,
    remainingHours: active ? Number(Math.max(0, cooldownHours - ageHours).toFixed(2)) : 0,
  };
}
