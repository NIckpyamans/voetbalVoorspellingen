function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function buildQuotaBudget(provider, health = {}, options = {}) {
  const dailyLimit = Math.max(0, finite(options.dailyLimit ?? health?.quota?.limit, 0));
  const remaining = Math.max(0, finite(health?.quota?.remaining ?? health?.requests?.remaining, dailyLimit));
  const reserve = Math.max(0, Math.min(remaining, finite(options.reserve, Math.ceil(dailyLimit * 0.15))));
  const perRun = Math.max(0, finite(options.perRun, 30));
  const unavailable = health?.configured === false || health?.valid === false || /suspend|blocked|invalid/i.test(String(health?.status || health?.errorCode || ""));
  const spendable = unavailable ? 0 : Math.max(0, Math.min(perRun, remaining - reserve));
  return {
    provider,
    configured: health?.configured !== false,
    available: !unavailable && spendable > 0,
    dailyLimit,
    remaining,
    reserve,
    spendable,
    policy: spendable > 0 ? "targeted_only" : unavailable ? "provider_unavailable" : "reserve_protected",
  };
}

export function buildCentralQuotaPlan(providerHealth = {}) {
  return {
    generatedAt: new Date().toISOString(),
    providers: {
      goalApi: buildQuotaBudget("goal-api", providerHealth.goalApi || {}, { dailyLimit: 1000, reserve: 100, perRun: 30 }),
      apiFootball: buildQuotaBudget("api-football", providerHealth.apiFootball || {}, { dailyLimit: providerHealth.apiFootball?.requests?.limit_day || 100, reserve: 20, perRun: 10 }),
      oddsApi: buildQuotaBudget("the-odds-api", providerHealth.oddsApi || {}, { dailyLimit: providerHealth.oddsApi?.quota?.remaining || 0, reserve: 5, perRun: 8 }),
      apiFootballCom: buildQuotaBudget("apifootball-com", providerHealth.apiFootballCom || {}, { dailyLimit: 180, reserve: 30, perRun: 20 }),
    },
  };
}
