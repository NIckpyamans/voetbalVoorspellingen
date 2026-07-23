#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { getSql, loadLocalEnv } from "../shared/database.js";
const ROOT = process.cwd();
loadLocalEnv(ROOT);
const sql = getSql();
let rows = [];
let databaseError = null;
if (sql) {
  try {
    rows = await sql.query(`select cp.competition_id,cp.sample_size::int time_split_validation_matches,
  count(distinct se.prediction_id)::int shadow_evaluation_matches,
  greatest(0,20-cp.sample_size)::int remaining_time_split_validation_target,
  greatest(0,20-count(distinct se.prediction_id))::int remaining_shadow_target
  from calibration_profiles cp left join shadow_prediction_evaluations se on se.calibration_profile_id=cp.calibration_profile_id
  where cp.phase_bucket='competition_recalibration_candidate'
    and cp.competition_id in ('competition-belgium-l1','competition-europe-champions-league')
  group by cp.competition_id,cp.sample_size order by cp.competition_id`);
  } catch (error) {
    databaseError = error?.message || String(error);
  }
}
const reportPath = path.join(ROOT, "monitor", "model-recalibration-report.json");
const calibration = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, "utf8")) : null;
console.log(JSON.stringify({
  minimumValidationMatches: 20,
  source: databaseError || !sql ? "calibration_report_fallback" : "neon",
  database: { configured: !!sql, available: !!sql && !databaseError, error: databaseError },
  promotionGate: calibration?.promotionGate || null,
  competitions: rows,
}, null, 2));
