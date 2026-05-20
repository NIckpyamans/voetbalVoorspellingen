const DEFAULT_ALLOWED_ORIGINS = [
  "https://voorspellingenprive.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
];

function configuredOrigins() {
  const fromEnv = String(process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : null;

  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...fromEnv, vercelUrl, productionUrl].filter(Boolean) as string[]);
}

export function setCorsHeaders(req: any, res: any, options: { methods?: string } = {}) {
  const origin = String(req?.headers?.origin || "");
  const allowed = configuredOrigins();
  const allowOrigin = !origin || allowed.has(origin) ? origin || DEFAULT_ALLOWED_ORIGINS[0] : "";

  if (allowOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", options.methods || "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
