#!/usr/bin/env node
import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const clamp = (value) => Math.max(1e-9, Math.min(1 - 1e-9, Number(value || 0)));
const normalize = (values) => {
  const total = values.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
  return total ? values.map((value) => Math.max(0, Number(value || 0)) / total) : [1 / 3, 1 / 3, 1 / 3];
};
const applyProfile = (current, profile) => {
  const payload = profile.profile || {};
  if (payload.adjustmentType === "league_bias_v1") {
    const adjusted = [
      clamp(current[0] + Number(payload.homeBias || 0)),
      clamp(current[1] + Number(payload.drawBias || 0)),
      clamp(current[2] - Number(payload.homeBias || 0)),
    ];
    return normalize(adjusted);
  }
  const prior = payload.prior || {};
  const shrink = Number(profile.probability_shrinkage || 0);
  const shadow = current.map((value, index) => clamp(value * (1 - shrink) + Number(prior[["home", "draw", "away"][index]] || 0) * shrink));
  return normalize(shadow);
};
const profiles = await sql.query("select * from calibration_profiles where phase_bucket in ('competition_recalibration_candidate','league_recalibration_candidate')");
let evaluated = 0;
for (const profile of profiles) {
  const prior = profile.profile?.prior || {};
  const shrink = Number(profile.probability_shrinkage || 0);
  const rows = await sql.query(`select ps.prediction_id,ps.match_id,ps.probabilities,mr.actual_outcome
    from prediction_snapshots ps join matches m on m.match_id=ps.match_id join match_results mr on mr.match_id=m.match_id
    where m.competition_id=$1 and ps.generated_at<=m.kickoff_at and mr.actual_outcome in ('H','D','A')`, [profile.competition_id]);
  for (const row of rows) {
    const current = normalize(["home", "draw", "away"].map((key) => row.probabilities?.[key]));
    const normalizedShadow = applyProfile(current, profile);
    const actual = { H: 0, D: 1, A: 2 }[row.actual_outcome];
    const brier = (probabilities) => probabilities.reduce((sum, value, index) => sum + (value - (index === actual ? 1 : 0)) ** 2, 0) / 3;
    const hit = (probabilities) => probabilities.indexOf(Math.max(...probabilities)) === actual;
    await sql.query(`insert into shadow_prediction_evaluations(shadow_evaluation_id,calibration_profile_id,prediction_id,match_id,competition_id,current_brier,shadow_brier,current_outcome_hit,shadow_outcome_hit,shadow_probabilities,evaluated_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now()) on conflict(calibration_profile_id,prediction_id) do update set current_brier=excluded.current_brier,shadow_brier=excluded.shadow_brier,current_outcome_hit=excluded.current_outcome_hit,shadow_outcome_hit=excluded.shadow_outcome_hit,shadow_probabilities=excluded.shadow_probabilities,evaluated_at=now()`,
    [`shadow_${profile.calibration_profile_id}_${row.prediction_id}`, profile.calibration_profile_id, row.prediction_id, row.match_id, profile.competition_id, brier(current), brier(normalizedShadow), hit(current), hit(normalizedShadow), JSON.stringify({ home: normalizedShadow[0], draw: normalizedShadow[1], away: normalizedShadow[2] })]);
    evaluated += 1;
  }
}
console.log(JSON.stringify({ profiles: profiles.length, evaluated }, null, 2));
