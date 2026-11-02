function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// De quota-audit bewaart de providerheaders zoals ze binnenkomen
// (x-requests-remaining, x-ratelimit-limit, ...). Zonder normalisatie las het
// budget alleen camelCase-velden, viel remaining terug op 0 en kon er nooit
// buiten het closing-venster worden vastgelegd.
const QUOTA_FIELDS = {
  limit: ["limit", "x-requests-limit", "x-ratelimit-limit", "x-ratelimit-requests-limit"],
  remaining: ["remaining", "x-requests-remaining", "x-ratelimit-remaining", "x-ratelimit-requests-remaining"],
  used: ["used", "x-requests-used", "x-ratelimit-used", "x-ratelimit-requests-used"],
};

function firstFinite(source, keys) {
  for (const key of keys) {
    const value = finite(source?.[key], null);
    if (value != null) return value;
  }
  return null;
}

export function readQuotaCounters(health = {}) {
  const sources = [health?.quota, health?.requests, health?.quotaHeaders].filter(
    (source) => source && typeof source === "object"
  );
  const counters = {};
  for (const [name, keys] of Object.entries(QUOTA_FIELDS)) {
    counters[name] = null;
    for (const source of sources) {
      counters[name] = firstFinite(source, keys);
      if (counters[name] != null) break;
    }
  }
  // requests.limit_day/current zijn de API-Football-velden.
  if (counters.limit == null) counters.limit = finite(health?.requests?.limit_day, null);
  if (counters.used == null) counters.used = finite(health?.requests?.current, null);
  // Zonder expliciete limiet is de beschikbare ruimte used + remaining.
  if (counters.limit == null && counters.used != null && counters.remaining != null) {
    counters.limit = counters.used + counters.remaining;
  }
  return counters;
}

export function buildQuotaBudget(provider, health = {}, options = {}) {
  const counters = readQuotaCounters(health);
  const dailyLimit = Math.max(0, finite(options.dailyLimit ?? counters.limit, 0));
  const remaining = Math.max(0, finite(counters.remaining, dailyLimit));
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
      // De Odds API publiceert geen losse limiet; used + remaining geeft de
      // ruimte van het abonnement en remaining komt uit de responseheaders.
      oddsApi: buildQuotaBudget("the-odds-api", providerHealth.oddsApi || {}, { reserve: 5, perRun: 8 }),
      apiFootballCom: buildQuotaBudget("apifootball-com", providerHealth.apiFootballCom || {}, { dailyLimit: 180, reserve: 30, perRun: 20 }),
    },
  };
}
