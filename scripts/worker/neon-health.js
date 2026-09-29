// Neon-gezondheidslogica: classificeert fouten en bouwt de statusovergangen
// zodat een watchdog automatisch herstel kan activeren wanneer Neon na een
// quota-overschrijding of storing weer beschikbaar is.

export function classifyNeonError(error) {
  const message = String(error?.message || error || "unknown_error");
  if (/HTTP status 402|data transfer quota|exceeded the quota|quota_exceeded/i.test(message)) return "quota_exceeded";
  if (/fetch failed|connecting to database|ECONNRESET|ETIMEDOUT|HOSTUNREACH|timeout/i.test(message)) {
    return "temporarily_unavailable";
  }
  return "connection_failed";
}

// Bouw de nieuwe watchdog-status uit de vorige status en de verse probe.
// recovered=true betekent: Neon was weg (quota/storing) en reageert weer.
// quotaRecovered=true betekent specifiek dat een quota-overschrijding voorbij
// is; pas dan worden zware onderhouds-workflows automatisch opnieuw gestart.
export function buildNeonHealthState(previous = null, probe = {}, now = Date.now()) {
  const state = probe.state || (probe.available ? "available" : probe.reason || "unknown");
  const previousState = previous?.state || null;
  const recovered = Boolean(probe.available && previousState && previousState !== "available");
  const quotaRecovered = recovered && previousState === "quota_exceeded";
  const consecutiveFailures = probe.available
    ? 0
    : Number(previous?.consecutiveFailures || 0) + 1;

  const history = Array.isArray(previous?.history) ? [...previous.history] : [];
  if (previousState && previousState !== state) {
    history.push({ from: previousState, to: state, at: new Date(now).toISOString() });
    while (history.length > 20) history.shift();
  }

  return {
    state,
    previousState,
    recovered,
    quotaRecovered,
    consecutiveFailures,
    available: Boolean(probe.available),
    databaseWritable: Boolean(probe.databaseWritable),
    reason: probe.reason || state,
    lastAvailableAt: probe.available ? new Date(now).toISOString() : previous?.lastAvailableAt || null,
    lastQuotaExceededAt: state === "quota_exceeded" ? new Date(now).toISOString() : previous?.lastQuotaExceededAt || null,
    lastCheckedAt: new Date(now).toISOString(),
    history,
  };
}
