#!/usr/bin/env node
import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const rows = await sql.query(`select cp.competition_id,cp.sample_size::int time_split_validation_matches,
  count(distinct se.prediction_id)::int shadow_evaluation_matches,
  greatest(0,20-cp.sample_size)::int remaining_time_split_validation_target,
  greatest(0,20-count(distinct se.prediction_id))::int remaining_shadow_target
  from calibration_profiles cp left join shadow_prediction_evaluations se on se.calibration_profile_id=cp.calibration_profile_id
  where cp.phase_bucket='competition_recalibration_candidate'
    and cp.competition_id in ('competition-belgium-l1','competition-europe-champions-league')
  group by cp.competition_id,cp.sample_size order by cp.competition_id`);
console.log(JSON.stringify({ minimumValidationMatches: 20, competitions: rows }, null, 2));
