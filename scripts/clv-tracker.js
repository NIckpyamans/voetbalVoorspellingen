#!/usr/bin/env node
// CLV/ROI-tracker: verzamelt timestamped oddsparen (alleen opening-, prematch-
// en closing-rollen met geldige timestamps) en rapporteert closing-line-value,
// ROI en overround per competitie. Publicatie blijft geblokkeerd totdat er
// minimaal 100 paren zijn; koude cijfers staan wel in het rapport.
//
//   node scripts/clv-tracker.js
//
import fs from "node:fs";
import path from "node:path";
import { getSql, loadLocalEnv } from "../shared/database.js";
import { buildClvTracker, buildOverroundProfiles } from "./worker/market-strength.js";

const ROOT = process.cwd();
const REPORT_FILE = path.join(ROOT, "monitor", "clv-tracker.json");
const MIN_PAIRS = Math.max(1, Number(process.env.CLV_TRACKER_MIN_PAIRS || 100));

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  loadLocalEnv(ROOT);
  const sql = getSql();
  if (!sql) {
    writeReport({ ok: true, skipped: true, reason: "relational_database_not_configured", generatedAt: new Date().toISOString() });
    return;
  }
  try {
    const evaluations = await sql.query(`
      select m.league, pe.roi, pe.clv
      from prediction_evaluations pe
      join matches m on m.match_id = pe.match_id
      where pe.clv is not null or pe.roi is not null
    `);
    const oddsRows = await sql.query(`
      select m.league, hos.home, hos.draw, hos.away, hos.closing_home, hos.closing_draw, hos.closing_away
      from historical_odds_snapshots hos
      join matches m on m.match_id = hos.match_id
      where hos.odds_role in ('opening', 'prematch', 'closing') and hos.captured_at is not null
      union all
      select m.league, os.home, os.draw, os.away, os.closing_home, os.closing_draw, os.closing_away
      from odds_snapshots os
      join prediction_snapshots ps on ps.prediction_id = os.prediction_id
      join matches m on m.match_id = ps.match_id
      where os.odds_role in ('opening', 'prematch', 'closing') and os.captured_at is not null
    `);
    const tracker = buildClvTracker(
      evaluations.map((row) => ({ league: row.league, roi: row.roi, clv: row.clv })),
      { minPairs: MIN_PAIRS }
    );
    writeReport({
      ok: true,
      generatedAt: new Date().toISOString(),
      ...tracker,
      overroundProfiles: buildOverroundProfiles(oddsRows),
      evaluatedRows: evaluations.length,
      oddsRows: oddsRows.length,
    });
  } catch (error) {
    writeReport({
      ok: true,
      skipped: true,
      reason: "relational_database_unavailable",
      generatedAt: new Date().toISOString(),
      databaseError: String(error?.message || error).slice(0, 500),
    });
  }
}

main().catch((error) => {
  console.error(`[clv-tracker] ${error?.stack || error?.message || error}`);
  process.exit(1);
});
