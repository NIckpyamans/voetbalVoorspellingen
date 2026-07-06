import { fetchServerStore } from "./_dataSource.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";
import { isGeneratedLogoUrl, logoLookupNames, normalizeClubName } from "../shared/clubLogos.js";

const logger = createLogger("api.logo-health");

function recordTeam(map: Map<string, any>, name: string, logo: string, league: string) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return;
  const key = normalizeClubName(cleanName) || cleanName.toLowerCase();
  const current = map.get(key) || {
    key,
    name: cleanName,
    leagues: new Set<string>(),
    seen: 0,
    realLogo: false,
    generatedLogo: false,
    missingLogo: false,
    examples: [],
    aliasCandidates: logoLookupNames(cleanName).slice(0, 6),
  };
  current.seen += 1;
  if (league) current.leagues.add(league);
  if (!logo) current.missingLogo = true;
  else if (isGeneratedLogoUrl(logo)) current.generatedLogo = true;
  else current.realLogo = true;
  if (current.examples.length < 3) current.examples.push({ name: cleanName, logo: logo || null, league: league || null });
  map.set(key, current);
}

function serialize(row: any) {
  return {
    ...row,
    leagues: [...row.leagues],
  };
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  setCorsHeaders(req, res);
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=120");

  try {
    const { store, branch } = await fetchServerStore();
    const teams = new Map<string, any>();
    const days = Object.values(store.matches || {}) as any[][];
    for (const matches of days) {
      for (const match of Array.isArray(matches) ? matches : []) {
        recordTeam(teams, match.homeTeamName || match.homeTeam, match.homeLogo || match.homeTeamLogo || "", match.league || "");
        recordTeam(teams, match.awayTeamName || match.awayTeam, match.awayLogo || match.awayTeamLogo || "", match.league || "");
      }
    }

    const rows = [...teams.values()].map(serialize).sort((a, b) => b.seen - a.seen || a.name.localeCompare(b.name));
    const missing = rows.filter((row) => row.missingLogo && !row.realLogo);
    const generated = rows.filter((row) => row.generatedLogo && !row.realLogo);
    const conflicts = rows.filter((row) => row.realLogo && (row.generatedLogo || row.missingLogo));

    return res.status(200).json({
      ok: true,
      summary: {
        teams: rows.length,
        withRealLogo: rows.filter((row) => row.realLogo).length,
        generatedFallback: generated.length,
        missing: missing.length,
        conflicts: conflicts.length,
      },
      missing: missing.slice(0, 60),
      generatedFallback: generated.slice(0, 60),
      conflicts: conflicts.slice(0, 60),
      sourceBranch: branch,
      workerVersion: store.workerVersion || "unknown",
      durationMs: Date.now() - started,
    });
  } catch (err: any) {
    logger.error("logo_health_failed", { durationMs: Date.now() - started, error: getErrorDetails(err) });
    return res.status(503).json({
      ok: false,
      error: err?.message || "Unknown error",
      durationMs: Date.now() - started,
    });
  }
}
