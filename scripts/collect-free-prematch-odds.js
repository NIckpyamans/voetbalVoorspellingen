#!/usr/bin/env node

import crypto from "crypto";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { fetchOddsAtPrediction } from "./odds-provider.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const leagues = ["E0", "E1", "N1", "N2", "D1", "SP1", "SP2", "I1", "F1", "B1", "P1"];
const digest = (value) => crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 22);
const normalize = (value) => String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
const now = new Date();
const todayKey = now.toISOString().slice(0, 10);
const fetchTimeoutMs = Number(process.env.ODDS_FETCH_TIMEOUT_MS || 8000);
const oddsApiMatchLimit = Math.max(0, Number(process.env.ODDS_API_MATCH_LIMIT || 80));
const oddsApiDaysAhead = Math.max(1, Number(process.env.ODDS_API_DAYS_AHEAD || 14));
const oddsApiClosingLimit = Math.max(0, Number(process.env.ODDS_API_CLOSING_LIMIT || 160));
const oddsApiClosingLookaheadMinutes = Math.max(15, Number(process.env.ODDS_API_CLOSING_LOOKAHEAD_MINUTES || 180));
const start = now.getUTCMonth() + 1 >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
const folders = [`${String(start).slice(2)}${String(start + 1).slice(2)}`, `${String(start + 1).slice(2)}${String(start + 2).slice(2)}`];
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "text/csv,text/plain,*/*", "User-Agent": "FootyPredict odds collector" },
    });
  } finally {
    clearTimeout(timeout);
  }
}
function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = lines.shift()?.split(",") || [];
  return lines.map((line) => {
    const cells = line.match(/(?:^|,)(?:"([^"]*(?:""[^"]*)*)"|([^,]*))/g)?.map((cell) => cell.replace(/^,/, "").replace(/^"|"$/g, "").replace(/""/g, '"')) || [];
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
}
function parseDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return `${year}-${match[2]}-${match[1]}`;
}
let captured = 0;
let closingUpdated = 0;
let futureRows = 0;
let oddsApiCaptured = 0;
let oddsApiClosingUpdated = 0;
let oddsApiCandidates = 0;
let oddsApiClosingCandidates = 0;
let oddsApiHistoricalClosingUpdated = 0;
let oddsApiPredictionClosingUpdated = 0;
const oddsApiStatusCounts = {};
const oddsApiClosingStatusCounts = {};
const errors = [];
for (const folder of folders) for (const code of leagues) {
  const url = `https://www.football-data.co.uk/mmz4281/${folder}/${code}.csv`;
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) continue;
    const fetchedAt = new Date().toISOString();
    for (const row of parseCsv(await response.text())) {
      const dateKey = parseDate(row.Date);
      if (!dateKey || !row.HomeTeam || !row.AwayTeam) continue;
      if (dateKey < todayKey) continue;
      const [match] = await sql.query(
        `select match_id,kickoff_at from matches where date_key=$1 and identity_status='resolved'
         and regexp_replace(lower(home_team_name),'[^a-z0-9]','','g')=$2
         and regexp_replace(lower(away_team_name),'[^a-z0-9]','','g')=$3 limit 1`,
        [dateKey, normalize(row.HomeTeam), normalize(row.AwayTeam)]
      );
      if (!match?.kickoff_at || Date.parse(fetchedAt) >= Date.parse(match.kickoff_at)) continue;
      const minutesBeforeKickoff = Math.floor((Date.parse(match.kickoff_at) - Date.parse(fetchedAt)) / 60000);
      futureRows += 1;
      for (const [bookmaker, home, draw, away] of [
        ["Bet365", row.B365H, row.B365D, row.B365A], ["MarketAvg", row.AvgH, row.AvgD, row.AvgA], ["MarketMax", row.MaxH, row.MaxD, row.MaxA],
      ]) {
        if (![home, draw, away].every((value) => Number(value) > 1)) continue;
        await sql.query(
          `insert into historical_odds_snapshots (
            historical_odds_snapshot_id,match_id,provider,bookmaker,market,home,draw,away,captured_at,
            odds_role,available_before_kickoff,source_record_id
          ) values ($1,$2,'Football-Data.co.uk-live-capture',$3,'1X2',$4,$5,$6,$7,'prematch',true,null)
          on conflict (historical_odds_snapshot_id) do nothing`,
          [`prematch_${digest(`${match.match_id}|${bookmaker}|${fetchedAt.slice(0, 13)}`)}`, match.match_id, bookmaker, Number(home), Number(draw), Number(away), fetchedAt]
        );
        captured += 1;
        if (minutesBeforeKickoff > 0 && minutesBeforeKickoff <= 120) {
          const updated = await sql.query(
            `update historical_odds_snapshots set closing_home=$3,closing_draw=$4,closing_away=$5,
              closing_captured_at=$6
             where historical_odds_snapshot_id=(
               select historical_odds_snapshot_id from historical_odds_snapshots
               where match_id=$1 and bookmaker=$2 and odds_role='prematch' and captured_at<$6
               order by captured_at asc limit 1
             ) returning historical_odds_snapshot_id`,
            [match.match_id, bookmaker, Number(home), Number(draw), Number(away), fetchedAt]
          );
          closingUpdated += updated.length;
        }
      }
    }
  } catch (error) {
    errors.push({ url, error: error.message });
  }
}

async function captureOddsApiPrematch() {
  if (!oddsApiMatchLimit) return;
  const rows = await sql.query(
    `select match_id, league, home_team_name, away_team_name, kickoff_at
     from matches m
     where kickoff_at > now()
       and kickoff_at <= now() + ($1::text || ' days')::interval
       and home_team_name is not null
       and away_team_name is not null
       and not exists (
         select 1 from historical_odds_snapshots hos
         where hos.match_id = m.match_id
           and hos.provider = 'the-odds-api'
           and hos.odds_role = 'prematch'
           and hos.available_before_kickoff = true
           and hos.captured_at > now() - interval '12 hours'
       )
     order by kickoff_at asc
     limit $2`,
    [String(oddsApiDaysAhead), oddsApiMatchLimit]
  );
  oddsApiCandidates = rows.length;
  const generatedAt = new Date().toISOString();
  for (const row of rows) {
    try {
      const result = await fetchOddsAtPrediction(
        {
          matchId: row.match_id,
          league: row.league,
          homeTeam: row.home_team_name,
          awayTeam: row.away_team_name,
          kickoff: row.kickoff_at,
        },
        { generatedAt, cutoffAt: generatedAt }
      );
      oddsApiStatusCounts[result?.status || "unknown"] = (oddsApiStatusCounts[result?.status || "unknown"] || 0) + 1;
      const odds = result?.oddsAtPrediction;
      if (!odds || ![odds.home, odds.draw, odds.away].every((value) => Number(value) > 1)) continue;
      const capturedAt = odds.capturedAt || generatedAt;
      if (Date.parse(capturedAt) >= Date.parse(row.kickoff_at)) continue;
      const minutesBeforeKickoff = Math.floor((Date.parse(row.kickoff_at) - Date.parse(capturedAt)) / 60000);
      const bookmaker = odds.bookmaker || result.provider || "the-odds-api";
      const snapshotId = `prematch_${digest(`${row.match_id}|the-odds-api|${bookmaker}|${capturedAt.slice(0, 13)}`)}`;
      await sql.query(
        `insert into historical_odds_snapshots (
          historical_odds_snapshot_id,match_id,provider,bookmaker,market,home,draw,away,captured_at,
          odds_role,available_before_kickoff,minutes_before_kickoff,source_record_id
        ) values ($1,$2,'the-odds-api',$3,$4,$5,$6,$7,$8,'prematch',true,$9,null)
        on conflict (historical_odds_snapshot_id) do update set
          home=excluded.home, draw=excluded.draw, away=excluded.away,
          captured_at=excluded.captured_at,
          available_before_kickoff=excluded.available_before_kickoff,
          minutes_before_kickoff=excluded.minutes_before_kickoff`,
        [
          snapshotId,
          row.match_id,
          bookmaker,
          odds.market || "h2h",
          Number(odds.home),
          Number(odds.draw),
          Number(odds.away),
          capturedAt,
          minutesBeforeKickoff,
        ]
      );
      oddsApiCaptured += 1;
      if (minutesBeforeKickoff > 0 && minutesBeforeKickoff <= 120) {
        const updated = await sql.query(
          `update historical_odds_snapshots
           set closing_home=$3, closing_draw=$4, closing_away=$5, closing_captured_at=$6
           where historical_odds_snapshot_id=(
             select historical_odds_snapshot_id from historical_odds_snapshots
             where match_id=$1 and bookmaker=$2 and odds_role='prematch' and captured_at<$6
             order by captured_at asc limit 1
           )
           returning historical_odds_snapshot_id`,
          [row.match_id, bookmaker, Number(odds.home), Number(odds.draw), Number(odds.away), capturedAt]
        );
        oddsApiClosingUpdated += updated.length;
      }
    } catch (error) {
      errors.push({ provider: "the-odds-api", matchId: row.match_id, error: error.message });
    }
  }
}

await captureOddsApiPrematch();

async function updateOddsApiClosingOdds() {
  if (!oddsApiClosingLimit) return;
  const rows = await sql.query(
    `select * from (
       select 'historical' as target_table, hos.historical_odds_snapshot_id as snapshot_id,
         hos.match_id, m.league, m.home_team_name, m.away_team_name, m.kickoff_at,
         hos.bookmaker, hos.captured_at as prematch_captured_at
       from historical_odds_snapshots hos
       join matches m on m.match_id = hos.match_id
       where hos.odds_role = 'prematch'
         and hos.available_before_kickoff = true
         and hos.closing_captured_at is null
         and m.kickoff_at > now()
         and m.kickoff_at <= now() + ($1::text || ' minutes')::interval
       union all
       select 'prediction' as target_table, os.odds_snapshot_id as snapshot_id,
         ps.match_id, m.league, m.home_team_name, m.away_team_name, m.kickoff_at,
         os.bookmaker, os.captured_at as prematch_captured_at
       from odds_snapshots os
       join prediction_snapshots ps on ps.prediction_id = os.prediction_id
       join matches m on m.match_id = ps.match_id
       where os.odds_role = 'prematch'
         and os.available_before_kickoff = true
         and os.closing_captured_at is null
         and m.kickoff_at > now()
         and m.kickoff_at <= now() + ($1::text || ' minutes')::interval
     ) candidates
     order by kickoff_at asc
     limit $2`,
    [String(oddsApiClosingLookaheadMinutes), oddsApiClosingLimit]
  );
  oddsApiClosingCandidates = rows.length;
  const resultCache = new Map();
  for (const row of rows) {
    try {
      const cacheKey = row.match_id;
      if (!resultCache.has(cacheKey)) {
        const generatedAt = new Date().toISOString();
        resultCache.set(
          cacheKey,
          fetchOddsAtPrediction(
            {
              matchId: row.match_id,
              league: row.league,
              homeTeam: row.home_team_name,
              awayTeam: row.away_team_name,
              kickoff: row.kickoff_at,
            },
            { generatedAt, cutoffAt: generatedAt }
          )
        );
      }
      const result = await resultCache.get(cacheKey);
      oddsApiClosingStatusCounts[result?.status || "unknown"] =
        (oddsApiClosingStatusCounts[result?.status || "unknown"] || 0) + 1;
      const odds = result?.oddsAtPrediction;
      if (!odds || ![odds.home, odds.draw, odds.away].every((value) => Number(value) > 1)) continue;
      const closingCapturedAt = odds.capturedAt || new Date().toISOString();
      if (Date.parse(closingCapturedAt) <= Date.parse(row.prematch_captured_at || "")) continue;
      if (Date.parse(closingCapturedAt) >= Date.parse(row.kickoff_at)) continue;
      if (row.target_table === "historical") {
        const updated = await sql.query(
          `update historical_odds_snapshots
           set closing_home=$2, closing_draw=$3, closing_away=$4, closing_captured_at=$5
           where historical_odds_snapshot_id=$1
             and closing_captured_at is null
           returning historical_odds_snapshot_id`,
          [row.snapshot_id, Number(odds.home), Number(odds.draw), Number(odds.away), closingCapturedAt]
        );
        oddsApiHistoricalClosingUpdated += updated.length;
      } else {
        const updated = await sql.query(
          `update odds_snapshots
           set closing_home=$2, closing_draw=$3, closing_away=$4, closing_captured_at=$5
           where odds_snapshot_id=$1
             and closing_captured_at is null
           returning odds_snapshot_id`,
          [row.snapshot_id, Number(odds.home), Number(odds.draw), Number(odds.away), closingCapturedAt]
        );
        oddsApiPredictionClosingUpdated += updated.length;
      }
    } catch (error) {
      errors.push({ provider: "the-odds-api-closing", matchId: row.match_id, error: error.message });
    }
  }
  oddsApiClosingUpdated = oddsApiHistoricalClosingUpdated + oddsApiPredictionClosingUpdated;
}

await updateOddsApiClosingOdds();

console.log(
  JSON.stringify(
    {
      captured,
      closingUpdated,
      matchedFutureRows: futureRows,
      oddsApiCandidates,
      oddsApiCaptured,
      oddsApiClosingUpdated,
      oddsApiClosingCandidates,
      oddsApiHistoricalClosingUpdated,
      oddsApiPredictionClosingUpdated,
      oddsApiStatusCounts,
      oddsApiClosingStatusCounts,
      errors: errors.slice(0, 5),
    },
    null,
    2
  )
);
