export async function boundedFormFetch(task, { timeoutMs, requestTimeoutMs, fetchImpl = fetch }) {
  const controller = new AbortController();
  const requests = [];
  let partial = null;
  let timer;
  const scopedFetch = async (url, options = {}) => {
    controller.signal.throwIfAborted();
    const provider = new URL(url).hostname;
    const record = { provider, status: "pending" };
    requests.push(record);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(requestTimeoutMs)]);
    try {
      const response = await fetchImpl(url, { ...options, signal });
      // Consume the body inside the request deadline, not after headers arrive.
      const body = await response.text();
      record.status = response.ok ? "ok" : `http_${response.status}`;
      return { ok: response.ok, status: response.status, json: async () => JSON.parse(body) };
    } catch (error) {
      record.status = signal.aborted ? "timeout" : "network_error";
      throw error;
    }
  };
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => task(scopedFetch, (value) => { partial = value; })),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ ...partial, timedOut: true });
        }, Math.max(1, timeoutMs));
      }),
    ]);
    return { ...result, requests };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
