// Run-level circuit voor providers die met 403 weigeren (SofaScore,
// TheSportsDB). Zonder dit bleef de live-refresh dezelfde verboden endpoints
// herhalen tot de step-timeout van 8 minuten; daarna werden score-update,
// competitiecontrole en publicatie overgeslagen. Na de eerste 403 slaat de
// rest van de run die host over en gaan de fallbackbronnen aan het werk.

export const TRACKED_PROVIDER_HOSTS = [
  "api.sofascore.com",
  "www.sofascore.com",
  "api.sofascore.app",
  "www.thesportsdb.com",
  "thesportsdb.com",
];

function hostnameOf(input) {
  const value = typeof input === "string" ? input : input?.url;
  if (!value) return "";
  try {
    return new URL(String(value)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function matchesHost(host, tracked) {
  return host === tracked || host.endsWith(`.${tracked}`);
}

export function createProviderCircuit(options = {}) {
  const hosts = (options.hosts || TRACKED_PROVIDER_HOSTS).map((host) => String(host).toLowerCase());
  const statuses = new Set((options.statuses || [403]).map(Number));
  const blocked = new Map();
  const counts = new Map();

  return {
    hostnameOf,
    isTracked(url) {
      const host = hostnameOf(url);
      return Boolean(host) && hosts.some((tracked) => matchesHost(host, tracked));
    },
    isBlocked(url) {
      const host = hostnameOf(url);
      return Boolean(host) && blocked.has(host);
    },
    record(url, status) {
      const host = hostnameOf(url);
      if (!host || !statuses.has(Number(status))) return false;
      if (!hosts.some((tracked) => matchesHost(host, tracked))) return false;
      counts.set(host, (counts.get(host) || 0) + 1);
      if (!blocked.has(host)) {
        blocked.set(host, { status: Number(status), at: Date.now() });
        options.onBlock?.(host, Number(status));
      }
      return true;
    },
    blockedHosts() {
      return [...blocked.keys()];
    },
    stats() {
      return Object.fromEntries(counts.entries());
    },
  };
}

// Wikkelt fetch zodat:
// 1. een geblokkeerde host direct een 403-response krijgt (geen netwerkcall),
// 2. elke 403 op een gevolgde host de rest van de run blokkeert.
export function wrapFetchWithCircuit(fetchImpl, circuit) {
  if (typeof fetchImpl !== "function" || !circuit) return fetchImpl;
  return async function fetchWithProviderCircuit(input, init) {
    const url = typeof input === "string" ? input : input?.url;
    if (circuit.isBlocked(url)) {
      return new Response(JSON.stringify({
        error: "provider_blocked_after_403",
        url: String(url),
      }), { status: 403, headers: { "content-type": "application/json" } });
    }
    const response = await fetchImpl(input, init);
    if (response && Number(response.status) === 403) circuit.record(url, response.status);
    return response;
  };
}
