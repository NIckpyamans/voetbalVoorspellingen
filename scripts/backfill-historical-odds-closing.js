#!/usr/bin/env node
// Backfill historische (closing) odds uit football-data.co.uk seizoens-CSV's voor
// wedstrijden die al in Neon staan maar nog geen historische odds hebben. Idempotent:
// deterministische snapshot-ID's en `on conflict do nothing`.
//
//   node scripts/backfill-historical-odds-closing.js            # dry-run rapport
//   node scripts/backfill-historical-odds-closing.js --apply
//
import crypto from "crypto";
import { getSql, loadLocalEnv } from "../shared/database.js";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const SEASONS = String(process.env.FOOTBALL_DATA_SEASONS || "2526,2425").split(",").map((value) => value.trim()).filter(Boolean);
const LEAGUES = String(
  process.env.FOOTBALL_DATA_LEAGUES ||
    "E0,E1,D1,I1,SP1,F1,N1,B1,P1,SC0,EC,GB1"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const digest = (value) => crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 16);
const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function parseCsv(text) {
  const rows = [];
  let current = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      current.push(field);
      field = "";
    } else if (char === "\n") {
      current.push(field);
      rows.push(current);
      current = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || current.length) {
    current.push(field);
    rows.push(current);
  }
  const header = rows.shift() || [];
  return rows
    .filter((row) => row.length > 1)
    .map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] ?? ""])));
}

function parseDate(value) {
  const match = String(value || "").match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return `${year}-${match[2]}-${match[1]}`;
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  if (!sql) {
    console.error("[odds-backfill] DATABASE_URL ontbreekt; niets te doen.");
    process.exit(1);
  }
  const report = { ok: true, apply: APPLY, seasons: SEASONS, leagues: LEAGUES, fetched: 0, matched: 0, inserted: 0, errors: [] };
  for (const season of SEASONS) {
    for (const code of LEAGUES) {
      const url = `https://www.football-data.co.uk/mmz4281/${season}/${code}.csv`;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) {
          report.errors.push({ url, status: response.status });
          continue;
        }
        const rows = parseCsv(await response.text());
        report.fetched += rows.length;
        for (const row of rows) {
          const dateKey = parseDate(row.Date);
          const home = normalize(row.HomeTeam);
          const away = normalize(row.AwayTeam);
          if (!dateKey || !home || !away) continue;
          // Sluitingskoersen: football-data.co.uk publiceertAvg/B365 na afloop;
          // behandel ze als closing voor reeds gespeelde wedstrijden.
          const bookmakerRows = [
            ["MarketAvg", row.AvgH, row.AvgD, row.AvgA],
            ["MarketMax", row.MaxH, row.MaxD, row.MaxA],
            ["Bet365", row.B365H, row.B365D, row.B365A],
          ].filter(([, h, d, a]) => [h, d, a].every((value) => Number(value) > 1));
          if (!bookmakerRows.length) continue;
          const [match] = await sql.query(
            `select match_id, kickoff_at from matches
             where date_key = $1 and identity_status = 'resolved'
               and regexp_replace(lower(home_team_name), '[^a-z0-9]', '', 'g') = $2
               and regexp_replace(lower(away_team_name), '[^a-z0-9]', '', 'g') = $3
             limit 1`,
            [dateKey, home, away]
          );
          if (!match) continue;
          report.matched += 1;
          const capturedAt = new Date(Date.parse(match.kickoff_at) - 60 * 60 * 1000).toISOString();
          for (const [bookmaker, h, d, a] of bookmakerRows) {
            const snapshotId = `fdclosing_${digest(`${match.match_id}|${bookmaker}`)}`;
            if (!APPLY) {
              report.inserted += 1;
              continue;
            }
            const result = await sql.query(
              `insert into historical_odds_snapshots (
                 historical_odds_snapshot_id, match_id, provider, bookmaker, market,
                 home, draw, away, closing_home, closing_draw, closing_away,
                 captured_at, closing_captured_at, odds_role, available_before_kickoff
               ) values ($1,$2,'Football-Data.co.uk',$3,'1X2',$4,$5,$6,$4,$5,$6,$7,$7,'closing',true)
               on conflict (historical_odds_snapshot_id) do update set
                 closing_home = excluded.closing_home,
                 closing_draw = excluded.closing_draw,
                 closing_away = excluded.closing_away,
                 closing_captured_at = excluded.closing_captured_at
               returning historical_odds_snapshot_id`,
              [snapshotId, match.match_id, bookmaker, Number(h), Number(d), Number(a), capturedAt]
            );
            if (result.length) report.inserted += 1;
          }
        }
      } catch (error) {
        report.errors.push({ url, error: error?.message || String(error) });
      }
    }
  }
  console.log(
    `[odds-backfill] fetched=${report.fetched} matched=${report.matched} snapshots=${report.inserted} ` +
      `errors=${report.errors.length} apply=${APPLY}`
  );
  if (report.errors.length) console.warn(JSON.stringify(report.errors.slice(0, 5), null, 2));
}

main().catch((error) => {
  console.error(`[odds-backfill] ${error?.stack || error?.message || error}`);
  process.exit(1);
});
