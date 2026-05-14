export interface FetchRetryOptions {
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  event?: string;
  retryOnStatuses?: number[];
}

export function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retryOptions?: FetchRetryOptions
): Promise<Response>;
