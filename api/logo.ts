import { fetchWithRetry } from "../shared/http.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";

const logger = createLogger("api.logo");

export default async function handler(req: any, res: any) {
  setCorsHeaders(req, res);
  const id = (req.query.id || req.query.teamId) as string;
  if (!id || !/^\d+$/.test(id)) {
    return res.status(400).end();
  }

  const candidates = [
    `https://api.sofascore.app/api/v1/team/${id}/image`,
    `https://api.sofascore.com/api/v1/team/${id}/image`,
  ];

  for (const url of candidates) {
    try {
      const upstream = await fetchWithRetry(
        url,
        {
          headers: {
            Accept: "image/png,image/webp,image/*",
            Origin: "https://www.sofascore.com",
            Referer: "https://www.sofascore.com/",
            "User-Agent": "Mozilla/5.0",
          },
        },
        { retries: 1, timeoutMs: 6_000, event: "logo.fetch", retryOnStatuses: [408, 429, 500, 502, 503, 504] }
      );

      if (!upstream.ok) {
        logger.warning("logo_upstream_not_ok", { id, status: upstream.status, host: new URL(url).host });
        continue;
      }

      const contentType = upstream.headers.get("content-type") || "image/png";
      const buffer = await upstream.arrayBuffer();

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      return res.status(200).send(Buffer.from(buffer));
    } catch (error) {
      logger.warning("logo_upstream_failed", { id, host: new URL(url).host, error: getErrorDetails(error) });
    }
  }

  logger.warning("logo_not_found", { id });
  return res.status(404).end();
}
