import React, { useEffect, useState } from "react";
const pct=(v:any)=>`${Math.round(Number(v||0)*100)}%`;
const ProviderControlView:React.FC=()=>{
 const [data,setData]=useState<any>(null);
 const load=()=>fetch("/api/system-check?detail=integrity",{cache:"no-store"}).then(r=>r.json()).then(setData);
 useEffect(()=>{load()},[]);
 const trial=async(provider:string,fieldName:string)=>{await fetch("/api/system-check?detail=provider-control",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({provider,fieldName,action:"start_trial"})});await load();};
 if(!data)return <div className="h-72 animate-pulse rounded-3xl bg-slate-950/40"/>;
 const controls=(data.fieldTrust||[]).filter((x:any)=>x.control_status==="disabled"||x.control_status==="trial");
 return <div className="space-y-5">
  <section className="overflow-hidden rounded-3xl border border-red-400/15 bg-[radial-gradient(circle_at_top_left,rgba(248,113,113,.14),transparent_40%),linear-gradient(135deg,rgba(2,6,23,.97),rgba(15,23,42,.86))] p-6">
   <div className="text-[10px] font-black uppercase tracking-[.25em] text-red-300">Bronbeveiliging</div><h2 className="mt-2 text-3xl font-black text-white">Providerbeheer & herstel</h2>
   <p className="mt-2 text-xs text-slate-400">Start gecontroleerde proefheractivering en volg trust per competitie.</p>
  </section>
  <div className="grid gap-5 xl:grid-cols-2">
   <section className="glass-card rounded-3xl border border-red-500/15 p-5"><h3 className="text-sm font-black uppercase text-red-200">Uitgeschakeld of in proef</h3><div className="mt-4 space-y-2">
    {controls.map((x:any)=><div key={`${x.provider}-${x.field_name}`} className="rounded-2xl border border-white/5 bg-slate-950/35 p-3"><div className="flex justify-between gap-2"><span className="truncate text-[10px] font-black text-white">{x.provider}</span><span className={x.control_status==="trial"?"text-amber-300":"text-red-300"}>{x.control_status}</span></div><div className="mt-1 text-[8px] text-slate-500">{x.field_name} · trust {pct(x.effective_trust_score)} · {x.samples} samples · lage runs {x.consecutive_low_scores}</div>{x.control_status==="disabled"&&<button onClick={()=>trial(x.provider,x.field_name)} className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[8px] font-black uppercase text-amber-200">Start proefheractivering</button>}</div>)}
   </div></section>
   <section className="glass-card rounded-3xl border border-cyan-500/15 p-5"><h3 className="text-sm font-black uppercase text-cyan-200">Herkalibratiekandidaten</h3><div className="mt-4 space-y-2">{(data.calibrationProfiles||[]).map((x:any)=><div key={x.calibration_profile_id} className="rounded-2xl border border-white/5 bg-slate-950/35 p-3"><div className="text-[10px] font-black text-white">{x.competition_id}</div><div className="mt-1 text-[8px] text-slate-500">{x.sample_size} samples · shrinkage {pct(x.probability_shrinkage)} · Brier {Number(x.brier_score).toFixed(3)}</div><div className="mt-2 text-[8px] font-bold text-cyan-300">{x.profile?.status}</div></div>)}</div></section>
  </div>
  <section className="glass-card rounded-3xl border border-emerald-500/15 p-5"><h3 className="text-sm font-black uppercase text-emerald-200">Veldtrust per competitie</h3><div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{(data.competitionFieldTrust||[]).slice(0,36).map((x:any)=><div key={`${x.provider}-${x.competition_id}-${x.field_name}`} className="rounded-xl border border-white/5 bg-slate-950/35 p-3"><div className="truncate text-[9px] font-black text-white">{x.provider}</div><div className="mt-1 truncate text-[8px] text-slate-500">{x.competition_id}</div><div className="mt-2 text-sm font-black text-emerald-300">{pct(x.effective_trust_score)} <span className="text-[8px] text-slate-500">{x.samples} samples</span></div></div>)}</div></section>
 </div>
};export default ProviderControlView;
