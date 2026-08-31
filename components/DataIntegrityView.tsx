import React, { useEffect, useState } from "react";

const pct = (value: unknown) => `${Math.round(Number(value || 0) * 100)}%`;
const number = (value: unknown) => Number(value || 0).toLocaleString("nl-NL");
const trendGroups = (rows: any[]) => Object.values((rows || []).reduce((groups: Record<string, any>, row: any) => {
  if (!groups[row.metric_key]) groups[row.metric_key] = { key: row.metric_key, rows: [] };
  groups[row.metric_key].rows.push(row);
  return groups;
}, {})) as Array<{ key: string; rows: any[] }>;

const DataIntegrityView: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/system-check?detail=integrity", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) throw new Error(payload.error || "Integriteitsdata ophalen mislukt");
        setData(payload);
      })
      .catch((nextError) => {
        if (nextError.name !== "AbortError") setError(nextError.message);
      });
    return () => controller.abort();
  }, []);

  if (error) return <div className="rounded-3xl border border-red-500/20 bg-red-950/20 p-8 text-red-200">{error}</div>;
  if (!data) return <div className="h-72 animate-pulse rounded-3xl border border-cyan-500/10 bg-slate-950/40" />;

  const summary = data.summary || {};
  const trendItems = trendGroups(data.trends);
  const modelQuality = Object.values((data.modelQualityTrends || []).reduce((groups: Record<string, any>, row: any) => {
    if (!groups[row.dimension_key]) groups[row.dimension_key] = { dimension: row.dimension_key, metrics: {}, metadata: row.metadata || {} };
    groups[row.dimension_key].metrics[row.metric_key] = Number(row.metric_value || 0);
    return groups;
  }, {})) as Array<{ dimension: string; metrics: Record<string, number>; metadata: any }>;
  const roiMetric = (key: string) => Number((data.roiClvReadiness || []).find((row: any) => row.metric_key === key)?.metric_value || 0);
  const updateAlert = async (alertId: string, action: string) => {
    const token = window.sessionStorage.getItem("footyai_operator_token") || window.prompt("Voer het operator- of admintoken in.")?.trim() || "";
    if (!token) return;
    window.sessionStorage.setItem("footyai_operator_token", token);
    const response = await fetch("/api/system-check?detail=integrity-alert", {
      method: "POST",
      headers: { "content-type": "application/json", "x-write-token": token },
      body: JSON.stringify({ alertId, action }),
    });
    if (!response.ok) throw new Error("Alertactie mislukt");
    setData((current: any) => ({ ...current, qualityAlerts: (current.qualityAlerts || []).filter((alert: any) => alert.alert_id !== alertId) }));
  };
  const cards = [
    ["Opgeloste identiteit", `${number(summary.resolved_matches)} / ${number(summary.matches)}`, "text-emerald-300"],
    ["Quarantaine", number(summary.quarantined_matches), "text-amber-300"],
    ["Bronconflicten beoordeeld", number(summary.conflicts), "text-cyan-300"],
    ["Prediction auditregels", number(summary.audit_rows), "text-blue-300"],
    ["Veilige prematch odds", number(summary.prematch_odds), "text-lime-300"],
    ["Closing timestamp-paren", number(summary.closing_pairs), "text-orange-300"],
    ["H2H-relaties", number(summary.h2h_edges), "text-rose-300"],
    ["Geaudite voorspellingen", `${number(summary.audited_predictions)} / ${number(summary.prediction_snapshots)}`, "text-violet-300"],
  ];

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-3xl border border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.13),transparent_38%),linear-gradient(135deg,rgba(2,6,23,0.96),rgba(15,23,42,0.84))] p-6">
        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-300">Data control room</div>
        <h2 className="mt-2 text-3xl font-black text-white">Integriteit & bronbewijs</h2>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-400">
          Live overzicht van identiteit, providertrust, bronconflicten, auditdekking en leakage-veilige odds.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
          {cards.map(([label, value, tone]) => (
            <div key={label} className="rounded-2xl border border-white/5 bg-slate-950/45 p-3">
              <div className="text-[8px] font-black uppercase text-slate-500">{label}</div>
              <div className={`mt-1 text-xl font-black ${tone}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <section className="glass-card rounded-3xl border border-cyan-500/15 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black uppercase text-cyan-200">Kwaliteit per competitie</h3>
            <p className="mt-1 text-[9px] text-slate-500">Dekking en lekvrije modelresultaten; blijft via fallback zichtbaar wanneer Neon niet schrijfbaar is.</p>
          </div>
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-[8px] font-black text-amber-200">
            herstel {number(data.targetedRepairSummary?.urgent)} urgent / {number(data.targetedRepairSummary?.pending)} totaal
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-[9px]">
            <thead className="text-slate-500"><tr><th className="p-2">Competitie</th><th>H2H</th><th>Vorm</th><th>Lineup</th><th>Selectie</th><th>Ratings</th><th>Odds tijd</th><th>1X2</th><th>Brier</th><th>Log-loss</th><th>Exact</th><th>Evaluaties</th><th>Status</th></tr></thead>
            <tbody>
              {(data.competitionQuality || []).map((item: any) => (
                <tr key={item.league} className="border-t border-white/5 text-slate-300">
                  <td className="p-2 font-black text-white">{item.league}</td>
                  <td>{pct(item.coverage?.h2h)}</td><td>{pct(item.coverage?.form)}</td><td>{pct(item.coverage?.confirmedLineups)}</td><td>{pct(item.coverage?.squads)}</td><td>{pct(item.coverage?.ratings)}</td><td>{pct(item.coverage?.timestampedOdds)}</td>
                  <td>{item.performance?.outcomeHitRate == null ? "-" : pct(item.performance.outcomeHitRate)}</td>
                  <td>{item.performance?.brierScore == null ? "-" : Number(item.performance.brierScore).toFixed(3)}</td>
                  <td>{item.performance?.logLoss == null ? "-" : Number(item.performance.logLoss).toFixed(3)}</td>
                  <td>{item.performance?.exactHitRate == null ? "-" : pct(item.performance.exactHitRate)}</td>
                  <td>{number(item.performance?.evaluations)}</td>
                  <td title={item.modelReadyReason} className={item.modelReady ? "font-black text-emerald-300" : "text-amber-300"}>{item.modelReady ? "modelrijp" : "shadow"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!(data.competitionQuality || []).length && <div className="rounded-2xl border border-white/5 p-4 text-slate-500">De volgende worker-run bouwt dit overzicht op.</div>}
        </div>
        {data.storagePolicy && (
          <div className="mt-3 flex flex-wrap gap-2 text-[8px] text-slate-400">
            <span className="rounded-full bg-slate-950/50 px-2 py-1">Historie: <b className="text-cyan-200">{data.storagePolicy.immutableHistory}</b></span>
            <span className="rounded-full bg-slate-950/50 px-2 py-1">Fallback: <b className="text-cyan-200">{data.storagePolicy.servingFallback}</b></span>
            <span className="rounded-full bg-slate-950/50 px-2 py-1">Relationeel: <b className="text-cyan-200">{data.storagePolicy.relationalHotIndex}</b></span>
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="glass-card rounded-3xl border border-amber-500/15 p-5">
          <h3 className="text-sm font-black uppercase text-amber-200">Quarantaine die aandacht vraagt</h3>
          <div className="mt-3 max-h-[460px] space-y-2 overflow-y-auto pr-1">
            {data.quarantine.length ? data.quarantine.map((item: any) => (
              <div key={item.match_id} className="rounded-2xl border border-white/5 bg-slate-950/35 p-3">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-black text-white">{item.home_team_name} - {item.away_team_name}</div>
                    <div className="mt-1 text-[9px] text-slate-500">{item.league || "Competitie onbekend"} · {item.date_key || "datum onbekend"}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-1 text-[8px] font-black text-amber-200">{item.attempts || 0} pogingen</span>
                </div>
                <div className="mt-2 text-[9px] text-slate-400">Mist: {(item.identity_missing_fields || []).join(", ")}</div>
              </div>
            )) : <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-sm font-bold text-emerald-200">Geen wedstrijden in quarantaine.</div>}
          </div>
        </section>

        <section className="glass-card rounded-3xl border border-cyan-500/15 p-5">
          <h3 className="text-sm font-black uppercase text-cyan-200">Provider trust</h3>
          <div className="mt-3 space-y-2">
            {data.providers.slice(0, 14).map((provider: any) => (
              <div key={provider.provider} className="rounded-xl border border-white/5 bg-slate-950/35 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="truncate text-[10px] font-black text-white">{provider.provider}</div>
                  <div className="text-sm font-black text-cyan-300">{pct(provider.effective_trust_score)}</div>
                </div>
                <div className="mt-1 flex justify-between text-[8px] text-slate-500">
                  <span>{number(provider.records_count)} records</span>
                  <span>timestamps {pct(provider.timestamp_coverage)} · conflict {pct(provider.conflict_rate)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="glass-card rounded-3xl border border-blue-500/15 p-5">
          <h3 className="text-sm font-black uppercase text-blue-200">Auditdekking per veld</h3>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
            {data.auditCoverage.map((item: any) => (
              <div key={item.field_name} className="rounded-xl border border-white/5 bg-slate-950/35 p-3">
                <div className="truncate text-[8px] font-black uppercase text-slate-500">{item.field_name}</div>
                <div className="mt-1 text-lg font-black text-blue-300">{pct(item.coverage)}</div>
                <div className="text-[8px] text-slate-500">{item.available}/{item.rows} beschikbaar</div>
              </div>
            ))}
          </div>
        </section>
        <section className="glass-card rounded-3xl border border-rose-500/15 p-5">
          <h3 className="text-sm font-black uppercase text-rose-200">Recente bronconflicten</h3>
          <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
            {data.conflicts.map((item: any) => (
              <div key={`${item.entity_key}-${item.field_name}`} className="rounded-xl border border-white/5 bg-slate-950/35 p-3">
                <div className="flex justify-between gap-2">
                  <div className="truncate text-[10px] font-black text-white">{item.entity_key}</div>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[8px] font-black text-emerald-300">{item.status}</span>
                </div>
                <div className="mt-1 text-[9px] text-slate-500">{item.field_name} · {item.resolution_method}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="glass-card rounded-3xl border border-emerald-500/15 p-5">
        <h3 className="text-sm font-black uppercase text-emerald-200">Historische trends</h3>
        <p className="mt-1 text-[10px] text-slate-500">Dagelijkse ontwikkeling van datakwaliteit, oddsdekking en modelkwaliteit.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {trendItems.map((trend) => {
            const values = trend.rows.map((row) => Number(row.metric_value || 0));
            const maximum = Math.max(...values, 1);
            const latest = values.at(-1) || 0;
            return (
              <div key={trend.key} className="rounded-2xl border border-white/5 bg-slate-950/35 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-[9px] font-black uppercase text-slate-400">{trend.key.replaceAll("_", " ")}</div>
                  <div className="text-sm font-black text-emerald-300">{Number(latest.toFixed(4)).toLocaleString("nl-NL")}</div>
                </div>
                <div className="mt-3 flex h-12 items-end gap-1">
                  {values.map((value, index) => (
                    <div key={index} className="min-w-1 flex-1 rounded-t bg-emerald-400/60" style={{ height: `${Math.max(5, (value / maximum) * 100)}%` }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
        <section className="glass-card rounded-3xl border border-sky-500/15 p-5">
          <h3 className="text-sm font-black uppercase text-sky-200">Modelkwaliteit per competitie en versie</h3>
          <p className="mt-1 text-[9px] text-slate-500">Alleen zichtbaar vanaf {number(data.modelQualityMinimumSample || 20)} evaluaties.</p>
          <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto">
            {modelQuality.map((item) => (
              <div key={item.dimension} className="rounded-2xl border border-white/5 bg-slate-950/35 p-3">
                <div className="truncate text-[10px] font-black text-white">{item.metadata.competitionId || "Onbekende competitie"}</div>
                <div className="mt-1 truncate text-[8px] text-slate-500">{item.metadata.modelVersion || "Onbekend model"}</div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div><div className="text-sm font-black text-sky-300">{number(item.metrics.model_evaluation_count)}</div><div className="text-[7px] uppercase text-slate-500">evaluaties</div></div>
                  <div><div className="text-sm font-black text-emerald-300">{pct(item.metrics.model_outcome_hit_rate)}</div><div className="text-[7px] uppercase text-slate-500">uitkomst hit</div></div>
                  <div><div className="text-sm font-black text-amber-300">{Number(item.metrics.model_average_brier || 0).toFixed(3)}</div><div className="text-[7px] uppercase text-slate-500">Brier</div></div>
                </div>
                <div className="mt-2 text-[8px] text-slate-500">
                  Tegen baseline: hit {item.metrics.model_outcome_hit_rate >= item.metrics.model_baseline_outcome_hit_rate ? "+" : ""}{pct(item.metrics.model_outcome_hit_rate - item.metrics.model_baseline_outcome_hit_rate)} · Brier {(item.metrics.model_average_brier - item.metrics.model_baseline_average_brier).toFixed(3)}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="glass-card rounded-3xl border border-lime-500/15 p-5">
          <h3 className="text-sm font-black uppercase text-lime-200">ROI/CLV kwaliteitsgate</h3>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">Publicatie start pas zodra minimaal 100 veilige prematch- en closing-waarnemingen beschikbaar zijn.</p>
          <div className="mt-4 space-y-3">
            {[
              ["Prematch odds", roiMetric("roi_clv_safe_prematch_odds"), roiMetric("roi_clv_roi_ready")],
              ["Closing paren", roiMetric("roi_clv_closing_pairs"), roiMetric("roi_clv_clv_ready")],
            ].map(([label, value, ready]) => (
              <div key={String(label)} className="rounded-2xl border border-white/5 bg-slate-950/35 p-3">
                <div className="flex justify-between text-[9px] font-black text-white"><span>{label}</span><span className={ready ? "text-emerald-300" : "text-amber-300"}>{ready ? "gereed" : "wachten"}</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-900"><div className="h-full rounded-full bg-lime-400" style={{ width: `${Math.min(100, Number(value))}%` }} /></div>
                <div className="mt-2 text-[8px] text-slate-500">{number(value)} / 100 veilige waarnemingen</div>
              </div>
            ))}
            <div className="rounded-2xl border border-cyan-500/10 bg-cyan-500/5 p-3 text-[9px] text-cyan-200">
              Automatische repairs: {number((data.repairSummary || []).find((row: any) => row.repair_status === "applied" && row.rollback_status === "not_rolled_back")?.rows || 0)}
            </div>
            <div className="rounded-2xl border border-violet-500/10 bg-violet-500/5 p-3 text-[9px] text-violet-200">
              Permanente clubmerge-audits: {number((data.clubMergeAudits || []).length)}
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="glass-card rounded-3xl border border-orange-500/15 p-5">
          <h3 className="text-sm font-black uppercase text-orange-200">Actieve kwaliteitswaarschuwingen</h3>
          <div className="mt-4 space-y-2">
            {(data.qualityAlerts || []).length ? data.qualityAlerts.map((alert: any) => (
              <div key={alert.alert_id} className="rounded-2xl border border-orange-500/10 bg-orange-500/5 p-3">
                <div className="flex justify-between gap-2"><span className="truncate text-[9px] font-black text-white">{alert.dimension_key}</span><span className="text-[8px] font-black uppercase text-orange-300">{alert.severity}</span></div>
                <div className="mt-1 text-[9px] text-slate-400">{alert.message}</div>
                <div className="mt-2 text-[8px] text-slate-500">{Number(alert.previous_value || 0).toFixed(3)} naar {Number(alert.current_value || 0).toFixed(3)}</div>
                <div className="mt-3 flex gap-1">
                  {[["acknowledged", "Bevestigen"], ["ignored", "Negeren"], ["resolved", "Oplossen"]].map(([action, label]) => (
                    <button key={action} onClick={() => updateAlert(alert.alert_id, action)} className="rounded-lg border border-white/10 px-2 py-1 text-[7px] font-black uppercase text-slate-300 hover:bg-white/5">{label}</button>
                  ))}
                </div>
              </div>
            )) : <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-4 text-[10px] font-bold text-emerald-200">Geen plotselinge kwaliteitsdalingen gevonden.</div>}
          </div>
        </section>
        <section className="glass-card rounded-3xl border border-fuchsia-500/15 p-5">
          <h3 className="text-sm font-black uppercase text-fuchsia-200">Veldspecifieke providertrust</h3>
          <div className="mt-4 max-h-[360px] space-y-2 overflow-y-auto">
            {(data.fieldTrust || []).slice(0, 24).map((item: any) => (
              <div key={`${item.provider}-${item.field_name}`} className="rounded-xl border border-white/5 bg-slate-950/35 p-3">
                <div className="flex justify-between gap-2"><span className="truncate text-[9px] font-black text-white">{item.provider}</span><span className={item.control_status === "disabled" ? "text-[10px] font-black text-red-300" : "text-[10px] font-black text-fuchsia-300"}>{item.control_status === "disabled" ? "uitgeschakeld" : pct(item.effective_trust_score)}</span></div>
                <div className="mt-1 text-[8px] text-slate-500">{item.field_name} · {number(item.samples)} samples · Wilson {pct(item.wilson_lower_bound)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="glass-card rounded-3xl border border-violet-500/15 p-5">
        <h3 className="text-sm font-black uppercase text-violet-200">Partitioneringsreadiness</h3>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {(data.partitions || []).map((item: any) => {
            const ratio = Math.min(1, Number(item.current_rows || 0) / Math.max(Number(item.activate_after_rows || 1), 1));
            return (
              <div key={item.table_name} className="rounded-2xl border border-white/5 bg-slate-950/35 p-3">
                <div className="flex justify-between gap-2">
                  <div className="truncate text-[10px] font-black text-white">{item.table_name}</div>
                  <span className="text-[8px] font-black text-violet-300">{item.migration_status}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-900">
                  <div className="h-full rounded-full bg-violet-400" style={{ width: `${Math.max(1, ratio * 100)}%` }} />
                </div>
                <div className="mt-2 text-[8px] text-slate-500">{number(item.current_rows)} / {number(item.activate_after_rows)} · {item.recommended_interval}</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default DataIntegrityView;
