import React, { useEffect, useState } from "react";

type ModelOpsPayload = {
  dataScout?: any;
  sourceCoverage?: any;
  dataCompletenessAudit?: any;
  aiAdvice?: any[];
  backtestSegmentation?: any;
  leagueCalibrationProfiles?: Record<string, any>;
  leagueCalibrationProfilesByWindow?: Record<string, Record<string, any>>;
  leagueCalibrationRollbackProfiles?: Record<string, any>;
  workerVersion?: string;
  lastRun?: number;
};

const pct = (value: any) => `${Math.round(Number(value || 0) * 100)}%`;

const IMPLEMENTED_AI_ACTIONS = new Set([
  "H2H-signaal herwegen",
  "Top-5 exact-score selectie herwegen",
  "Faalsignaal aanpakken: low_model_agreement",
]);

const IMPLEMENTED_COVERAGE_PIPELINES = new Set(["lineups"]);

const ModelOpsView: React.FC = () => {
  const [payload, setPayload] = useState<ModelOpsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/matches?view=full&t=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setPayload(data || {});
      })
      .catch(() => {
        if (!cancelled) setPayload({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scout = payload?.dataScout || {};
  const coverage = payload?.sourceCoverage || {};
  const segmentation = payload?.backtestSegmentation || scout?.backtestSegmentation || {};
  const assertions = Array.isArray(scout?.regressionAssertions) ? scout.regressionAssertions : [];
  const driftAlerts = Array.isArray(segmentation?.driftAlerts) ? segmentation.driftAlerts : [];
  const selfHealing = scout?.selfHealing || {};
  const selectedCalibration = Object.entries(payload?.leagueCalibrationProfiles || {}).slice(0, 8);
  const windowProfiles = payload?.leagueCalibrationProfilesByWindow || {};
  const rollbackProfiles = Object.entries(payload?.leagueCalibrationRollbackProfiles || {}).slice(0, 8);
  const todayMatchCount = Number(coverage.todayMatches ?? scout?.collected?.todayMatches ?? 0);
  const tomorrowMatchCount = Number(scout?.collected?.tomorrowMatches ?? 0);
  const hasMatchContext = todayMatchCount > 0 || tomorrowMatchCount > 0;
  const actionItems = [
    ...(payload?.aiAdvice || []).map((item: any) => ({
      title: item.title || "AI-advies",
      summary: IMPLEMENTED_AI_ACTIONS.has(item.title)
        ? `Technische correctie uitgevoerd; ${item.summary || "resultaat wordt via nieuwe reviews bewaakt."}`
        : item.summary || item.action || "",
      action: item.action || item.summary || "",
      priority: IMPLEMENTED_AI_ACTIONS.has(item.title)
        ? "low"
        : !hasMatchContext && item.priority === "high" ? "low" : item.priority || "medium",
      implementationDone: IMPLEMENTED_AI_ACTIONS.has(item.title),
      source: "AI advies",
    })),
    ...(coverage.coverageImprovementPlan || []).map((item: any) => ({
      title: item.label || item.key || "Dekkingsactie",
      summary: hasMatchContext
        ? `${IMPLEMENTED_COVERAGE_PIPELINES.has(item.key) ? "Pipeline actief; " : ""}${pct(item.coverage)} dekking, doel ${pct(item.target)}.`
        : "Geen actuele wedstrijdcontext; bewaken zodra er wedstrijden zijn.",
      action: item.action || "",
      priority: !hasMatchContext || item.status === "ok"
        ? "low"
        : IMPLEMENTED_COVERAGE_PIPELINES.has(item.key) ? "medium" : "high",
      implementationDone: IMPLEMENTED_COVERAGE_PIPELINES.has(item.key),
      source: "Brondekking",
    })),
  ].slice(0, 8);

  if (loading) {
    return <div className="glass-card rounded-2xl border border-white/5 p-6 text-sm text-slate-400">Model Ops laden...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1">
        <div className="text-[10px] font-black uppercase text-cyan-300">Model Ops</div>
        <h2 className="text-2xl font-black text-white">Assertions, drift en herstel</h2>
        <div className="text-[11px] text-slate-500">
          Worker {payload?.workerVersion || "unknown"} · laatste run {payload?.lastRun ? new Date(payload.lastRun).toLocaleString("nl-NL") : "onbekend"}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Datakwaliteit", value: pct(coverage.averageDataCompleteness), tone: Number(coverage.averageDataCompleteness || 0) >= 0.6 ? "text-emerald-300" : "text-amber-300" },
          { label: "H2H", value: pct(coverage.h2hCoverage), tone: Number(coverage.h2hCoverage || 0) >= 0.75 ? "text-emerald-300" : "text-amber-300" },
          { label: "Healing", value: `${Number(selfHealing.healed || 0)}/${Number(selfHealing.attempted || 0)}`, tone: "text-cyan-300" },
          { label: "Drift alerts", value: driftAlerts.length, tone: driftAlerts.length ? "text-rose-300" : "text-emerald-300" },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-white/5 bg-slate-950/45 px-4 py-3">
            <div className="text-[9px] font-black uppercase text-slate-500">{item.label}</div>
            <div className={`mt-1 text-2xl font-black ${item.tone}`}>{item.value}</div>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-cyan-500/15 bg-cyan-950/10 p-4">
        <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[10px] font-black uppercase text-cyan-300">Workflowprioriteiten</div>
            <h3 className="text-lg font-black text-white">Volgende verbeteracties</h3>
          </div>
          <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">
            PandaOS-principe: een centrale agent-werkstroom
          </div>
        </div>
        <div className="mt-3 grid gap-2 xl:grid-cols-2">
          {actionItems.length ? actionItems.map((item: any, index: number) => (
            <div key={`${item.source}-${item.title}-${index}`} className="rounded-xl border border-white/5 bg-slate-950/45 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-[10px] font-black text-white">{item.title}</div>
                <span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase ${
                  item.priority === "high" ? "bg-rose-500/10 text-rose-300" :
                  item.priority === "low" ? "bg-slate-500/10 text-slate-300" :
                  "bg-amber-500/10 text-amber-300"
                }`}>
                  {item.implementationDone ? "monitor" : item.priority}
                </span>
              </div>
              <div className="mt-1 text-[9px] text-slate-400">{item.summary}</div>
              {item.action && <div className="mt-2 text-[9px] font-semibold text-cyan-200">{item.action}</div>}
              <div className="mt-2 text-[8px] uppercase text-slate-600">{item.source}</div>
            </div>
          )) : (
            <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-4 text-[11px] font-bold text-emerald-200">
              Geen open verbeteracties in de laatste worker-output.
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="rounded-2xl border border-white/5 bg-slate-950/35 p-4">
          <div className="mb-3 text-[10px] font-black uppercase text-slate-400">Regressie assertions</div>
          <div className="space-y-2">
            {assertions.length ? assertions.map((item: any) => (
              <div key={item.key} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[10px] font-black text-white">{item.key}</div>
                  <div className="truncate text-[9px] text-slate-500">{item.detail}</div>
                </div>
                <span className={`text-[9px] font-black ${item.passed ? "text-emerald-300" : "text-rose-300"}`}>
                  {item.passed ? "PASS" : "FAIL"}
                </span>
              </div>
            )) : <div className="text-[11px] text-slate-500">Nog geen assertions in de laatste worker-output.</div>}
          </div>
        </section>

        <section className="rounded-2xl border border-white/5 bg-slate-950/35 p-4">
          <div className="mb-3 text-[10px] font-black uppercase text-slate-400">Self-healing tijdlijn</div>
          <div className="space-y-2">
            {(selfHealing.details || []).slice(0, 10).map((item: any, index: number) => (
              <div key={`${item.matchId}-${index}`} className="rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2">
                <div className="text-[10px] font-black text-white">{item.matchId}</div>
                <div className="text-[9px] text-slate-500">
                  {item.timedOut ? "timeout" : (item.healedProblems || item.attemptedProblems || []).join(", ") || "geen wijziging"}
                </div>
              </div>
            ))}
            {!(selfHealing.details || []).length && <div className="text-[11px] text-slate-500">Geen herstelacties in de laatste run.</div>}
          </div>
        </section>

        <section className="rounded-2xl border border-white/5 bg-slate-950/35 p-4">
          <div className="mb-3 text-[10px] font-black uppercase text-slate-400">Drift alerts</div>
          <div className="space-y-2">
            {driftAlerts.length ? driftAlerts.slice(0, 10).map((item: any, index: number) => (
              <div key={`${item.scope}-${item.key}-${index}`} className="rounded-xl border border-amber-500/10 bg-amber-950/20 px-3 py-2">
                <div className="text-[10px] font-black text-white">{item.scope}: {item.key}</div>
                <div className="text-[9px] text-slate-400">
                  {item.metric} {Math.round(Number(item.previous || 0) * 100)}% naar {Math.round(Number(item.current || 0) * 100)}%
                </div>
              </div>
            )) : <div className="text-[11px] text-slate-500">Geen performance drift gedetecteerd.</div>}
          </div>
        </section>

        <section className="rounded-2xl border border-white/5 bg-slate-950/35 p-4">
          <div className="mb-3 text-[10px] font-black uppercase text-slate-400">Calibratie windows</div>
          <div className="space-y-2">
            {selectedCalibration.length ? selectedCalibration.map(([league, row]: [string, any]) => (
              <div key={league} className="rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2">
                <div className="truncate text-[10px] font-black text-white">{league}</div>
                <div className="text-[9px] text-slate-500">
                  gekozen {row.selectedWindow || row.windowDays}d · {row.matches} reviews · stabiliteit {Math.round(Number(row.stabilityScore || 0) * 100)}%
                </div>
              </div>
            )) : <div className="text-[11px] text-slate-500">Nog geen stabiele calibratievensters beschikbaar.</div>}
            {Object.keys(windowProfiles).length > 0 && (
              <div className="pt-2 text-[9px] text-slate-500">
                Vensters actief: {Object.keys(windowProfiles).sort((a, b) => Number(a) - Number(b)).join("d, ")}d
              </div>
            )}
            {rollbackProfiles.length > 0 && (
              <div className="pt-2 text-[9px] text-amber-300">
                Rollbacks: {rollbackProfiles.map(([league]) => league).join(", ")}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default ModelOpsView;
