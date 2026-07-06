import { fetchWithRetry } from "../shared/http.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";
import { logoLookupNames } from "../shared/clubLogos.js";

const logger = createLogger("api.logo");

async function fetchTheSportsDbLogo(teamName: string) {
  for (const name of logoLookupNames(teamName)) {
    const url = `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(name)}`;
    try {
      const response = await fetchWithRetry(
        url,
        { headers: { Accept: "application/json", "User-Agent": "voetbalvoorspellingen-logo-resolver/1.0" } },
        { retries: 1, timeoutMs: 6_000, event: "logo.thesportsdb" }
      );
      if (!response.ok) continue;
      const payload = await response.json();
      const teams = Array.isArray(payload?.teams) ? payload.teams : [];
      const team = teams.find((item: any) => String(item?.strSport || "").toLowerCase().includes("soccer")) || teams[0];
      const badge = String(team?.strBadge || team?.strTeamBadge || team?.strLogo || "").trim();
      if (badge) return { url: badge, source: "thesportsdb", matchedName: name };
    } catch (error) {
      logger.warning("logo_thesportsdb_failed", { teamName, name, error: getErrorDetails(error) });
    }
  }
  return null;
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(req, res);
  const id = (req.query.id || req.query.teamId) as string;
  const name = String(req.query.name || req.query.team || "").trim();
  if ((!id || !/^\d+$/.test(id)) && !name) {
    return res.status(400).end();
  }

  const candidates = /^\d+$/.test(String(id || ""))
    ? [
        `https://api.sofascore.app/api/v1/team/${id}/image`,
        `https://api.sofascore.com/api/v1/team/${id}/image`,
      ]
    : [];
  const sportsDbLogo = name ? await fetchTheSportsDbLogo(name) : null;
  if (sportsDbLogo?.url) candidates.push(sportsDbLogo.url);

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
      if (sportsDbLogo?.url === url) res.setHeader("X-Logo-Source", sportsDbLogo.source);
      return res.status(200).send(Buffer.from(buffer));
    } catch (error) {
      logger.warning("logo_upstream_failed", { id, host: new URL(url).host, error: getErrorDetails(error) });
    }
  }

  logger.warning("logo_not_found", { id });
  return res.status(404).end();
}
