type Details = Record<string, unknown>;

function sanitize(details: Details = {}) {
  const output: Details = {};
  for (const [key, value] of Object.entries(details)) {
    output[key] = value instanceof Error ? { name: value.name, message: value.message } : value;
  }
  return output;
}

export function logClientWarning(event: string, details: Details = {}) {
  console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warning", scope: "client", event, ...sanitize(details) }));
}

export function logClientError(event: string, details: Details = {}) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", scope: "client", event, ...sanitize(details) }));
}
