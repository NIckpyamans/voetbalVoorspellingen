import React, { useEffect, useState } from "react";

const pct = (value: unknown) => `${Math.round(Number(value || 0) * 100)}%`;
const number = (value: unknown) => Number(value || 0).toLocaleString("nl-NL");

const DataIntegrityView: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/data-integrity", { cache: "no-store", signal: controller.signal })
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
    </div>
  );
};

export default DataIntegrityView;
