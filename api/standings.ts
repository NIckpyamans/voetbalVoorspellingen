import { fetchStandingsData, fetchServerStore } from "./_dataSource.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";
import { databaseConfigured, getSql } from "../shared/database.js";

const logger = createLogger("api.standings");

function buildCupSheetsFromMatches(store: any) {
  const sheets: Record<string, any> = {};
  const allMatches = Object.values(store.matches || {}).flat() as any[];

  for (const match of allMatches) {
    const isCupLike =
      match.aggregate?.active ||
      String(match.context?.summary || "").includes("knock-out") ||
      String(match.league || "").includes("Champions League") ||
      String(match.league || "").includes("Europa League") ||
      String(match.league || "").includes("Conference League") ||
      String(match.league || "").includes("Beker");

    if (!isCupLike) continue;

    const league = match.league || "Bekertoernooi";
    const round = String(match.roundLabel || "Knock-out");
    if (!sheets[league]) sheets[league] = { league, rounds: {} };
    if (!sheets[league].rounds[round]) sheets[league].rounds[round] = [];

    sheets[league].rounds[round].push({
      league,
      roundLabel: match.roundLabel || null,
      stakes: match.context?.stakes || match.context?.summary || null,
      matchId: match.id,
      kickoff: match.kickoff || null,
      homeTeamName: match.homeTeamName,
      awayTeamName: match.awayTeamName,
      aggregate: match.aggregate || null,
      score: match.score || null,
      status: match.status || "NS",
    });
  }

  return sheets;
}

async function readDatabaseSeasonOverview() {
  if (!databaseConfigured()) return null;
  const sql = getSql();
  if (!sql) return null;

  const zeroStandings = await sql.query(
    `
      select
        ss.standings_snapshot_id,
        ss.competition_id,
        ss.season_id,
        ss.standings,
        ss.captured_at,
        c.name as competition_name,
        c.country_name,
        c.level,
        s.year_label,
        s.status as season_status
      from standings_snapshots ss
      left join competitions c on c.competition_id = ss.competition_id
      left join seasons s on s.season_id = ss.season_id
      where ss.source = 'season-reset-zero'
      order by c.country_name nulls last, c.level nulls last, c.name nulls last, s.year_label desc
    `
  );
  const seasonClubs = await sql.query(
    `
      select
        csc.season_id,
        csc.competition_id,
        csc.club_id,
        csc.club_name,
        csc.entry_reason,
        csc.status,
        csc.previous_level,
        csc.current_level,
        c.name as competition_name,
        c.country_name,
        c.level,
        s.year_label
      from competition_season_clubs csc
      left join competitions c on c.competition_id = csc.competition_id
      left join seasons s on s.season_id = csc.season_id
      order by c.country_name nulls last, c.level nulls last, c.name nulls last, csc.club_name
    `
  );

  const transitionsByCompetition: Record<string, any> = {};
  for (const row of seasonClubs) {
    const key = `${row.competition_id}:${row.season_id}`;
    if (!transitionsByCompetition[key]) {
      transitionsByCompetition[key] = {
        key,
        competitionId: row.competition_id,
        competitionName: row.competition_name,
        countryName: row.country_name,
        level: row.level,
        seasonId: row.season_id,
        yearLabel: row.year_label,
        teams: [],
        promoted: [],
        relegated: [],
        retained: [],
        newOrPromoted: [],
      };
    }
    const item = {
      clubId: row.club_id,
      clubName: row.club_name,
      entryReason: row.entry_reason || "retained",
      previousLevel: row.previous_level,
      currentLevel: row.current_level,
      status: row.status,
    };
    transitionsByCompetition[key].teams.push(item);
    if (item.entryReason === "promoted") transitionsByCompetition[key].promoted.push(item);
    else if (item.entryReason === "relegated") transitionsByCompetition[key].relegated.push(item);
    else if (item.entryReason === "new_or_promoted") transitionsByCompetition[key].newOrPromoted.push(item);
    else transitionsByCompetition[key].retained.push(item);
  }

  return {
    databaseConfigured: true,
    zeroStandings: zeroStandings.map((row: any) => ({
      snapshotId: row.standings_snapshot_id,
      competitionId: row.competition_id,
      competitionName: row.competition_name,
      countryName: row.country_name,
      level: row.level,
      seasonId: row.season_id,
      yearLabel: row.year_label,
      seasonStatus: row.season_status,
      capturedAt: row.captured_at,
      rows: Array.isArray(row.standings) ? row.standings : [],
    })),
    transitions: Object.values(transitionsByCompetition),
  };
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  setCorsHeaders(req, res);
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    let store: any;
    let branch = "split-data";

    try {
      const response = await fetchStandingsData();
      store = response.data || {};
      branch = response.branch || branch;
    } catch {
      const full = await fetchServerStore();
      store = full.store || {};
      branch = full.branch;
    }

    const cupSheets =
      Object.keys(store.cupSheets || {}).length > 0
        ? store.cupSheets
        : buildCupSheetsFromMatches(store);
    const databaseSeasonOverview = await readDatabaseSeasonOverview().catch((error) => ({
      databaseConfigured: databaseConfigured(),
      error: error?.message || "database season overview unavailable",
    }));

    return res.status(200).json({
      ok: true,
      standings: store.standings || {},
      knockoutOverview: store.knockoutOverview || {},
      cupSheets,
      databaseSeasonOverview,
      lastRun: store.lastRun || null,
      workerVersion: store.workerVersion || "unknown",
      reviewCount: Object.keys(store.postMatchReviews || {}).length,
      teamLearningCount: Object.keys(store.teamLearning || {}).length,
      sourceBranch: branch,
      durationMs: Date.now() - started,
    });
  } catch (err: any) {
    logger.error("standings_failed", { durationMs: Date.now() - started, error: getErrorDetails(err) });
    return res.status(503).json({
      ok: false,
      standings: {},
      knockoutOverview: {},
      cupSheets: {},
      error: err?.message || "Unknown error",
      durationMs: Date.now() - started,
    });
  }
}

