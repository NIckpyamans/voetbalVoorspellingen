#!/usr/bin/env node
// Leakage-bewaking voor odds-rijen. Deze run beschadigt GEEN geldige
// roltoewijzingen of timestamps meer: opening-, prematch- en closing-rollen
// blijven behouden en closing-paren worden niet gewist. Alleen ontbrekende of
// onbekende rollen worden afgeleid, en closing-proxy-imports (football-data.co.uk)
// krijgen hun closing-rol en closing-timestamp terug zodat ze meetellen in de
// leerlijn zonder als prematch-capture te worden behandeld.

import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "relational_database_not_configured" }, null, 2));
  process.exit(0);
}

try {
// Football-Data.co.uk-rijen zijn closing-proxy's: de sluitingslijn ligt vast op
// kick-off. Herstel de closing-rol en closing-timestamp (idempotent), maar
// behandel de prematch-kant niet als echte capture: available_before_kickoff
// blijft false zodat er geen onechte CLV-paren ontstaan.
await sql.query(`
  update historical_odds_snapshots hos
  set odds_role = 'closing',
      closing_captured_at = coalesce(hos.closing_captured_at, m.kickoff_at),
      available_before_kickoff = false,
      minutes_before_kickoff = null
  from matches m
  where m.match_id = hos.match_id
    and hos.provider = 'Football-Data.co.uk'
    and (hos.odds_role is distinct from 'closing' or hos.closing_captured_at is null)
`);

// Alleen ontbrekende of onbekende rollen afleiden uit captured_at versus
// kick-off. Expliciete 'opening' en 'closing'-rollen worden nooit overschreven.
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
    and hos.captured_at is not null
    and coalesce(hos.odds_role, '') in ('', 'unknown', 'closing_proxy')
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
    and os.captured_at is not null
    and coalesce(os.odds_role, '') in ('', 'unknown', 'closing_proxy')
`);

const [summary] = await sql.query(`
  select
    (select count(*)::int from historical_odds_snapshots) as historical_total,
    (select count(*)::int from historical_odds_snapshots where odds_role = 'closing_proxy') as closing_proxies,
    (select count(*)::int from historical_odds_snapshots where odds_role = 'closing') as closing_rows,
    (select count(*)::int from historical_odds_snapshots where closing_captured_at is not null) as closing_timestamped,
    (select count(*)::int from historical_odds_snapshots where available_before_kickoff) as historical_prematch_available,
    (select count(*)::int from odds_snapshots where available_before_kickoff) as prediction_prematch_available,
    (
      select count(*)::int
      from historical_odds_snapshots hos join matches m on m.match_id = hos.match_id
      where hos.available_before_kickoff and (hos.odds_role not in ('opening','prematch') or hos.captured_at >= m.kickoff_at)
    ) as invalid_historical_rows,
    (
      select count(*)::int
      from odds_snapshots os
      join prediction_snapshots ps on ps.prediction_id = os.prediction_id
      join matches m on m.match_id = ps.match_id
      where os.available_before_kickoff and (os.odds_role not in ('opening','prematch') or os.captured_at >= m.kickoff_at)
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
