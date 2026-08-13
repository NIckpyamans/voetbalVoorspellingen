export function interpretApiFootballStatus(responseOk, payload) {
  const details = payload?.response || {};
  const errors = payload?.errors && typeof payload.errors === "object" ? payload.errors : {};
  const errorMessages = Object.values(errors).map(String).filter(Boolean);
  const current = Number(details?.requests?.current || 0);
  const limit = Number(details?.requests?.limit_day || 0);
  const plan = details?.subscription?.plan || null;
  const valid = Boolean(responseOk && errorMessages.length === 0 && plan && limit > 0);
  return {
    valid,
    plan,
    subscriptionEndsAt: details?.subscription?.end || null,
    requests: {
      current,
      limitPerDay: limit,
      remaining: limit > 0 ? Math.max(0, limit - current) : null,
      reserve: limit > 0 ? Math.max(10, Math.ceil(limit * 0.1)) : null,
    },
    errorCode: valid ? null : errorMessages.join("; ").slice(0, 180) || "account_or_plan_not_active",
  };
}
