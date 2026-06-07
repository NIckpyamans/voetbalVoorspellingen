#!/usr/bin/env node

import { getSql, loadLocalEnv } from "../shared/database.js";

loadLocalEnv(process.cwd());
const sql = getSql();
if (!sql) process.exit(2);
const limit = Math.max(1, Number(process.env.PREDICTION_EVALUATION_LIMIT || 1000));
const rows = await sql.query(`
  select ps.prediction_id, ps.match_id, ps.probabilities, ps.expected_score, ps.prediction_payload,
    m.kickoff_at, mr.final_home_goals, mr.final_away_goals, mr.actual_outcome,
    os.home odds_home, os.draw odds_draw, os.away odds_away, os.captured_at odds_captured_at,
    os.odds_role, os.available_before_kickoff, os.minutes_before_kickoff,
    os.closing_home, os.closing_draw, os.closing_away, os.closing_captured_at
  from prediction_snapshots ps join matches m on m.match_id=ps.match_id join match_results mr on mr.match_id=ps.match_id
  left join lateral (
    select candidate.* from (
      select home,draw,away,captured_at,odds_role,available_before_kickoff,minutes_before_kickoff,
        closing_home,closing_draw,closing_away,closing_captured_at
      from odds_snapshots os where prediction_id=ps.prediction_id and not exists(
        select 1 from provider_field_controls pfc where pfc.provider=os.provider and pfc.field_name='odds' and pfc.status='disabled')
      union all
      select home,draw,away,captured_at,odds_role,available_before_kickoff,minutes_before_kickoff,
        closing_home,closing_draw,closing_away,closing_captured_at
      from historical_odds_snapshots
      where match_id=ps.match_id and available_before_kickoff=true and captured_at<=ps.generated_at and not exists(
        select 1 from provider_field_controls pfc where pfc.provider=historical_odds_snapshots.provider and pfc.field_name='odds' and pfc.status='disabled')
    ) candidate order by candidate.captured_at desc nulls last limit 1
  ) os on true
  where ps.generated_at <= coalesce(m.kickoff_at, ps.generated_at) order by ps.generated_at limit $1
`, [limit]);
const clamp = (value) => Math.max(1e-9, Math.min(1 - 1e-9, Number(value || 0)));
let evaluated = 0;
for (const row of rows) {
  const payload = row.prediction_payload || {};
  const probabilities = row.probabilities || payload.probabilities || {};
  const raw = [Number((probabilities.home ?? payload.homeProb) || 0), Number((probabilities.draw ?? payload.drawProb) || 0), Number((probabilities.away ?? payload.awayProb) || 0)];
  const total = raw.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) continue;
  const [home, draw, away] = raw.map((value) => clamp(Math.max(0, value) / total));
  if (!["H", "D", "A"].includes(row.actual_outcome)) continue;
  const vector = { H: [1, 0, 0], D: [0, 1, 0], A: [0, 0, 1] }[row.actual_outcome];
  const predicted = [["H", home], ["D", draw], ["A", away]].sort((a, b) => b[1] - a[1])[0][0];
  const actualProbability = row.actual_outcome === "H" ? home : row.actual_outcome === "D" ? draw : away;
  const expected = row.expected_score || payload.expectedScore || {};
  const expectedHome = Number(expected.home ?? payload.predHomeGoals);
  const expectedAway = Number(expected.away ?? payload.predAwayGoals);
  const exact = Number.isFinite(expectedHome) && Number.isFinite(expectedAway) ? expectedHome === Number(row.final_home_goals) && expectedAway === Number(row.final_away_goals) : null;
  const brier = ((home-vector[0])**2 + (draw-vector[1])**2 + (away-vector[2])**2) / 3;
  const odds = predicted === "H" ? row.odds_home : predicted === "D" ? row.odds_draw : row.odds_away;
  const prematch = row.available_before_kickoff === true && row.odds_role === "prematch" &&
    Number(row.minutes_before_kickoff) > 0 && row.odds_captured_at && row.kickoff_at &&
    new Date(row.odds_captured_at) < new Date(row.kickoff_at);
  const roi = prematch && Number(odds) > 1 ? (predicted === row.actual_outcome ? Number(odds)-1 : -1) : null;
  const closing = predicted === "H" ? row.closing_home : predicted === "D" ? row.closing_draw : row.closing_away;
  const closingValid = prematch && row.closing_captured_at && new Date(row.closing_captured_at) > new Date(row.odds_captured_at) && Number(closing) > 1;
  const clv = closingValid ? Number(odds) / Number(closing) - 1 : null;
  await sql.query(`
    insert into prediction_evaluations (prediction_id,match_id,exact_hit,outcome_hit,probability_outcome_hit,brier_score,log_loss,roi,roi_status,clv,clv_status,evaluation_source,evaluated_at)
    values ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,'scheduled-database-evaluator',now())
    on conflict (prediction_id) do update set match_id=excluded.match_id,exact_hit=excluded.exact_hit,outcome_hit=excluded.outcome_hit,
      probability_outcome_hit=excluded.probability_outcome_hit,brier_score=excluded.brier_score,log_loss=excluded.log_loss,
      roi=excluded.roi,roi_status=excluded.roi_status,clv=excluded.clv,clv_status=excluded.clv_status,evaluation_source=excluded.evaluation_source,evaluated_at=now()
  `, [row.prediction_id,row.match_id,exact,predicted===row.actual_outcome,brier,-Math.log(actualProbability),roi,roi==null?"prematch_odds_missing":"settled",clv,clv==null?"timestamped_closing_odds_missing":"settled"]);
  evaluated += 1;
}
console.log(JSON.stringify({ candidates: rows.length, evaluated }, null, 2));
