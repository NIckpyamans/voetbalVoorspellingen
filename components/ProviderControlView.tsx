import React, { useEffect, useState } from "react";

const pct = (value: unknown) => `${Math.round(Number(value || 0) * 100)}%`;
const decimal = (value: unknown) => Number(value || 0).toFixed(3);

const ProviderControlView: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const load = async () => {
    const integrity = await fetch("/api/system-check?detail=integrity", { cache: "no-store" }).catch(() => null);
    if (integrity?.ok) return setData(await integrity.json());
    const health = await fetch("/api/system-check", { cache: "no-store" }).catch(() => null);
    setData(health?.ok ? await health.json() : { ok: false, externalSources: [], issues: ["provider_status_unavailable"] });
  };
  useEffect(() => { load(); }, []);

  const trial = async (provider: string, fieldName: string) => {
    const token = window.sessionStorage.getItem("footyai_admin_token") || window.prompt("Voer het admintoken in om een providerproef te starten.")?.trim() || "";
    if (!token) return;
    window.sessionStorage.setItem("footyai_admin_token", token);
    await fetch("/api/system-check?detail=provider-control", {
      method: "POST",
      headers: { "content-type": "application/json", "x-write-token": token },
      body: JSON.stringify({ provider, fieldName, action: "start_trial" }),
    });
    await load();
  };

  if (!data) return <div className="h-72 animate-pulse rounded-3xl bg-slate-950/40" />;
  const controls = (data.fieldTrust || []).filter((item: any) => item.control_status === "disabled" || item.control_status === "trial");
  const externalSources = data.externalSources || [];

  return <div className="space-y-5">
    <section className="overflow-hidden rounded-3xl border border-red-400/15 bg-[radial-gradient(circle_at_top_left,rgba(248,113,113,.14),transparent_40%),linear-gradient(135deg,rgba(2,6,23,.97),rgba(15,23,42,.86))] p-6">
      <div className="text-[10px] font-black uppercase tracking-[.25em] text-red-300">Bronbeveiliging</div>
      <h2 className="mt-2 text-3xl font-black text-white">Providerbeheer & herstel</h2>
      <p className="mt-2 text-xs text-slate-400">Start gecontroleerde proefheractivering en volg trust per competitie.</p>
    </section>
    <section className="glass-card rounded-3xl border border-cyan-500/15 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black uppercase text-cyan-200">Actuele gratis bronstatus</h3>
        <span className="text-[8px] font-black uppercase text-slate-500">Automatische fallbacks actief</span>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {externalSources.map((source: any) => (
          <div key={source.name} className="rounded-xl border border-white/5 bg-slate-950/35 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-[10px] font-black text-white">{source.name}</div>
              <span className={`text-[8px] font-black ${String(source.status).includes("403") ? "text-amber-300" : "text-emerald-300"}`}>{source.status}</span>
            </div>
            <div className="mt-2 text-[8px] leading-relaxed text-slate-500">{source.note || "Geen extra melding; fallbackketen blijft beschikbaar."}</div>
          </div>
        ))}
        {!externalSources.length && <div className="text-[10px] text-slate-500">Providerstatus is tijdelijk niet beschikbaar.</div>}
      </div>
    </section>
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="glass-card rounded-3xl border border-red-500/15 p-5">
        <h3 className="text-sm font-black uppercase text-red-200">Uitgeschakeld of in proef</h3>
        <div className="mt-4 space-y-2">{controls.map((item: any) =>
          <div key={`${item.provider}-${item.field_name}`} className="rounded-2xl border border-white/5 bg-slate-950/35 p-3">
            <div className="flex justify-between gap-2"><span className="truncate text-[10px] font-black text-white">{item.provider}</span><span className={item.control_status === "trial" ? "text-amber-300" : "text-red-300"}>{item.control_status}</span></div>
            <div className="mt-1 text-[8px] text-slate-500">{item.field_name} · trust {pct(item.effective_trust_score)} · {item.samples} samples · lage runs {item.consecutive_low_scores}</div>
            {item.control_status === "trial" && <div className="mt-2 text-[8px] font-bold text-amber-300">Nog {item.remaining_trial_runs} betrouwbare proefrun(s) nodig</div>}
            {item.control_status === "disabled" && <button onClick={() => trial(item.provider, item.field_name)} className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[8px] font-black uppercase text-amber-200">Start proefheractivering</button>}
          </div>)}
          {!controls.length && <div className="text-[10px] text-slate-500">Geen uitgeschakelde providers gevonden of databasebeheer is niet ingesteld.</div>}
        </div>
      </section>
      <section className="glass-card rounded-3xl border border-cyan-500/15 p-5">
        <h3 className="text-sm font-black uppercase text-cyan-200">Herkalibratiekandidaten</h3>
        <div className="mt-4 space-y-2">{(data.calibrationProfiles || []).map((item: any) =>
          <div key={item.calibration_profile_id} className="rounded-2xl border border-white/5 bg-slate-950/35 p-3">
            <div className="text-[10px] font-black text-white">{item.competition_id}</div>
            <div className="mt-1 text-[8px] text-slate-500">{item.sample_size} validaties · shrinkage {pct(item.probability_shrinkage)} · Brier {decimal(item.brier_score)}</div>
            <div className="mt-2 text-[8px] font-bold text-cyan-300">{item.profile?.status}</div>
            <div className="mt-2 text-[8px] text-slate-400">Shadow: {item.shadow_samples || 0} wedstrijden · huidig {decimal(item.shadow_current_brier)} · kandidaat {decimal(item.shadow_candidate_brier)}</div>
          </div>)}</div>
      </section>
    </div>
    <section className="glass-card rounded-3xl border border-emerald-500/15 p-5">
      <h3 className="text-sm font-black uppercase text-emerald-200">Veldtrust per competitie</h3>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{(data.competitionFieldTrust || []).slice(0, 60).map((item: any) =>
        <div key={`${item.provider}-${item.competition_id}-${item.field_name}`} className="rounded-xl border border-white/5 bg-slate-950/35 p-3">
          <div className="truncate text-[9px] font-black text-white">{item.provider}</div>
          <div className="mt-1 truncate text-[8px] text-slate-500">{item.competition_id} · {item.field_name}</div>
          <div className="mt-2 text-sm font-black text-emerald-300">{pct(item.effective_trust_score)} <span className="text-[8px] text-slate-500">{item.samples} samples</span></div>
        </div>)}</div>
    </section>
  </div>;
};

export default ProviderControlView;
