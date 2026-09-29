#!/usr/bin/env node
// Herstel ontbrekende odds-timestamps en roltoewijzingen in Neon zodat de
// leerlijn en CLV/ROI-berekeningen alleen records met opening-, prematch- of
// closing-rollen en geldige capture-timestamps meetellen. Idempotent: alleen
// rijen met aantoonbaar herstelbare ontbrekende velden worden aangepast.
//
//   node scripts/repair-historical-odds-roles.js            # dry-run rapport
//   node scripts/repair-historical-odds-roles.js --apply
//
import fs from "node:fs";
import path from "node:path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { planOddsRoleRepair, COUNTABLE_ODDS_ROLES } from "./worker/odds-role-integrity.js";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const REPORT_FILE = path.join(ROOT, "monitor", "historical-odds-role-repair.json");

async function loadRows(sql) {
  const rows = await sql.query(`
    select hos.historical_odds_snapshot_id as row_id,
           'historical_odds_snapshots' as table_name,
           hos.match_id, hos.provider, hos.odds_role, hos.captured_at, hos.closing_captured_at,
           hos.closing_home, hos.closing_draw, hos.closing_away, hos.minutes_before_kickoff,
           hos.available_before_kickoff, m.kickoff_at
    from historical_odds_snapshots hos
    left join matches m on m.match_id = hos.match_id
  `);
  const snapshotRows = await sql.query(`
    select os.odds_snapshot_id as row_id,
           'odds_snapshots' as table_name,
           ps.match_id, os.provider, os.odds_role, os.captured_at, os.closing_captured_at,
           os.closing_home, os.closing_draw, os.closing_away, os.minutes_before_kickoff,
           os.available_before_kickoff, m.kickoff_at
    from odds_snapshots os
    left join prediction_snapshots ps on ps.prediction_id = os.prediction_id
    left join matches m on m.match_id = ps.match_id
  `);
  return [...rows, ...snapshotRows];
}

function countableShare(rows) {
  if (!rows.length) return 0;
  const countable = rows.filter((row) =>
    COUNTABLE_ODDS_ROLES.includes(String(row.odds_role || "").toLowerCase()) &&
    Number.isFinite(Date.parse(row.captured_at || ""))
  );
  return Number((countable.length / rows.length).toFixed(3));
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  if (!sql) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "relational_database_not_configured" }, null, 2));
    process.exit(0);
  }

  const report = {
    ok: true,
    apply: APPLY,
    generatedAt: new Date().toISOString(),
    scanned: 0,
    repairable: 0,
    repaired: 0,
    countableRoleShareBefore: 0,
    countableRoleShareAfter: 0,
    byField: {},
    errors: [],
    samples: [],
  };

  try {
    const rows = await loadRows(sql);
    report.scanned = rows.length;
    report.countableRoleShareBefore = countableShare(rows);

    for (const row of rows) {
      const updates = planOddsRoleRepair(row);
      if (!updates) continue;
      report.repairable += 1;
      for (const field of Object.keys(updates)) {
        report.byField[field] = Number(report.byField[field] || 0) + 1;
      }
      if (report.samples.length < 20) {
        report.samples.push({ rowId: row.row_id, table: row.table_name, provider: row.provider, matchId: row.match_id, updates });
      }
      if (!APPLY) continue;
      try {
        const assignments = Object.keys(updates).map((field, index) => `${field} = $${index + 2}`);
        await sql.query(
          `update ${row.table_name} set ${assignments.join(", ")} where ${row.table_name === "historical_odds_snapshots" ? "historical_odds_snapshot_id" : "odds_snapshot_id"} = $1`,
          [row.row_id, ...Object.values(updates)]
        );
        report.repaired += 1;
      } catch (error) {
        report.errors.push({ rowId: row.row_id, table: row.table_name, error: error?.message || String(error) });
      }
    }

    if (APPLY) {
      const after = await loadRows(sql);
      report.countableRoleShareAfter = countableShare(after);
    } else {
      report.countableRoleShareAfter = report.countableRoleShareBefore;
    }
  } catch (error) {
    report.ok = false;
    report.errors.push({ error: error?.message || String(error) });
  }

  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `[odds-role-repair] scanned=${report.scanned} repairable=${report.repairable} repaired=${report.repaired} ` +
      `countable=${report.countableRoleShareBefore}->${report.countableRoleShareAfter} apply=${APPLY}`
  );
  if (report.errors.length) console.warn(JSON.stringify(report.errors.slice(0, 5), null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(`[odds-role-repair] ${error?.stack || error?.message || error}`);
  process.exit(1);
});
