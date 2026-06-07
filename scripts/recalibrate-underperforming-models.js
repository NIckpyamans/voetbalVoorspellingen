#!/usr/bin/env node
import { getSql, loadLocalEnv } from "../shared/database.js";
loadLocalEnv(process.cwd()); const sql=getSql(); if(!sql) process.exit(2);
const competitions=["competition-belgium-l1","competition-europe-champions-league"];
const clamp=(x)=>Math.max(1e-9,Math.min(1-1e-9,x));
for(const competition of competitions){
 const rows=await sql.query(`select ps.model_version,ps.probabilities,mr.actual_outcome,ps.generated_at from prediction_snapshots ps join prediction_evaluations pe on pe.prediction_id=ps.prediction_id join matches m on m.match_id=ps.match_id join match_results mr on mr.match_id=ps.match_id where m.competition_id=$1 order by ps.generated_at`,[competition]);
 if(rows.length<20) continue;
 const split=Math.max(14,Math.floor(rows.length*.7));const train=rows.slice(0,split),validation=rows.slice(split);
 const counts={H:1,D:1,A:1}; train.forEach(r=>counts[r.actual_outcome]++);
 const total=train.length+3;const prior={home:counts.H/total,draw:counts.D/total,away:counts.A/total};
 const score=(s)=>validation.reduce((sum,r)=>{const p=r.probabilities||{};const q=["home","draw","away"].map(k=>clamp(Number(p[k]||0)*(1-s)+prior[k]*s));const y=r.actual_outcome==="H"?0:r.actual_outcome==="D"?1:2;return sum+q.reduce((v,x,i)=>v+(x-(i===y?1:0))**2,0)/3;},0)/validation.length;
 const candidates=Array.from({length:8},(_,i)=>i*.05).map(shrinkage=>({shrinkage,brier:score(shrinkage)})).sort((a,b)=>a.brier-b.brier);
 const best=candidates[0], baseline=score(0), model=rows[0].model_version||"unknown";
 await sql.query(`insert into calibration_profiles(calibration_profile_id,competition_id,phase_bucket,sample_size,brier_score,probability_shrinkage,profile,generated_at)
 values($1,$2,'competition_recalibration_candidate',$3,$4,$5,$6::jsonb,now()) on conflict(calibration_profile_id) do update set sample_size=excluded.sample_size,brier_score=excluded.brier_score,probability_shrinkage=excluded.probability_shrinkage,profile=excluded.profile,generated_at=now()`,
 [`cal_${competition}_${model}`,competition,validation.length,best.brier,best.shrinkage,JSON.stringify({status:validation.length<20?"candidate_insufficient_validation":best.brier<baseline?"candidate_improves_brier":"candidate_no_improvement",modelVersion:model,minimumValidationRows:20,trainRows:train.length,validationRows:validation.length,prior,baselineBrier:baseline,calibratedBrier:best.brier,improvement:baseline-best.brier,method:"time_split_competition_prior_shrinkage_v2",leakageSafe:true})]);
}
console.log(JSON.stringify({competitions},null,2));
