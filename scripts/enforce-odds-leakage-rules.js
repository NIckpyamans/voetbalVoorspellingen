#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "relational_database_not_configured" }, null, 2));
  process.exit(0);
}

try {
await sql.query(`
  update historical_odds_snapshots
  set odds_role = 'closing_proxy',
      available_before_kickoff = false,
      minutes_before_kickoff = null,
      closing_captured_at = null
  where provider = 'Football-Data.co.uk'
`);

await sql.query(`
  update historical_odds_snapshots hos
  set odds_role = case
        when hos.captured_at < m.kickoff_at then 'prematch'
        when hos.captured_at >= m.kickoff_at then 'in_play'
        else 'unknown'
      end,
      available_before_kickoff = hos.captured_at < m.kickoff_at,
      minutes_before_kickoff = case
        when hos.captured_at < m.kickoff_at then floor(extract(epoch from (m.kickoff_at - hos.captured_at)) / 60)::int
        else null
      end
  from matches m
  where m.match_id = hos.match_id
    and hos.provider <> 'Football-Data.co.uk'
`);

await sql.query(`
  update odds_snapshots os
  set odds_role = case
        when os.captured_at < m.kickoff_at then 'prematch'
        when os.captured_at >= m.kickoff_at then 'in_play'
        else 'unknown'
      end,
      available_before_kickoff = os.captured_at < m.kickoff_at,
      minutes_before_kickoff = case
        when os.captured_at < m.kickoff_at then floor(extract(epoch from (m.kickoff_at - os.captured_at)) / 60)::int
        else null
      end
  from prediction_snapshots ps join matches m on m.match_id = ps.match_id
  where ps.prediction_id = os.prediction_id
`);

const [summary] = await sql.query(`
  select
    (select count(*)::int from historical_odds_snapshots) as historical_total,
    (select count(*)::int from historical_odds_snapshots where odds_role = 'closing_proxy') as closing_proxies,
    (select count(*)::int from historical_odds_snapshots where available_before_kickoff) as historical_prematch_available,
    (select count(*)::int from odds_snapshots where available_before_kickoff) as prediction_prematch_available,
    (
      select count(*)::int
      from historical_odds_snapshots hos join matches m on m.match_id = hos.match_id
      where hos.available_before_kickoff and (hos.odds_role <> 'prematch' or hos.captured_at >= m.kickoff_at)
    ) as invalid_historical_rows,
    (
      select count(*)::int
      from odds_snapshots os
      join prediction_snapshots ps on ps.prediction_id = os.prediction_id
      join matches m on m.match_id = ps.match_id
      where os.available_before_kickoff and (os.odds_role <> 'prematch' or os.captured_at >= m.kickoff_at)
    ) as invalid_prediction_rows
`);
console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: "relational_database_unavailable",
    databaseError: error?.message || String(error),
    r2OddsCaptureUnaffected: true,
  }, null, 2));
}
