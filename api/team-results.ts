import { fetchRepoJson } from "./_dataSource.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";
import { buildTeamResults } from "../shared/teamResults.js";

const logger = createLogger("api.team-results");

export default async function handler(req: any, res: any) {
  const started = Date.now();
  setCorsHeaders(req, res);
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");

  const team = String(req.query?.team || "").trim();
  const league = String(req.query?.league || "").trim();
  const rawLimit = String(req.query?.limit ?? "5").trim().toLowerCase();
  // "all" geeft de volledige historie van de club terug voor het clubdossier;
  // zonder waarde blijft het de laatste 5 voor de standen-popup.
  const limit =
    rawLimit === "all" || rawLimit === "alles"
      ? "all"
      : Math.min(Math.max(Math.trunc(Number(rawLimit)) || 5, 1), 500);

  if (!team) {
    return res.status(400).json({
      ok: false,
      error: "Geef een clubnaam mee via ?team=",
      team: null,
      league: league || null,
      matches: [],
      summary: null,
      durationMs: Date.now() - started,
    });
  }

  try {
    const source = await fetchRepoJson("data/history-summary.json");
    const reviews = source.data?.postMatchReviews || {};
    const result = buildTeamResults(reviews, { teamName: team, league, limit });
    return res.status(200).json({
      ok: true,
      ...result,
      sourceBranch: source.branch,
      durationMs: Date.now() - started,
    });
  } catch (err: any) {
    logger.error("team_results_failed", { durationMs: Date.now() - started, error: getErrorDetails(err) });
    return res.status(503).json({
      ok: false,
      error: err?.message || "Onbekende fout",
      team,
      league: league || null,
      matches: [],
      summary: null,
      durationMs: Date.now() - started,
    });
  }
}
