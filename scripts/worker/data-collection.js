export const DATA_COLLECTION_MODULE = {
  name: "data-collection",
  owns: ["public API fetches", "source diagnostics", "rate limits", "fallback source ordering"],
};

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36";

export async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchText(url) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/plain,text/csv,text/*;q=0.9,*/*;q=0.8",
        "User-Agent": DEFAULT_USER_AGENT,
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export function createSafeFetch({ sofaBase, sofaFetchCircuit, sportsDbSquadFetchState, logger = console } = {}) {
  return async function safeFetch(url) {
    const isSofaRequest = String(url || "").startsWith(sofaBase || "");
    const isSportsDbSquadRequest = String(url || "").includes("thesportsdb.com/api/v1/json/3/searchplayers.php");
    if (isSofaRequest && sofaFetchCircuit?.blocked) {
      return null;
    }
    if (isSportsDbSquadRequest && Number(sportsDbSquadFetchState?.blockedUntil || 0) > Date.now()) {
      return null;
    }
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          Origin: "https://www.sofascore.com",
          Referer: "https://www.sofascore.com/",
          "User-Agent": DEFAULT_USER_AGENT,
        },
      }, 12000);
      if (!response.ok) {
        if (isSofaRequest && response.status === 403) {
          sofaFetchCircuit.failures += 1;
          sofaFetchCircuit.blocked = true;
          if (!sofaFetchCircuit.logged) {
            logger.error("[worker] Sofascore geeft 403; deze run gebruikt automatisch de gratis fallbackbronnen.");
            sofaFetchCircuit.logged = true;
          }
          return null;
        }
        if (isSportsDbSquadRequest && response.status === 429) {
          sportsDbSquadFetchState.blockedUntil = Date.now() + 60 * 60 * 1000;
          if (!sportsDbSquadFetchState.loggedRateLimit) {
            logger.warn("[worker] TheSportsDB spelerslijsten zijn tijdelijk rate-limited; worker gebruikt afgeleide teamsterkte.");
            sportsDbSquadFetchState.loggedRateLimit = true;
          }
          return null;
        }
        logger.error(`[worker] API error ${response.status} voor ${url}`);
        return null;
      }
      return await response.json();
    } catch (error) {
      logger.error(`[worker] Fetch mislukt voor ${url}: ${error.message}`);
      return null;
    }
  };
}

export async function safeFetchText(url) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "text/plain,text/csv,*/*",
        "User-Agent": DEFAULT_USER_AGENT,
      },
    }, 12000);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export async function fetchExternalJson(url, headers = {}) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json,text/javascript,*/*;q=0.8",
        "User-Agent": DEFAULT_USER_AGENT,
        ...headers,
      },
    }, 12000);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
