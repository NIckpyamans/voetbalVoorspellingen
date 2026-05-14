const LEVEL_WEIGHT = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
};

const SENSITIVE_KEY = /(api[-_]?key|token|secret|authorization|cookie|password|bearer)/i;
const env = typeof process !== "undefined" ? process.env || {} : {};
const DEFAULT_LEVEL = env.FOOTYAI_LOG_LEVEL || (env.NODE_ENV === "production" ? "info" : "debug");

function shouldLog(level) {
  const current = LEVEL_WEIGHT[DEFAULT_LEVEL] || LEVEL_WEIGHT.info;
  return (LEVEL_WEIGHT[level] || LEVEL_WEIGHT.info) >= current;
}

function safeString(value, max = 700) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return "[max-depth]";
  if (value instanceof Error) return getErrorDetails(value);
  if (typeof value === "string") return safeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitize(item, depth + 1);
    }
    return output;
  }
  return safeString(value);
}

export function getErrorDetails(error) {
  return {
    name: error?.name || "Error",
    message: safeString(error?.message || error || "unknown error"),
    code: error?.code || undefined,
    status: error?.status || error?.statusCode || undefined,
    stack: env.NODE_ENV === "production" ? undefined : safeString(error?.stack || "", 1500),
  };
}

export function createLogger(scope = "app") {
  const emit = (level, event, details = {}) => {
    if (!shouldLog(level)) return;
    const payload = {
      ts: new Date().toISOString(),
      level,
      scope,
      event,
      ...sanitize(details),
    };
    const line = JSON.stringify(payload);
    if (level === "error") console.error(line);
    else if (level === "warning") console.warn(line);
    else console.log(line);
  };

  return {
    debug: (event, details) => emit("debug", event, details),
    info: (event, details) => emit("info", event, details),
    warning: (event, details) => emit("warning", event, details),
    error: (event, details) => emit("error", event, details),
    timeAsync: async (event, fn, details = {}) => {
      const start = Date.now();
      try {
        const result = await fn();
        emit("info", event, { ...details, durationMs: Date.now() - start, ok: true });
        return result;
      } catch (error) {
        emit("error", event, {
          ...details,
          durationMs: Date.now() - start,
          ok: false,
          error: getErrorDetails(error),
        });
        throw error;
      }
    },
  };
}
