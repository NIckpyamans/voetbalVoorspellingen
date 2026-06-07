#!/usr/bin/env node

import crypto from "crypto";
import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const leagues = ["E0", "E1", "N1", "N2", "D1", "SP1", "SP2", "I1", "F1", "B1", "P1"];
const digest = (value) => crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 22);
const normalize = (value) => String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
const now = new Date();
const start = now.getUTCMonth() + 1 >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
const folders = [`${String(start).slice(2)}${String(start + 1).slice(2)}`, `${String(start + 1).slice(2)}${String(start + 2).slice(2)}`];
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
const errors = [];
for (const folder of folders) for (const code of leagues) {
  const url = `https://www.football-data.co.uk/mmz4281/${folder}/${code}.csv`;
  try {
    const response = await fetch(url);
    if (!response.ok) continue;
    const fetchedAt = new Date().toISOString();
    for (const row of parseCsv(await response.text())) {
      const dateKey = parseDate(row.Date);
      if (!dateKey || !row.HomeTeam || !row.AwayTeam) continue;
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
console.log(JSON.stringify({ captured, closingUpdated, matchedFutureRows: futureRows, errors: errors.slice(0, 5) }, null, 2));
