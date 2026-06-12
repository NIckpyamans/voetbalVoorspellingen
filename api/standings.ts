import { fetchStandingsData, fetchServerStore } from "./_dataSource.js";
import { createLogger, getErrorDetails } from "../shared/logger.js";
import { setCorsHeaders } from "../shared/cors.js";
import { databaseConfigured, getSql } from "../shared/database.js";
import { buildCupSheetsFromMatches } from "../shared/cupSheets.js";

const logger = createLogger("api.standings");

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
        csc.previous_standing_position,
        csc.previous_standing_points,
        csc.previous_standing_source,
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
      previousStandingPosition: row.previous_standing_position,
      previousStandingPoints: row.previous_standing_points,
      previousStandingSource: row.previous_standing_source,
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

async function readDatabaseCoverageByCompetition() {
  if (!databaseConfigured()) return null;
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql.query(
    `
      select
        coalesce(m.league, c.country_name || ' - ' || c.name, m.competition_id, 'Onbekend') as label,
        m.competition_id,
        c.name as competition_name,
        c.country_name,
        count(distinct m.match_id)::int as matches,
        count(distinct m.match_id) filter (where coalesce(m.weather_payload, '{}'::jsonb) <> '{}'::jsonb)::int as weather_matches,
        count(distinct ms.match_id)::int as xg_matches,
        count(distinct hos.match_id)::int as odds_history_matches,
        count(distinct m.match_id) filter (where exists (
          select 1
          from h2h_edges h
          where h.home_club_id = least(m.home_club_id, m.away_club_id)
            and h.away_club_id = greatest(m.home_club_id, m.away_club_id)
            and (h.competition_id = m.competition_id or h.competition_id is null)
        ))::int as h2h_matches,
        count(distinct m.match_id) filter (where exists (
          select 1
          from standings_snapshots ss
          where ss.competition_id = m.competition_id
            and ss.source = 'season-reset-zero'
        ))::int as season_reset_matches
      from matches m
      left join competitions c on c.competition_id = m.competition_id
      left join match_stats ms on ms.match_id = m.match_id
      left join historical_odds_snapshots hos on hos.match_id = m.match_id
      group by coalesce(m.league, c.country_name || ' - ' || c.name, m.competition_id, 'Onbekend'), m.competition_id, c.name, c.country_name
      order by matches desc
      limit 120
    `
  );
  const missingRows = await sql.query(
    `
      with base as (
        select
          m.match_id,
          m.competition_id,
          coalesce(m.league, c.country_name || ' - ' || c.name, m.competition_id, 'Onbekend') as label,
          m.date_key,
          m.home_team_name,
          m.away_team_name,
          coalesce(m.weather_payload, '{}'::jsonb) <> '{}'::jsonb as has_weather,
          ms.match_id is not null as has_xg,
          exists (select 1 from historical_odds_snapshots hos where hos.match_id = m.match_id) as has_odds,
          exists (
            select 1 from h2h_edges h
            where h.home_club_id = least(m.home_club_id, m.away_club_id)
              and h.away_club_id = greatest(m.home_club_id, m.away_club_id)
              and (h.competition_id = m.competition_id or h.competition_id is null)
          ) as has_h2h,
          exists (
            select 1 from standings_snapshots ss
            where ss.competition_id = m.competition_id and ss.source = 'season-reset-zero'
          ) as has_season_reset
        from matches m
        left join competitions c on c.competition_id = m.competition_id
        left join match_stats ms on ms.match_id = m.match_id
      ),
      missing as (
        select *, 'weather' as category from base where not has_weather
        union all select *, 'h2h' as category from base where not has_h2h
        union all select *, 'xg' as category from base where not has_xg
        union all select *, 'oddsHistory' as category from base where not has_odds
        union all select *, 'seasonReset' as category from base where not has_season_reset
      ),
      ranked as (
        select *, row_number() over (partition by label, category order by date_key desc nulls last, match_id) as rn
        from missing
      )
      select label, category, match_id, date_key, home_team_name, away_team_name
      from ranked
      where rn <= 10
      order by label, category, rn
    `
  );
  const missingByLabel: Record<string, Record<string, any[]>> = {};
  for (const row of missingRows) {
    if (!missingByLabel[row.label]) missingByLabel[row.label] = {};
    if (!missingByLabel[row.label][row.category]) missingByLabel[row.label][row.category] = [];
    missingByLabel[row.label][row.category].push({
      matchId: row.match_id,
      date: row.date_key,
      homeTeam: row.home_team_name,
      awayTeam: row.away_team_name,
    });
  }
  return rows.map((row: any) => {
    const matches = Math.max(Number(row.matches || 0), 1);
    return {
      label: row.label,
      competitionId: row.competition_id,
      competitionName: row.competition_name,
      countryName: row.country_name,
      matches: row.matches,
      weather: { count: row.weather_matches, pct: Math.round((Number(row.weather_matches || 0) / matches) * 100) },
      h2h: { count: row.h2h_matches, pct: Math.round((Number(row.h2h_matches || 0) / matches) * 100) },
      xg: { count: row.xg_matches, pct: Math.round((Number(row.xg_matches || 0) / matches) * 100) },
      oddsHistory: { count: row.odds_history_matches, pct: Math.round((Number(row.odds_history_matches || 0) / matches) * 100) },
      seasonReset: { count: row.season_reset_matches, pct: Math.round((Number(row.season_reset_matches || 0) / matches) * 100) },
      missing: missingByLabel[row.label] || {},
    };
  });
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
    const databaseCoverageByCompetition = await readDatabaseCoverageByCompetition().catch((error) => ({
      databaseConfigured: databaseConfigured(),
      error: error?.message || "database coverage unavailable",
    }));

    return res.status(200).json({
      ok: true,
      standings: store.standings || {},
      knockoutOverview: store.knockoutOverview || {},
      cupSheets,
      databaseSeasonOverview,
      databaseCoverageByCompetition,
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

