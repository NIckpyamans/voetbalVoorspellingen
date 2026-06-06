import crypto from "crypto";

const hits = new Map<string, number[]>();

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function enforceWriteSecurity(req: any, res: any, options: { scope: string; limit?: number; requireToken?: boolean }) {
  const origin = String(req.headers?.origin || "");
  const allowed = new Set(String(process.env.CORS_ALLOWED_ORIGINS || "https://voetbalvoorspellingen-clean.vercel.app")
    .split(",").map((value) => value.trim()).filter(Boolean));
  if (origin && !allowed.has(origin)) {
    res.status(403).json({ ok: false, error: "origin_not_allowed" });
    return false;
  }
  if (options.requireToken) {
    const expected = String(process.env.WRITE_API_TOKEN || "");
    const provided = String(req.headers?.["x-write-token"] || "");
    if (!expected || !provided || !safeEqual(expected, provided)) {
      res.status(401).json({ ok: false, error: "write_token_required" });
      return false;
    }
  }
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const key = `${options.scope}:${forwarded || req.socket?.remoteAddress || "unknown"}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= (options.limit || 10)) {
    res.status(429).json({ ok: false, error: "write_rate_limited" });
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
