import { createLogger, getErrorDetails } from "./logger.js";

const logger = createLogger("http");
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDelay(attempt, baseDelayMs, maxDelayMs) {
  const jitter = Math.floor(Math.random() * Math.max(40, baseDelayMs));
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1) + jitter);
}

export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const retries = Number.isFinite(Number(retryOptions.retries)) ? Number(retryOptions.retries) : 2;
  const timeoutMs = Number(retryOptions.timeoutMs || 10_000);
  const baseDelayMs = Number(retryOptions.baseDelayMs || 350);
  const maxDelayMs = Number(retryOptions.maxDelayMs || 4_000);
  const event = retryOptions.event || "fetch";
  const retryOnStatuses = new Set(retryOptions.retryOnStatuses || [...RETRYABLE_STATUS]);
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || controller.signal,
      });
      clearTimeout(timeout);

      const durationMs = Date.now() - started;
      if (!retryOnStatuses.has(response.status) || attempt === retries) {
        if (!response.ok) {
          logger.warning(`${event}.not_ok`, {
            status: response.status,
            attempt: attempt + 1,
            durationMs,
            url: String(url).replace(/\?.*$/, ""),
          });
        }
        return response;
      }

      logger.warning(`${event}.retry_status`, {
        status: response.status,
        attempt: attempt + 1,
        durationMs,
        url: String(url).replace(/\?.*$/, ""),
      });
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === retries) {
        logger.error(`${event}.failed`, {
          attempt: attempt + 1,
          url: String(url).replace(/\?.*$/, ""),
          error: getErrorDetails(error),
        });
        throw error;
      }

      logger.warning(`${event}.retry_error`, {
        attempt: attempt + 1,
        url: String(url).replace(/\?.*$/, ""),
        error: getErrorDetails(error),
      });
    }

    await sleep(buildDelay(attempt + 1, baseDelayMs, maxDelayMs));
  }

  throw lastError || new Error("fetchWithRetry failed");
}
